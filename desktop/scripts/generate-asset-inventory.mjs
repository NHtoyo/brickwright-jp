import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetIdentity, isRightsEvidenceExpired, reuseRightsForUnchangedAsset} from './asset-rights-inventory.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const mediaExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.m4a',
    '.woff', '.woff2', '.ttf', '.otf'
]);
const assets = new Map();
const mediaByMd5 = new Map();

const add = (key, record) => {
    if (!assets.has(key)) {
        assets.set(key, record);
        return;
    }
    const current = assets.get(key);
    current.references = [...new Set([...(current.references || []), ...(record.references || [])])];
    current.filePaths = [...new Set([...(current.filePaths || []), ...(record.filePaths || [])])].sort();
};

const addLibraryFile = async fileName => {
    const items = JSON.parse(await readFile(path.join(repoRoot, 'src', 'lib', 'libraries', fileName), 'utf8'));
    for (const item of items) {
        const collections = [];
        if (Array.isArray(item.costumes)) collections.push(['costume', item.costumes]);
        if (Array.isArray(item.sounds)) collections.push(['sound', item.sounds]);
        if (item.md5ext) {
            collections.push([fileName.startsWith('backdrops') ? 'backdrop' :
                fileName.startsWith('sounds') ? 'sound' : 'asset', [item]]);
        }
        for (const [kind, entries] of collections) {
            for (const entry of entries) {
                const assetId = entry.assetId || (entry.md5ext || '').split('.')[0];
                const md5ext = entry.md5ext || null;
                if (!assetId && !md5ext) continue;
                const key = `${kind}:${md5ext || assetId}`;
                const contentMd5 = (md5ext || assetId).split('.')[0].toLowerCase();
                const linkedFiles = mediaByMd5.get(contentMd5) || [];
                const linkedHash = linkedFiles.length ? linkedFiles[0].assetHash :
                    /^[a-f0-9]{32}$/.test(contentMd5) ? {
                        algorithm: 'MD5', value: contentMd5, basis: 'library-asset-identifier'
                    } : null;
                add(key, {
                    kind,
                    assetId: assetId || null,
                    md5ext,
                    name: entry.name || item.name || null,
                    source: `src/lib/libraries/${fileName}`,
                    references: [item.name].filter(Boolean),
                    filePaths: linkedFiles.map(file => file.path).sort(),
                    assetHash: linkedHash
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
        if (entry.isDirectory()) {
            await walkMedia(absolute, relative);
        } else if (entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
            const bytes = await readFile(absolute);
            const contentMd5 = createHash('md5').update(bytes)
                .digest('hex');
            const assetHash = {algorithm: 'SHA-256',
                value: createHash('sha256').update(bytes)
                    .digest('hex'),
                basis: 'file-bytes'};
            const record = {kind: 'application-media', path: relative, source: relativeBase, assetHash};
            add(`file:${relative}`, record);
            const matching = mediaByMd5.get(contentMd5) || [];
            matching.push({path: relative, assetHash});
            mediaByMd5.set(contentMd5, matching);
        }
    }
};

const readPreviousInventory = async output => {
    try {
        return JSON.parse(await readFile(output, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {assets: []};
        throw error;
    }
};

const main = async () => {
    const output = path.join(desktopDir, 'compliance', 'assets-rights.json');
    const previous = await readPreviousInventory(output);
    await walkMedia(path.join(repoRoot, 'static'), 'static');
    await walkMedia(path.join(repoRoot, 'src'), 'src');
    await Promise.all(['sprites.json', 'backdrops.json', 'sounds.json'].map(addLibraryFile));

    const previousByIdentity = new Map((previous.assets || [])
        .map(asset => [assetIdentity(asset), asset])
        .filter(([identity]) => identity));
    const records = [...assets.values()]
        .map(record => reuseRightsForUnchangedAsset(record, previousByIdentity.get(assetIdentity(record))))
        .sort((a, b) => {
            const aKey = `${a.kind}:${a.md5ext || a.path || a.assetId}`;
            const bKey = `${b.kind}:${b.md5ext || b.path || b.assetId}`;
            return aKey.localeCompare(bKey);
        });
    const unverifiedCount = records.filter(asset => asset.rightsStatus === 'UNVERIFIED').length;
    const localMedia = records.filter(asset => asset.kind === 'application-media');
    const libraryReferences = records.filter(asset => asset.kind !== 'application-media');
    const libraryLocalPayloads = libraryReferences.filter(asset => (asset.filePaths || []).length > 0);
    const mediaSourceGroups = new Map();
    for (const asset of localMedia) {
        const group = mediaSourceGroups.get(asset.source) || {
            source: asset.source, recordCount: 0, uniqueHashes: new Set()
        };
        group.recordCount += 1;
        if (asset.assetHash?.value) group.uniqueHashes.add(asset.assetHash.value);
        mediaSourceGroups.set(asset.source, group);
    }
    const appIconHash = records.find(asset => asset.path === 'static/images/apple-touch-icon.png')?.assetHash || null;
    const previousBrandReview = previous.brandReview || {};
    const unchangedBrandAsset = appIconHash?.algorithm &&
        appIconHash.algorithm === previousBrandReview.assetHash?.algorithm &&
        appIconHash.value === previousBrandReview.assetHash?.value;
    const brandEvidenceExpired = isRightsEvidenceExpired(previousBrandReview);
    const document = {
        schemaVersion: 2,
        generatedBy: 'desktop/scripts/generate-asset-inventory.mjs',
        rightsStatuses: ['VERIFIED', 'UNVERIFIED', 'EXCLUDED'],
        defaultRightsStatus: 'UNVERIFIED',
        brandReview: {
            ...(unchangedBrandAsset && !brandEvidenceExpired ? previousBrandReview : {}),
            status: unchangedBrandAsset && !brandEvidenceExpired ? previousBrandReview.status : 'UNVERIFIED',
            appIcon: 'static/images/apple-touch-icon.png',
            assetHash: appIconHash,
            evidence: unchangedBrandAsset && !brandEvidenceExpired ? previousBrandReview.evidence || null : null
        },
        distributionReview: {
            reviewedAt: new Date().toISOString()
                .slice(0, 10),
            evidence: 'desktop/compliance/asset-distribution-review.md',
            localApplicationMedia: {
                recordCount: localMedia.length,
                uniqueHashes: new Set(localMedia.map(asset => asset.assetHash?.value).filter(Boolean)).size,
                license: 'GPL-3.0-only',
                licenseFile: 'LICENSE',
                upstreamLicenseFile: 'desktop/licenses/Scratch-GUI-BSD-3-Clause.txt',
                sourceGroups: [...mediaSourceGroups.values()].map(group => ({
                    source: group.source,
                    recordCount: group.recordCount,
                    uniqueHashes: group.uniqueHashes.size
                })).sort((a, b) => a.source.localeCompare(b.source))
            },
            externalLibraryReferences: {
                recordCount: libraryReferences.length,
                localPayloadCount: libraryLocalPayloads.length,
                sourceFiles: [...new Set(libraryReferences.map(asset => asset.source))].sort(),
                note: [
                    'Library entries contain external asset IDs and do not bundle the referenced',
                    'image/audio payloads.'
                ].join(' ')
            }
        },
        note: [
            'UNVERIFIED is a per-record tracking field, not a finding of infringement or a standalone release blocker.',
            'Distribution is reviewed by source/license groups in distributionReview.'
        ].join(' '),
        assets: records
    };
    await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
    console.log(
        `Recorded ${records.length} assets; ${unverifiedCount} are UNVERIFIED. ` +
        'Matching local library files are listed in filePaths.'
    );
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
