const RIGHTS_FIELDS = [
    'rightsStatus',
    'rightsHolder',
    'license',
    'evidence',
    'rightsReviewedAt',
    'reviewExpiresAt',
    'attribution',
    'exclusionReason',
    'upstreamSource',
    'upstreamSources'
];

export const assetIdentity = record => {
    const stable = record.path || record.md5ext || record.assetId;
    return stable ? `${record.kind}:${stable}` : null;
};

const hasSameAssetHash = (current, previous) => Boolean(
    current?.assetHash?.algorithm &&
    current.assetHash.value &&
    current.assetHash.algorithm === previous?.assetHash?.algorithm &&
    current.assetHash.value === previous.assetHash.value
);

export const isRightsEvidenceExpired = (record, now = Date.now()) => {
    const expiresAt = record?.reviewExpiresAt || record?.evidence?.expiresAt;
    if (!expiresAt) return false;
    const expiry = Date.parse(expiresAt);
    return !Number.isFinite(expiry) || expiry <= now;
};

export const reuseRightsForUnchangedAsset = (current, previous, now = Date.now()) => {
    if (!previous || !hasSameAssetHash(current, previous) || isRightsEvidenceExpired(previous, now)) {
        return {
            ...current,
            rightsStatus: 'UNVERIFIED',
            rightsHolder: null,
            license: null,
            evidence: null,
            rightsReviewedAt: null,
            reviewExpiresAt: null,
            attribution: null,
            exclusionReason: null
        };
    }

    const retained = {};
    for (const field of RIGHTS_FIELDS) {
        if (Object.hasOwn(previous, field)) retained[field] = previous[field];
    }
    return {...current, ...retained};
};
