import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.m4a', '.woff', '.woff2', '.ttf', '.otf']);
const assets = new Map();

const add = (key, record) => {
    if (!assets.has(key)) assets.set(key, {
        ...record,
        rightsStatus: 'UNVERIFIED',
        rightsHolder: null,
        license: null,
        evidence: null
    });
    else {
        const current = assets.get(key);
        current.references = [...new Set([...(current.references || []), ...(record.references || [])])];
    }
};

const addLibraryFile = async fileName => {
    const items = JSON.parse(await readFile(path.join(repoRoot, 'src', 'lib', 'libraries', fileName), 'utf8'));
    for (const item of items) {
        const collections = [];
        if (Array.isArray(item.costumes)) collections.push(['costume', item.costumes]);
        if (Array.isArray(item.sounds)) collections.push(['sound', item.sounds]);
        if (item.md5ext) collections.push([fileName.startsWith('backdrops') ? 'backdrop' :
            fileName.startsWith('sounds') ? 'sound' : 'asset', [item]]);
        for (const [kind, entries] of collections) {
            for (const entry of entries) {
                const assetId = entry.assetId || (entry.md5ext || '').split('.')[0];
                const md5ext = entry.md5ext || null;
                if (!assetId && !md5ext) continue;
                const key = `${kind}:${md5ext || assetId}`;
                add(key, {
                    kind,
                    assetId: assetId || null,
                    md5ext,
                    name: entry.name || item.name || null,
                    source: `src/lib/libraries/${fileName}`,
                    references: [item.name].filter(Boolean)
                });
            }
        }
    }
};

const walkMedia = async (root, relativeBase) => {
    let entries;
    try {
        entries = await readdir(root, {withFileTypes: true});
    } catch (error) {
        return;
    }
    for (const entry of entries) {
        const absolute = path.join(root, entry.name);
        const relative = path.posix.join(relativeBase, entry.name.replace(/\\/g, '/'));
        if (entry.isDirectory()) await walkMedia(absolute, relative);
        else if (entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
            add(`file:${relative}`, {kind: 'application-media', path: relative, source: relativeBase});
        }
    }
};

const main = async () => {
    await Promise.all(['sprites.json', 'backdrops.json', 'sounds.json'].map(addLibraryFile));
    await walkMedia(path.join(repoRoot, 'static'), 'static');
    await walkMedia(path.join(repoRoot, 'src'), 'src');
    const records = [...assets.values()].sort((a, b) => `${a.kind}:${a.md5ext || a.path || a.assetId}`.localeCompare(`${b.kind}:${b.md5ext || b.path || b.assetId}`));
    const document = {
        schemaVersion: 1,
        generatedBy: 'desktop/scripts/generate-asset-inventory.mjs',
        rightsStatuses: ['VERIFIED', 'UNVERIFIED', 'EXCLUDED'],
        defaultRightsStatus: 'UNVERIFIED',
        brandReview: {
            status: 'UNVERIFIED',
            appIcon: 'static/images/apple-touch-icon.png',
            evidence: null
        },
        note: 'Unverified means distribution rights have not been recorded. Formal release is blocked while any unverified item is included.',
        assets: records
    };
    const output = path.join(desktopDir, 'compliance', 'assets-rights.json');
    await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`Recorded ${records.length} assets; ${records.filter(asset => asset.rightsStatus === 'UNVERIFIED').length} are UNVERIFIED.`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
