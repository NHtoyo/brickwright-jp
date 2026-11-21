import {
    BUNDLED_SPIKE_BUILD_QUERY,
    BUNDLED_SPIKE_EXTENSION_PATH,
    getExtensionAssetURL,
    getExtensionGallerySource,
    getExtensionGallerySources,
    getExtensionResourceURL,
    identifyExtensionSource,
    isTrustedBundledSpikeExtensionURL,
    LOCAL_EXTENSION_BUILD_QUERY,
    NH_TOYO_DEV_EXTENSION_SOURCE_ID,
    ORIGINAL_EXTENSION_SOURCE_ID,
    filterStandardSpikeGalleryDuplicates,
    getStandardSpikeExtensionURL,
    isStandardSpikeExtensionId
} from '../../../src/lib/extension-gallery-sources';

describe('extension gallery sources', () => {
    test('keeps the original public gallery URLs in production', () => {
        const sources = getExtensionGallerySources(false, 'ignored');

        expect(sources).toHaveLength(1);
        expect(sources[0].id).toBe(ORIGINAL_EXTENSION_SOURCE_ID);
        expect(sources[0].metadataURL).toBe(
            'https://crispstrobe.github.io/extensions/generated-metadata/extensions-v0.json'
        );
        expect(getExtensionAssetURL(sources[0], 'CrispStrobe/spike.js')).toBe(
            'https://crispstrobe.github.io/extensions/CrispStrobe/spike.js'
        );
        expect(getExtensionResourceURL(sources[0], 'samples/basic.sb3')).toBe(
            'https://crispstrobe.github.io/extensions/samples/basic.sb3'
        );
    });

    test('keeps the separate local development gallery for non-SPIKE extensions', () => {
        const sources = getExtensionGallerySources(true, 'session-123');
        const local = getExtensionGallerySource(sources, NH_TOYO_DEV_EXTENSION_SOURCE_ID);
        const assetURL = new URL(getExtensionAssetURL(local, 'CrispStrobe/spike.js'));

        expect(sources.map(source => source.id)).toEqual([
            ORIGINAL_EXTENSION_SOURCE_ID,
            NH_TOYO_DEV_EXTENSION_SOURCE_ID
        ]);
        expect(local.metadataURL).toBe(
            'http://localhost:8000/generated-metadata/extensions-v0.json'
        );
        expect(assetURL.origin).toBe('http://localhost:8000');
        expect(assetURL.searchParams.get(LOCAL_EXTENSION_BUILD_QUERY)).toBe('session-123');
    });

    test('uses the same-origin bundled SPIKE source in development and production', () => {
        const developmentURL = new URL(getStandardSpikeExtensionURL('dev-build'));
        const productionURL = new URL(getStandardSpikeExtensionURL('prod-build'));

        expect(developmentURL.origin).toBe(window.location.origin);
        expect(productionURL.origin).toBe(window.location.origin);
        expect(developmentURL.pathname).toBe(BUNDLED_SPIKE_EXTENSION_PATH);
        expect(productionURL.pathname).toBe(BUNDLED_SPIKE_EXTENSION_PATH);
        expect(developmentURL.searchParams.get(BUNDLED_SPIKE_BUILD_QUERY)).toBe('dev-build');
        expect(productionURL.searchParams.get(BUNDLED_SPIKE_BUILD_QUERY)).toBe('prod-build');
        expect(developmentURL.href).not.toContain('cdn.jsdelivr.net');
        expect(developmentURL.href).not.toContain('localhost:8000');

        expect(identifyExtensionSource(developmentURL.href)).toEqual({
            id: 'brickwright-bundled',
            label: 'Brickwright bundled SPIKE extension',
            assetPath: BUNDLED_SPIKE_EXTENSION_PATH,
            buildId: 'dev-build'
        });
    });

    test('trusts only the exact bundled source for the current application build', () => {
        const bundledURL = getStandardSpikeExtensionURL();
        expect(isTrustedBundledSpikeExtensionURL(bundledURL)).toBe(true);
        expect(isTrustedBundledSpikeExtensionURL(`${bundledURL}&other=1`)).toBe(false);
        expect(isTrustedBundledSpikeExtensionURL(
            bundledURL.replace(BUNDLED_SPIKE_EXTENSION_PATH, '/extensions/other.js')
        )).toBe(false);
        expect(isTrustedBundledSpikeExtensionURL(
            bundledURL.replace(window.location.origin, 'https://other.invalid')
        )).toBe(false);
    });

    test('filters gallery duplicates while keeping the Scratch extension ID', () => {
        expect(isStandardSpikeExtensionId('spikeprime')).toBe(true);
        expect(isStandardSpikeExtensionId('legospike_turbowarp_transpile')).toBe(false);
        expect(filterStandardSpikeGalleryDuplicates([
            {extensionId: 'spikeprime'},
            {extensionId: 'microbit'},
            '---'
        ])).toEqual([{extensionId: 'microbit'}, '---']);
    });
});
