import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const targetDir = path.join(desktopDir, 'build', 'desktop', 'licenses');
const webArtifactDir = path.join(repoRoot, 'build', 'desktop', 'licenses');

const sha256File = async file => createHash('sha256').update(await readFile(file))
    .digest('hex');

const hashWebBuild = async root => {
    const hash = createHash('sha256');
    const visit = async (directory, relative = '') => {
        const children = (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
            const childRelative = path.posix.join(relative, child.name);
            if (childRelative === 'desktop' || childRelative.startsWith('desktop/')) continue;
            const file = path.join(directory, child.name);
            if (child.isDirectory()) await visit(file, childRelative);
            else if (child.isFile() && childRelative !== 'build-info.json') {
                hash.update(childRelative);
                hash.update('\0');
                hash.update(await readFile(file));
                hash.update('\0');
            }
        }
    };
    await visit(root);
    return hash.digest('hex');
};

const packageEntries = async (lockPath, nodeModulesRoot, prefix, includeAll = false, includedPackagePaths = null) => {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const packages = [];
    for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
        if (!packagePath || !packagePath.includes('node_modules/')) continue;
        const excluded = includedPackagePaths ? !includedPackagePaths.has(packagePath) :
            (!includeAll && metadata.dev === true);
        if (excluded) continue;
        const manifestPath = path.join(nodeModulesRoot, packagePath.slice('node_modules/'.length), 'package.json');
        let manifest = {};
        try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        } catch (error) {
            // Keep the lock entry and report missing installed metadata as UNKNOWN.
        }
        const license = (() => {
            if (typeof manifest.license === 'string') return manifest.license;
            if (Array.isArray(manifest.licenses)) {
                return manifest.licenses.map(item => {
                    if (typeof item === 'string') return item;
                    return item.type || 'UNKNOWN';
                }).join(' OR ');
            }
            if (manifest.license && manifest.license.type) return manifest.license.type;
            return 'UNKNOWN';
        })();
        packages.push({
            name: manifest.name || packagePath.split('node_modules/').pop(),
            version: manifest.version || metadata.version || 'UNKNOWN',
            license: license || 'UNKNOWN',
            author: typeof manifest.author === 'string' ? manifest.author :
                (manifest.author && manifest.author.name) || null,
            homepage: manifest.homepage || (manifest.repository && (
                typeof manifest.repository === 'string' ? manifest.repository : manifest.repository.url
            )) || null,
            source: prefix,
            packagePath: packagePath.slice('node_modules/'.length),
            integrity: metadata.integrity || null,
            resolved: metadata.resolved || null
        });
    }
    return packages;
};

export const matchRuntimePackagesToLock = (runtimeModules, lockPackages) => {
    const packageRoots = Object.keys(lockPackages || {})
        .filter(packagePath => packagePath && packagePath.includes('node_modules/'))
        .map(packagePath => packagePath.replace(/\\/g, '/'))
        .sort((a, b) => b.length - a.length);
    const matched = new Set();
    const unmapped = [];
    for (const rawModulePath of runtimeModules || []) {
        const modulePath = String(rawModulePath || '').replace(/\\/g, '/')
            .replace(/^\.\//, '');
        const packagePath = packageRoots.find(root => modulePath === root || modulePath.startsWith(`${root}/`));
        if (packagePath) matched.add(packagePath);
        else unmapped.push(modulePath);
    }
    return {packagePaths: [...matched].sort(), unmappedModules: unmapped.sort()};
};

export const mergePackageInventories = packages => {
    const merged = new Map();
    const conflicts = [];
    for (const item of packages) {
        const identity = item.integrity || item.resolved || item.packagePath;
        const key = `${item.name}@${item.version}|${identity || 'no-lock-identity'}`;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, {
                ...item,
                sources: [item.source],
                packagePaths: [item.packagePath],
                licenseTextFiles: [...(item.licenseTextFiles || [])]
            });
            continue;
        }
        if (existing.license !== item.license || existing.homepage !== item.homepage) {
            conflicts.push({identity: key,
                first: {license: existing.license, homepage: existing.homepage},
                additional: {license: item.license, homepage: item.homepage}});
            const conflictingKey = `${key}|metadata-conflict:${item.source}:${item.packagePath}`;
            merged.set(conflictingKey, {
                ...item,
                metadataConflict: true,
                sources: [item.source],
                packagePaths: [item.packagePath],
                licenseTextFiles: [...(item.licenseTextFiles || [])]
            });
            existing.metadataConflict = true;
            continue;
        }
        existing.sources = [...new Set([...existing.sources, item.source])].sort();
        existing.packagePaths = [...new Set([...existing.packagePaths, item.packagePath])].sort();
        existing.licenseTextFiles = [...new Set([
            ...existing.licenseTextFiles,
            ...(item.licenseTextFiles || [])
        ])].sort();
    }
    return {
        packages: [...merged.values()].sort((a, b) =>
            a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
        conflicts
    };
};

const copyPackageLicenseTexts = async (packages, outputRoot, sources = {}) => {
    const isLicenseFile = name => {
        const recognizedName = /^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i.test(name);
        const hasTextExtension = /\.(txt|md|html|rtf)$/i.test(name);
        const extensionlessName = /^(licen[cs]e|copying|notice|copyright)$/i.test(name);
        return (recognizedName && hasTextExtension) || extensionlessName;
    };
    const collect = async (directory, depth = 0) => {
        if (depth > 2) return [];
        let children = [];
        try {
            children = await readdir(directory, {withFileTypes: true});
        } catch (error) {
            return [];
        }
        const files = [];
        for (const child of children) {
            const fullPath = path.join(directory, child.name);
            if (child.isFile() && isLicenseFile(child.name)) files.push(fullPath);
            else if (child.isDirectory() && (depth === 0 || /^licenses?$/i.test(path.basename(directory)))) {
                files.push(...await collect(fullPath, depth + 1));
            }
        }
        return files;
    };
    const unresolved = [];
    for (const item of packages) {
        const packageRoot = item.source === 'brickwright-web-runtime' ?
            path.join(sources.webModulesRoot || path.join(repoRoot, 'node_modules'), item.packagePath) :
            item.source === 'brickwright-desktop-runtime' ?
                path.join(sources.desktopModulesRoot || path.join(desktopDir, 'node_modules'), item.packagePath) :
                path.join(desktopDir, item.packagePath);
        const sourceFiles = await collect(packageRoot);
        if (!sourceFiles.length) {
            unresolved.push(`${item.name}@${item.version}`);
            item.licenseTextFiles = [];
            continue;
        }
        const safeName = `${item.name}-${item.version}`.replace(/[^A-Za-z0-9@._-]/g, '_');
        const outputDir = path.join(outputRoot, 'third-party', safeName);
        await mkdir(outputDir, {recursive: true});
        const copied = [];
        for (const sourceFile of sourceFiles) {
            const outputFile = path.join(outputDir, path.relative(packageRoot, sourceFile));
            await mkdir(path.dirname(outputFile), {recursive: true});
            await copyFile(sourceFile, outputFile);
            copied.push(path.relative(outputRoot, outputFile).replace(/\\/g, '/'));
        }
        item.licenseTextFiles = copied;
    }
    return unresolved;
};

const currentCommit = () => {
    if (process.env.BRICKWRIGHT_BUILD_COMMIT || process.env.GITHUB_SHA) {
        return process.env.BRICKWRIGHT_BUILD_COMMIT || process.env.GITHUB_SHA;
    }
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repoRoot, encoding: 'utf8'}).trim();
    } catch (error) {
        return 'unknown';
    }
};

export const verifyWebRuntimeProvenance = ({manifest, lockSha256, buildSha256, commit}) => {
    if (manifest.schemaVersion !== 1) throw new Error('Unsupported web license artifact manifest version.');
    if (manifest.rootLockSha256 !== lockSha256) {
        throw new Error('Web license artifact root lockfile SHA-256 does not match this checkout.');
    }
    if (manifest.webBuildSha256 !== buildSha256) {
        throw new Error('Web license artifact build SHA-256 does not match the staged editor files.');
    }
    if (commit !== 'unknown' && manifest.sourceCommit !== commit) {
        throw new Error('Web license artifact source commit does not match the desktop build commit.');
    }
};

const generateWebRuntimeArtifact = async () => {
    const rootLock = path.join(repoRoot, 'package-lock.json');
    const runtimeReportPath = path.join(desktopDir, 'build', 'webpack-runtime-packages.json');
    const runtimeReport = JSON.parse(await readFile(runtimeReportPath, 'utf8'));
    if (runtimeReport.schemaVersion !== 1 || !Array.isArray(runtimeReport.runtimeModules)) {
        throw new Error(
            'Webpack runtime package report is missing or invalid. Rebuild the web editor before collecting licenses.'
        );
    }
    const lock = JSON.parse(await readFile(rootLock, 'utf8'));
    const runtimePackages = matchRuntimePackagesToLock(runtimeReport.runtimeModules, lock.packages);
    if (runtimePackages.unmappedModules.length) {
        const firstUnmapped = runtimePackages.unmappedModules.slice(0, 10).join(', ');
        throw new Error(`Webpack runtime modules are not mapped to the root lockfile: ${firstUnmapped}`);
    }
    const packages = await packageEntries(
        rootLock,
        path.join(repoRoot, 'node_modules'),
        'brickwright-web-runtime',
        false,
        new Set(runtimePackages.packagePaths)
    );
    if (packages.length !== runtimePackages.packagePaths.length) {
        const discovered = new Set(packages.map(item => `node_modules/${item.packagePath}`));
        const missing = runtimePackages.packagePaths.filter(item => !discovered.has(item));
        throw new Error(`Webpack runtime packages are absent from installed lockfile metadata: ${missing.join(', ')}`);
    }
    const missingLicenseTexts = await copyPackageLicenseTexts(packages, webArtifactDir, {
        webModulesRoot: path.join(repoRoot, 'node_modules')
    });
    const unknownLicenses = packages
        .filter(item => !item.license || item.license === 'UNKNOWN')
        .map(item => `${item.name}@${item.version}`);
    const manifest = {
        schemaVersion: 1,
        sourceCommit: currentCommit(),
        rootLockSha256: await sha256File(rootLock),
        webBuildSha256: await hashWebBuild(path.join(repoRoot, 'build')),
        generatedAt: new Date().toISOString(),
        packages,
        runtimeModuleCount: runtimeReport.runtimeModules.length,
        runtimePackagePathCount: runtimePackages.packagePaths.length,
        unmappedRuntimeModules: runtimePackages.unmappedModules,
        unknownLicenses,
        missingLicenseTexts
    };
    await mkdir(webArtifactDir, {recursive: true});
    await writeFile(path.join(webArtifactDir, 'web-runtime-licenses.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
        `Prepared web license data for ${packages.length} packages ` +
        `(${manifest.unknownLicenses.length} UNKNOWN; ${missingLicenseTexts.length} missing texts).`
    );
};

const generateDesktopNotices = async () => {
    const stagedBuild = path.join(desktopDir, 'build');
    const buildInfo = JSON.parse(await readFile(path.join(stagedBuild, 'build-info.json'), 'utf8'));
    const webManifestPath = path.join(targetDir, 'web-runtime-licenses.json');
    let webManifest;
    try {
        webManifest = JSON.parse(await readFile(webManifestPath, 'utf8'));
    } catch (error) {
        throw new Error([
            'Web runtime license artifact is missing. Generate it on Ubuntu and download it with the checked web build',
            'before preparing desktop notices.'
        ].join(' '));
    }
    verifyWebRuntimeProvenance({
        manifest: webManifest,
        lockSha256: await sha256File(path.join(repoRoot, 'package-lock.json')),
        buildSha256: await hashWebBuild(stagedBuild),
        commit: buildInfo.commit
    });

    const desktopPackages = await packageEntries(
        path.join(desktopDir, 'package-lock.json'),
        path.join(desktopDir, 'node_modules'),
        'brickwright-desktop-runtime'
    );
    const directDesktop = await readFile(path.join(desktopDir, 'package.json'), 'utf8').then(JSON.parse);
    const electron = {
        name: 'electron-runtime',
        version: directDesktop.devDependencies.electron,
        license: 'MIT',
        author: 'OpenJS Foundation and Electron contributors',
        homepage: 'https://www.electronjs.org/',
        source: 'electron-distribution',
        packagePath: 'node_modules/electron'
    };
    const desktopMissingTexts = await copyPackageLicenseTexts(desktopPackages, targetDir, {
        desktopModulesRoot: path.join(desktopDir, 'node_modules')
    });
    const inventory = mergePackageInventories([...webManifest.packages, ...desktopPackages, electron]);
    const entries = inventory.packages;
    await mkdir(targetDir, {recursive: true});
    await copyFile(path.join(repoRoot, 'LICENSE'), path.join(targetDir, 'GPL-3.0.txt'));
    await copyFile(path.join(desktopDir, 'licenses', 'MPL-2.0.txt'), path.join(targetDir, 'MPL-2.0.txt'));

    const electronDist = path.join(desktopDir, 'node_modules', 'electron', 'dist');
    const electronChromiumNotices = [];
    const missingElectronNotices = [];
    for (const candidate of ['LICENSE', 'LICENSES.chromium.html']) {
        try {
            const output = `Electron-${candidate.replace(/[^A-Za-z0-9.-]/g, '-')}`;
            await copyFile(path.join(electronDist, candidate), path.join(targetDir, output));
            electronChromiumNotices.push(output);
        } catch (error) {
            missingElectronNotices.push(candidate);
        }
    }

    const unknown = entries.filter(item => !item.license || item.license === 'UNKNOWN');
    const missingLicenseTexts = [...new Set([...webManifest.missingLicenseTexts, ...desktopMissingTexts])].sort();
    const manifest = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        application: {name: 'Brickwright', license: 'GPL-3.0-only', rootLicenseFile: 'GPL-3.0.txt'},
        spiKeExtension: {name: 'Brickwright SPIKE extension', license: 'MPL-2.0', licenseFile: 'MPL-2.0.txt'},
        provenance: {
            sourceCommit: buildInfo.commit,
            webBuildSha256: webManifest.webBuildSha256,
            rootLockSha256: webManifest.rootLockSha256,
            webArtifactSha256: process.env.BRICKWRIGHT_WEB_ARTIFACT_SHA256 || null,
            desktopLockSha256: await sha256File(path.join(desktopDir, 'package-lock.json'))
        },
        packages: entries,
        electronChromiumNotices,
        missingElectronNotices,
        unknownLicenseCount: unknown.length,
        unknownLicenses: unknown.map(item => `${item.name}@${item.version}`),
        packageIdentityConflicts: inventory.conflicts,
        missingLicenseTextCount: missingLicenseTexts.length,
        missingLicenseTexts
    };
    await writeFile(path.join(targetDir, 'THIRD_PARTY_LICENSES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const lines = [
        'Brickwright third-party license and attribution inventory',
        'Brickwright: GNU GPL version 3 (see GPL-3.0.txt).',
        'Brickwright SPIKE extension: Mozilla Public License 2.0 (see MPL-2.0.txt).',
        [
            'Package license declarations below come from installed package manifests and lockfiles.',
            'License text files are under third-party/.',
            'UNKNOWN or missing notices remain unresolved and block formal distribution.'
        ].join(' '),
        `Source commit: ${manifest.provenance.sourceCommit}`,
        `Web build SHA-256: ${manifest.provenance.webBuildSha256}`,
        `Web dependency lock SHA-256: ${manifest.provenance.rootLockSha256}`,
        `Web artifact SHA-256: ${manifest.provenance.webArtifactSha256 || 'not supplied outside CI'}`,
        ''
    ];
    for (const item of entries) {
        lines.push(
            `${item.name}@${item.version}`,
            `  License: ${item.license}`,
            `  Author: ${item.author || 'not declared'}`,
            `  Source: ${item.homepage || 'not declared'}`,
            ''
        );
    }
    await writeFile(path.join(targetDir, 'THIRD_PARTY_LICENSES.txt'), `${lines.join('\n')}\n`);
    await writeFile(path.join(targetDir, 'ASSET_RIGHTS_STATUS.txt'),
        'Media rights are tracked in assets-rights.json. Every unverified entry blocks formal release.\n');
    console.log(
        `Generated notices for ${entries.length} packages; ` +
        `${unknown.length} licenses are UNKNOWN; ` +
        `${missingLicenseTexts.length} packages have no discoverable license text.`
    );
};

const main = () => {
    if (process.argv.includes('--web-only')) return generateWebRuntimeArtifact();
    return generateDesktopNotices();
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
