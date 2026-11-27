const assert = require('node:assert/strict');
const test = require('node:test');

const inventory = import('../scripts/asset-rights-inventory.mjs');

test('unchanged asset hashes retain rights, license, evidence, and attribution', async () => {
    const {reuseRightsForUnchangedAsset} = await inventory;
    const previous = {
        kind: 'application-media',
        path: 'static/example.svg',
        assetHash: {algorithm: 'SHA-256', value: 'same'},
        rightsStatus: 'VERIFIED',
        rightsHolder: 'Original author',
        license: 'CC-BY-4.0',
        evidence: {url: 'https://example.test/license'},
        rightsReviewedAt: '2026-11-01',
        attribution: 'Original author',
        upstreamSource: {repository: 'https://github.com/example/assets', revision: 'abc123'}
    };
    const current = {
        kind: previous.kind,
        path: previous.path,
        assetHash: {...previous.assetHash},
        source: 'static'
    };
    assert.deepEqual(reuseRightsForUnchangedAsset(current, previous), {
        ...current,
        rightsStatus: 'VERIFIED',
        rightsHolder: 'Original author',
        license: 'CC-BY-4.0',
        evidence: {url: 'https://example.test/license'},
        rightsReviewedAt: '2026-11-01',
        attribution: 'Original author',
        upstreamSource: {repository: 'https://github.com/example/assets', revision: 'abc123'}
    });
});

test('changed, unhashed, expired, and malformed expiry evidence return to UNVERIFIED', async () => {
    const {reuseRightsForUnchangedAsset} = await inventory;
    const previous = {
        rightsStatus: 'VERIFIED',
        rightsHolder: 'Author',
        license: 'MIT',
        evidence: {url: 'https://example.test/license'},
        assetHash: {algorithm: 'SHA-256', value: 'old'}
    };
    const base = {kind: 'application-media', path: 'static/example.svg'};
    assert.equal(reuseRightsForUnchangedAsset({...base, assetHash: {algorithm: 'SHA-256', value: 'new'}}, previous).rightsStatus, 'UNVERIFIED');
    assert.equal(reuseRightsForUnchangedAsset({...base, assetHash: null}, previous).rightsStatus, 'UNVERIFIED');
    assert.equal(reuseRightsForUnchangedAsset({
        ...base,
        assetHash: previous.assetHash
    }, {...previous, reviewExpiresAt: '2026-01-01'}, Date.parse('2026-11-01')).rightsStatus, 'UNVERIFIED');
    assert.equal(reuseRightsForUnchangedAsset({
        ...base,
        assetHash: previous.assetHash
    }, {...previous, evidence: {expiresAt: 'not-a-date'}}, Date.parse('2026-11-01')).rightsStatus, 'UNVERIFIED');
});

test('library registration identity maps by its content-addressed asset name', async () => {
    const {assetIdentity} = await inventory;
    assert.equal(assetIdentity({kind: 'costume', md5ext: '0123456789abcdef0123456789abcdef.svg', assetId: 'ignored'}),
        'costume:0123456789abcdef0123456789abcdef.svg');
});

test('release rights check allows documented scope while retaining per-file UNVERIFIED tracking', async () => {
    const {inspectReleaseRights} = await import('../scripts/check-asset-rights-for-release.mjs');
    const result = inspectReleaseRights({
        assets: [{kind: 'application-media', path: 'static/example.svg', source: 'static', assetHash: {algorithm: 'SHA-256', value: 'a'}, rightsStatus: 'UNVERIFIED'}],
        distributionReview: {
            evidence: 'desktop/compliance/asset-distribution-review.md',
            localApplicationMedia: {recordCount: 1, uniqueHashes: 1, license: 'GPL-3.0-only', licenseFile: 'LICENSE', upstreamLicenseFile: 'desktop/licenses/Scratch-GUI-BSD-3-Clause.txt', sourceGroups: [{source: 'static', recordCount: 1, uniqueHashes: 1}]},
            externalLibraryReferences: {recordCount: 0, localPayloadCount: 0}
        },
        brandReview: {status: 'VERIFIED', evidence: {url: 'https://example.test/review'}, assetHash: {value: 'icon'}}
    });
    assert.equal(result.allowed, true);
    assert.equal(result.perAssetUnverifiedCount, 1);
    assert.equal(result.mediaCoverageComplete, true);
    assert.equal(result.brandUnresolved, false);
});

test('release rights check uses grouped license evidence instead of individual UNVERIFIED counts', async () => {
    const {inspectReleaseRights} = await import('../scripts/check-asset-rights-for-release.mjs');
    const result = inspectReleaseRights({
        assets: [
            {kind: 'application-media', path: 'static/allowed.svg', source: 'static', assetHash: {algorithm: 'SHA-256', value: 'a'}, rightsStatus: 'UNVERIFIED'}
        ],
        distributionReview: {
            evidence: 'desktop/compliance/asset-distribution-review.md',
            localApplicationMedia: {recordCount: 1, uniqueHashes: 1, license: 'GPL-3.0-only', licenseFile: 'LICENSE', upstreamLicenseFile: 'desktop/licenses/Scratch-GUI-BSD-3-Clause.txt', sourceGroups: [{source: 'static', recordCount: 1, uniqueHashes: 1}]},
            externalLibraryReferences: {recordCount: 0, localPayloadCount: 0}
        },
        brandReview: {status: 'VERIFIED', evidence: {url: 'https://example.test/review'}, assetHash: {value: 'icon'}}
    });
    assert.equal(result.allowed, true);
    assert.equal(result.perAssetUnverifiedCount, 1);
});

test('release rights check fails closed for unknown statuses and evidence without references', async () => {
    const {inspectReleaseRights} = await import('../scripts/check-asset-rights-for-release.mjs');
    const result = inspectReleaseRights({
        assets: [
            {kind: 'application-media', path: 'static/unknown.svg', source: 'static', assetHash: {algorithm: 'SHA-256', value: 'a'}, rightsStatus: 'UNVERIFIED'},
            {kind: 'sprite', md5ext: 'asset.png', filePaths: []}
        ],
        distributionReview: {
            evidence: 'desktop/compliance/asset-distribution-review.md',
            localApplicationMedia: {recordCount: 1, uniqueHashes: 1, license: 'GPL-3.0-only', licenseFile: 'LICENSE', upstreamLicenseFile: 'desktop/licenses/Scratch-GUI-BSD-3-Clause.txt', sourceGroups: [{source: 'static', recordCount: 1, uniqueHashes: 1}]},
            externalLibraryReferences: {recordCount: 1, localPayloadCount: 0}
        },
        brandReview: {status: 'VERIFIED', evidence: {url: 'https://example.test/review'}, assetHash: {value: 'icon'}}
    });
    assert.equal(result.allowed, false);
    assert.equal(result.unexplainedAssetKindCount, 1);
});
