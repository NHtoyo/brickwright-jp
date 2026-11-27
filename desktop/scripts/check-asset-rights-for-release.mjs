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
    const resolvedStatuses = new Set(['VERIFIED', 'EXCLUDED']);
    const unresolved = assets.filter(asset => !resolvedStatuses.has(asset.rightsStatus));
    const incompleteVerified = assets.filter(asset => asset.rightsStatus === 'VERIFIED' &&
        (!asset.rightsHolder?.trim() || !asset.license?.trim() || !hasEvidenceReference(asset.evidence)));
    const incompleteExcluded = assets.filter(asset => asset.rightsStatus === 'EXCLUDED' && !asset.exclusionReason?.trim());
    const brandReview = inventory?.brandReview;
    const brandUnresolved = !brandReview || !resolvedStatuses.has(brandReview.status) ||
        (brandReview.status === 'VERIFIED' && !hasEvidenceReference(brandReview.evidence)) ||
        (brandReview.status === 'EXCLUDED' && !brandReview.exclusionReason?.trim());

    return {
        allowed: assets.length > 0 && unresolved.length === 0 && incompleteVerified.length === 0 &&
            incompleteExcluded.length === 0 && !brandUnresolved,
        totalAssets: assets.length,
        unresolvedCount: unresolved.length,
        incompleteVerifiedCount: incompleteVerified.length,
        incompleteExcludedCount: incompleteExcluded.length,
        brandUnresolved,
        unresolvedExamples: unresolved.slice(0, 10).map(asset => asset.path || asset.md5ext || asset.assetId || asset.kind)
    };
};

const main = async () => {
    const inventoryPath = process.argv[2] || defaultInventoryPath;
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    const result = inspectReleaseRights(inventory);
    if (!result.allowed) {
        console.error(JSON.stringify(result, null, 2));
        console.error('UNVERIFIED means rights evidence is missing; it is not a finding of infringement. Do not publish until the asset records and brand review are resolved.');
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
