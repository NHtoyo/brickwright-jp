import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultInventoryPath = path.join(desktopDir, 'compliance', 'assets-rights.json');

const hasEvidenceReference = evidence => {
    if (typeof evidence === 'string') return evidence.trim().length > 0;
    if (!evidence || typeof evidence !== 'object') return false;
    return ['url', 'reference', 'path', 'source'].some(key =>
        typeof evidence[key] === 'string' && evidence[key].trim().length > 0);
};

export const inspectReleaseRights = inventory => {
    const assets = Array.isArray(inventory?.assets) ? inventory.assets : [];
    const localMedia = assets.filter(asset => asset.kind === 'application-media');
    const libraryReferences = assets.filter(asset => ['backdrop', 'costume', 'sound', 'asset'].includes(asset.kind));
    const distribution = inventory?.distributionReview;
    const mediaReview = distribution?.localApplicationMedia;
    const libraryReview = distribution?.externalLibraryReferences;
    const sourceEvidenceComplete = typeof distribution?.evidence === 'string' &&
        distribution.evidence.trim().length > 0 && mediaReview?.license === 'GPL-3.0-only' &&
        typeof mediaReview.licenseFile === 'string' && typeof mediaReview.upstreamLicenseFile === 'string';
    const mediaCoverageComplete = sourceEvidenceComplete && mediaReview.recordCount === localMedia.length &&
        mediaReview.uniqueHashes === new Set(localMedia.map(asset => asset.assetHash?.value).filter(Boolean)).size &&
        localMedia.every(asset => asset.path && asset.assetHash?.algorithm === 'SHA-256' && asset.assetHash.value);
    const externalReferencesComplete = libraryReview?.recordCount === libraryReferences.length &&
        libraryReview.localPayloadCount === 0 && libraryReferences.every(asset => !(asset.filePaths || []).length);
    const observedGroups = new Map();
    for (const asset of localMedia) {
        const group = observedGroups.get(asset.source) || {source: asset.source, recordCount: 0, hashes: new Set()};
        group.recordCount += 1;
        if (asset.assetHash?.value) group.hashes.add(asset.assetHash.value);
        observedGroups.set(asset.source, group);
    }
    const listedGroups = Array.isArray(mediaReview?.sourceGroups) ? mediaReview.sourceGroups : [];
    const listedGroupMap = new Map(listedGroups.map(group => [group.source, group]));
    const sourceGroupsComplete = listedGroups.length === observedGroups.size &&
        [...observedGroups.values()].every(group => {
            const listed = listedGroupMap.get(group.source);
            return listed?.recordCount === group.recordCount && listed?.uniqueHashes === group.hashes.size;
        });
    const unexplainedAssetKinds = assets.filter(asset =>
        asset.kind !== 'application-media' && !['backdrop', 'costume', 'sound', 'asset'].includes(asset.kind));
    const brandReview = inventory?.brandReview;
    const brandUnresolved = !brandReview || brandReview.status !== 'VERIFIED' ||
        !hasEvidenceReference(brandReview.evidence) || !brandReview.assetHash?.value;

    return {
        allowed: assets.length > 0 && mediaCoverageComplete && sourceGroupsComplete && externalReferencesComplete &&
            unexplainedAssetKinds.length === 0 && !brandUnresolved,
        totalAssets: assets.length,
        localMediaRecordCount: localMedia.length,
        externalLibraryReferenceCount: libraryReferences.length,
        localLibraryPayloadCount: libraryReview?.localPayloadCount ?? null,
        perAssetUnverifiedCount: assets.filter(asset => asset.rightsStatus === 'UNVERIFIED').length,
        mediaCoverageComplete,
        sourceGroupsComplete,
        externalReferencesComplete,
        unexplainedAssetKindCount: unexplainedAssetKinds.length,
        brandUnresolved,
        unresolvedExamples: [
            ...localMedia.filter(asset => !asset.path || !asset.assetHash?.value).slice(0, 5),
            ...unexplainedAssetKinds.slice(0, 5)
        ].map(asset => asset.path || asset.md5ext || asset.assetId || asset.kind)
    };
};

const main = async () => {
    const inventoryPath = process.argv[2] || defaultInventoryPath;
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    const result = inspectReleaseRights(inventory);
    if (!result.allowed) {
        console.error(JSON.stringify(result, null, 2));
        console.error('Release requires byte-hash and source-group coverage, non-bundled catalog references, and a documented brand review. Per-record UNVERIFIED tracking values alone do not block distribution.');
        process.exitCode = 1;
        return;
    }
    console.log(`Release rights inventory is complete for ${result.totalAssets} assets.`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
