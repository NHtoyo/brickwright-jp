import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const outputDir = path.join(desktopDir, 'dist');

const main = async () => {
    const info = JSON.parse(await readFile(path.join(desktopDir, 'build', 'build-info.json'), 'utf8'));
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(info.version)) {
        throw new Error('A staged build with a valid SemVer version is required before archiving source.');
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repoRoot, encoding: 'utf8'}).trim();
    if (commit !== info.commit) throw new Error(`Staged build commit ${info.commit} does not match source commit ${commit}.`);
    await mkdir(outputDir, {recursive: true});
    const tag = `v${info.version}`;
    const archiveName = `Brickwright-${info.version}-source.tar.gz`;
    const archivePath = path.join(outputDir, archiveName);
    execFileSync('git', ['archive', '--format=tar.gz', `--prefix=Brickwright-${tag}/`, '-o', archivePath, commit], {cwd: repoRoot, stdio: 'inherit'});
    const archive = await readFile(archivePath);
    const manifest = {
        application: 'Brickwright',
        version: info.version,
        commit,
        branch: info.branch,
        buildNumber: info.buildNumber,
        archive: archiveName,
        sha256: createHash('sha256').update(archive).digest('hex')
    };
    await writeFile(path.join(outputDir, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Created ${archiveName} for ${commit}.`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
