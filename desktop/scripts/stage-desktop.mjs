import {cp, mkdir, readFile, rm, writeFile, access, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const destination = path.join(desktopDir, 'build');

const argValue = name => {
    const prefix = `${name}=`;
    const arg = process.argv.find(value => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
};

const buildType = argValue('--build-type') || process.env.BRICKWRIGHT_BUILD_TYPE || 'development';
const platform = argValue('--platform') || process.env.BRICKWRIGHT_BUILD_PLATFORM || process.platform;
const buildNumber = argValue('--build-number') || process.env.GITHUB_RUN_NUMBER || 'local';
if (!['development', 'release'].includes(buildType)) throw new Error(`Invalid build type: ${buildType}`);

const safeReplace = async target => {
    const resolved = path.resolve(target);
    if (resolved !== destination || !resolved.startsWith(`${desktopDir}${path.sep}`)) {
        throw new Error(`Refusing to replace unexpected desktop staging path: ${resolved}`);
    }
    await rm(resolved, {recursive: true, force: true});
};

const readGit = args => {
    try {
        return execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8'}).trim();
    } catch (error) {
        return 'unknown';
    }
};

const hashFile = async file => {
    const hash = createHash('sha256');
    hash.update(await readFile(file));
    return hash.digest('hex');
};

const hashDirectory = async directory => {
    const hash = createHash('sha256');
    const visit = async (current, relative = '') => {
        const entries = (await readdir(current, {withFileTypes: true})).sort((a, b) => {
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });
        for (const entry of entries) {
            const child = path.join(current, entry.name);
            const childRelative = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
            if (entry.isDirectory()) await visit(child, childRelative);
            else if (entry.isFile() && childRelative !== 'build-info.json') {
                hash.update(childRelative);
                hash.update('\0');
                hash.update(await readFile(child));
                hash.update('\0');
            }
        }
    };
    await visit(directory);
    return hash.digest('hex');
};

const main = async () => {
    await Promise.all([
        access(path.join(repoRoot, 'build', 'editor.html')),
        access(path.join(repoRoot, 'build', 'extensions', 'CrispStrobe', 'legospike_turbowarp_transpile.js'))
    ]);
    await safeReplace(destination);
    await mkdir(destination, {recursive: true});
    await cp(path.join(repoRoot, 'build'), destination, {recursive: true});
    const desktopPages = path.join(destination, 'desktop');
    await mkdir(desktopPages, {recursive: true});
    for (const name of ['about.html', 'bluetooth-selector.html', 'bluetooth-selector.js']) {
        await cp(path.join(desktopDir, name), path.join(desktopPages, name));
    }
    const branch = process.env.GITHUB_REF_NAME || readGit(['branch', '--show-current']);
    const commit = process.env.BRICKWRIGHT_BUILD_COMMIT || process.env.GITHUB_SHA || readGit(['rev-parse', 'HEAD']);
    const versionBase = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8')).version;
    const releaseVersion = String(process.env.BRICKWRIGHT_RELEASE_VERSION || versionBase).replace(/^v/, '');
    if (buildType === 'release' && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
        throw new Error(`Release version must be SemVer: ${releaseVersion}`);
    }
    const version = buildType === 'release' ?
        releaseVersion :
        `${versionBase}-dev.${String(buildNumber).replace(/[^0-9A-Za-z.-]/g, '-')}`;
    const [webBuildHash, spikeExtensionHash, scratchVMPatchHash] = await Promise.all([
        hashDirectory(destination),
        hashFile(path.join(destination, 'extensions', 'CrispStrobe', 'legospike_turbowarp_transpile.js')),
        hashFile(path.join(repoRoot, 'patches', 'scratch-vm+2.1.46.patch'))
    ]);
    const electronPackage = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8'));
    const info = {
        application: 'Brickwright',
        version,
        commit,
        branch,
        buildNumber: String(buildNumber),
        platform,
        architecture: platform === 'darwin-universal' ? 'universal' : platform === 'win32' ? 'x64' : process.arch,
        buildType,
        builtAt: new Date().toISOString(),
        electronVersion: electronPackage.devDependencies.electron,
        webBuildHash,
        spikeExtensionHash,
        scratchVMPatchId: `scratch-vm@2.1.46+sha256:${scratchVMPatchHash}`
    };
    await writeFile(path.join(destination, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
    console.log(`Staged Brickwright ${version} (${commit}, ${platform}, ${buildType}).`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
