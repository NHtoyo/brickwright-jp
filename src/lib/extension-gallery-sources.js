export const EXTENSION_GALLERY_SOURCE_STORAGE_KEY =
    'brickwright.extension-gallery-source';
export const ORIGINAL_EXTENSION_SOURCE_ID = 'crispstrobe';
export const NH_TOYO_DEV_EXTENSION_SOURCE_ID = 'nhtoyo-development';
export const LOCAL_EXTENSION_BUILD_QUERY = 'bwDevBuild';
export const BUNDLED_SPIKE_EXTENSION_PATH =
    '/extensions/CrispStrobe/legospike_turbowarp_transpile.js';
export const BUNDLED_SPIKE_BUILD_QUERY = 'bwSpikeBuild';
export const STANDARD_SPIKE_EXTENSION_ID = 'spikeprime';

const ORIGINAL_EXTENSION_BASE_URL = 'https://crispstrobe.github.io/extensions/';
const LOCAL_EXTENSION_BASE_URL = 'http://localhost:8000/';

const getBrickwrightBaseURL = () => {
    const root = typeof process.env.ROOT === 'string' ? process.env.ROOT : '';
    const origin = typeof window !== 'undefined' && window.location ?
        window.location.origin : 'http://localhost';
    return new URL(root || '/', origin);
};

export const getStandardSpikeExtensionURL = (
    buildId = process.env.BRICKWRIGHT_SPIKE_BUILD_ID || 'source'
) => {
    // The extension is copied from this repository's static tree into every
    // Brickwright build. Resolving it against the editor origin keeps both
    // development and production on the same source and avoids external hosts.
    const url = new URL(BUNDLED_SPIKE_EXTENSION_PATH.slice(1), getBrickwrightBaseURL());
    url.searchParams.set(BUNDLED_SPIKE_BUILD_QUERY, String(buildId));
    return url.href;
};

export const isStandardSpikeExtensionId = extensionId =>
    extensionId === STANDARD_SPIKE_EXTENSION_ID;

export const filterStandardSpikeGalleryDuplicates = items =>
    items.filter(item => !(
        item && typeof item === 'object' &&
        isStandardSpikeExtensionId(item.extensionId)
    ));

export const getExtensionGallerySources = (isDevelopment, buildId) => {
    const original = {
        id: ORIGINAL_EXTENSION_SOURCE_ID,
        baseURL: ORIGINAL_EXTENSION_BASE_URL,
        metadataURL: `${ORIGINAL_EXTENSION_BASE_URL}generated-metadata/extensions-v0.json`,
        isDevelopment: false
    };
    if (!isDevelopment) return [original];

    const localDevelopment = {
        id: NH_TOYO_DEV_EXTENSION_SOURCE_ID,
        baseURL: LOCAL_EXTENSION_BASE_URL,
        metadataURL: `${LOCAL_EXTENSION_BASE_URL}generated-metadata/extensions-v0.json`,
        buildId: String(buildId),
        isDevelopment: true
    };
    return [original, localDevelopment];
};

export const getExtensionGallerySource = (sources, sourceId) =>
    sources.find(source => source.id === sourceId) || sources[0];

export const getExtensionAssetURL = (
    source,
    assetPath,
    buildId = source.buildId
) => {
    const url = new URL(assetPath.replace(/^\//, ''), source.baseURL);
    if (source.isDevelopment) {
        url.searchParams.set(LOCAL_EXTENSION_BUILD_QUERY, String(buildId));
    }
    return url.href;
};

export const getExtensionResourceURL = (source, resourcePath) =>
    new URL(resourcePath.replace(/^\//, ''), source.baseURL).href;

export const identifyExtensionSource = url => {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return {
            id: 'unknown',
            label: url || 'unknown source',
            assetPath: null,
            buildId: null
        };
    }

    const bundledURL = new URL(getStandardSpikeExtensionURL());
    if (
        parsed.origin === bundledURL.origin &&
        parsed.pathname === bundledURL.pathname &&
        parsed.searchParams.has(BUNDLED_SPIKE_BUILD_QUERY)
    ) {
        return {
            id: 'brickwright-bundled',
            label: 'Brickwright bundled SPIKE extension',
            assetPath: parsed.pathname,
            buildId: parsed.searchParams.get(BUNDLED_SPIKE_BUILD_QUERY)
        };
    }
    if (parsed.origin === 'http://localhost:8000') {
        return {
            id: NH_TOYO_DEV_EXTENSION_SOURCE_ID,
            label: 'NHtoyo development server',
            assetPath: parsed.pathname,
            buildId: parsed.searchParams.get(LOCAL_EXTENSION_BUILD_QUERY)
        };
    }
    if (
        parsed.origin === 'https://crispstrobe.github.io' &&
        parsed.pathname.startsWith('/extensions/')
    ) {
        return {
            id: ORIGINAL_EXTENSION_SOURCE_ID,
            label: 'CrispStrobe extensions',
            assetPath: parsed.pathname,
            buildId: null
        };
    }
    return {
        id: 'unknown',
        label: `${parsed.origin}${parsed.pathname}`,
        assetPath: parsed.pathname,
        buildId: parsed.searchParams.get(LOCAL_EXTENSION_BUILD_QUERY)
    };
};

export const isTrustedBundledSpikeExtensionURL = url => {
    try {
        const expected = new URL(getStandardSpikeExtensionURL());
        const parsed = new URL(url, expected.origin);
        return parsed.href === expected.href &&
            parsed.origin === expected.origin &&
            parsed.pathname === expected.pathname &&
            parsed.protocol === expected.protocol;
    } catch (error) {
        return false;
    }
};
