export const EXTENSION_GALLERY_SOURCE_STORAGE_KEY =
    'brickwright.extension-gallery-source';
export const ORIGINAL_EXTENSION_SOURCE_ID = 'crispstrobe';
export const NH_TOYO_DEV_EXTENSION_SOURCE_ID = 'nhtoyo-development';
export const LOCAL_SPIKE_EXTENSION_PATH =
    '/CrispStrobe/legospike_turbowarp_transpile.js';
export const LOCAL_EXTENSION_BUILD_QUERY = 'bwDevBuild';

const ORIGINAL_EXTENSION_BASE_URL = 'https://crispstrobe.github.io/extensions/';
const LOCAL_EXTENSION_BASE_URL = 'http://localhost:8000/';

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

export const isTrustedLocalSpikeDevelopmentURL = (
    url,
    nodeEnvironment = process.env.NODE_ENV
) => {
    if (nodeEnvironment !== 'development') return false;
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === 'http:' &&
            parsed.hostname === 'localhost' &&
            parsed.port === '8000' &&
            parsed.pathname === LOCAL_SPIKE_EXTENSION_PATH &&
            parsed.username === '' &&
            parsed.password === '' &&
            parsed.hash === '' &&
            parsed.searchParams.get(LOCAL_EXTENSION_BUILD_QUERY) !== null &&
            [...parsed.searchParams.keys()].every(key => key === LOCAL_EXTENSION_BUILD_QUERY)
        );
    } catch (error) {
        return false;
    }
};
