import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const targetDir = path.join(desktopDir, 'build', 'desktop', 'licenses');

const packageEntries = async (lockPath, nodeModulesRoot, prefix, includeAll = false) => {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const packages = [];
    for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
        if (!packagePath || !packagePath.includes('node_modules/')) continue;
        if (!includeAll && metadata.dev === true) continue;
        const manifestPath = path.join(nodeModulesRoot, packagePath.slice('node_modules/'.length), 'package.json');
        let manifest = {};
        try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        } catch (error) {
            // Keep the lock entry and report missing metadata as UNKNOWN.
        }
        const license = typeof manifest.license === 'string' ? manifest.license :
            (Array.isArray(manifest.licenses) ? manifest.licenses.map(item => typeof item === 'string' ? item : item.type || 'UNKNOWN').join(' OR ') :
                (manifest.license && manifest.license.type) || 'UNKNOWN');
        packages.push({
            name: manifest.name || packagePath.split('node_modules/').pop(),
            version: manifest.version || metadata.version || 'UNKNOWN',
            license: license || 'UNKNOWN',
            author: typeof manifest.author === 'string' ? manifest.author : manifest.author && manifest.author.name || null,
            homepage: manifest.homepage || (manifest.repository && (typeof manifest.repository === 'string' ? manifest.repository : manifest.repository.url)) || null,
            source: prefix,
            packagePath: packagePath.slice('node_modules/'.length)
        });
    }
    return packages;
};

const copyPackageLicenseTexts = async packages => {
    const isLicenseFile = name => /^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i.test(name) &&
        /\.(txt|md|html|rtf)$/i.test(name) || /^(licen[cs]e|copying|notice|copyright)$/i.test(name);
    const collect = async (directory, depth = 0) => {
        if (depth > 2) return [];
        let children = [];
        try { children = await readdir(directory, {withFileTypes: true}); } catch (error) { return []; }
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
            path.join(repoRoot, 'node_modules', item.packagePath) :
            item.source === 'brickwright-desktop-runtime' ?
                path.join(desktopDir, 'node_modules', item.packagePath) :
                path.join(desktopDir, item.packagePath);
        const sourceFiles = await collect(packageRoot);
        if (!sourceFiles.length) {
            unresolved.push(`${item.name}@${item.version}`);
            item.licenseTextFiles = [];
            continue;
        }
        const safeName = `${item.name}-${item.version}`.replace(/[^A-Za-z0-9@._-]/g, '_');
        const outputDir = path.join(targetDir, 'third-party', safeName);
        await mkdir(outputDir, {recursive: true});
        const copied = [];
        for (const sourceFile of sourceFiles) {
            const outputFile = path.join(outputDir, path.relative(packageRoot, sourceFile));
            await mkdir(path.dirname(outputFile), {recursive: true});
            await copyFile(sourceFile, outputFile);
            copied.push(path.relative(targetDir, outputFile).replace(/\\/g, '/'));
        }
        item.licenseTextFiles = copied;
    }
    return unresolved;
};

const main = async () => {
    const rootLock = await packageEntries(path.join(repoRoot, 'package-lock.json'), path.join(repoRoot, 'node_modules'), 'brickwright-web-runtime');
    const desktopLock = await packageEntries(path.join(desktopDir, 'package-lock.json'), path.join(desktopDir, 'node_modules'), 'brickwright-desktop-runtime');
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
    const entries = [...rootLock, ...desktopLock, electron].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
    await mkdir(targetDir, {recursive: true});
    await copyFile(path.join(repoRoot, 'LICENSE'), path.join(targetDir, 'GPL-3.0.txt'));
    await copyFile(path.join(desktopDir, 'licenses', 'MPL-2.0.txt'), path.join(targetDir, 'MPL-2.0.txt'));

    const electronDist = path.join(desktopDir, 'node_modules', 'electron', 'dist');
    const electronChromiumNotices = [];
    const missingElectronNotices = [];
    for (const candidate of ['LICENSE', 'LICENSES.chromium.html']) {
        try {
            await copyFile(path.join(electronDist, candidate), path.join(targetDir, `Electron-${candidate.replace(/[^A-Za-z0-9.-]/g, '-')}`));
            electronChromiumNotices.push(`Electron-${candidate.replace(/[^A-Za-z0-9.-]/g, '-')}`);
        } catch (error) {
            missingElectronNotices.push(candidate);
        }
    }

    const missingLicenseTexts = await copyPackageLicenseTexts(entries);
    await copyFile(
        path.join(desktopDir, 'compliance', 'assets-rights.json'),
        path.join(targetDir, 'assets-rights.json')
    );

    const unknown = entries.filter(item => !item.license || item.license === 'UNKNOWN');
    const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        application: {name: 'Brickwright', license: 'GPL-3.0-only', rootLicenseFile: 'GPL-3.0.txt'},
        spiKeExtension: {name: 'Brickwright SPIKE extension', license: 'MPL-2.0', licenseFile: 'MPL-2.0.txt'},
        packages: entries,
        electronChromiumNotices,
        missingElectronNotices,
        unknownLicenseCount: unknown.length,
        unknownLicenses: unknown.map(item => `${item.name}@${item.version}`),
        missingLicenseTextCount: missingLicenseTexts.length,
        missingLicenseTexts
    };
    await writeFile(path.join(targetDir, 'THIRD_PARTY_LICENSES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const lines = [
        'Brickwright third-party license and attribution inventory',
        'Brickwright: GNU GPL version 3 (see GPL-3.0.txt).',
        'Brickwright SPIKE extension: Mozilla Public License 2.0 (see MPL-2.0.txt).',
        'Package license declarations below come from the installed package manifests and lockfiles. Individual license text files are under third-party/. UNKNOWN or missing notices are unresolved and block formal distribution.',
        ''
    ];
    for (const item of entries) {
        lines.push(`${item.name}@${item.version}`, `  License: ${item.license}`, `  Author: ${item.author || 'not declared'}`, `  Source: ${item.homepage || 'not declared'}`, '');
    }
    await writeFile(path.join(targetDir, 'THIRD_PARTY_LICENSES.txt'), `${lines.join('\n')}\n`);
    await writeFile(path.join(targetDir, 'ASSET_RIGHTS_STATUS.txt'),
        'Media rights are tracked in assets-rights.json. Every unverified entry blocks formal release.\n');
    console.log(`Generated notices for ${entries.length} packages; ${unknown.length} license declarations are UNKNOWN; ${missingLicenseTexts.length} packages have no discoverable license text.`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
