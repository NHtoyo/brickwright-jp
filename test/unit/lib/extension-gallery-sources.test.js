import {
    getExtensionAssetURL,
    getExtensionGallerySource,
    getExtensionGallerySources,
    getExtensionResourceURL,
    identifyExtensionSource,
    isTrustedLocalSpikeDevelopmentURL,
    LOCAL_EXTENSION_BUILD_QUERY,
    NH_TOYO_DEV_EXTENSION_SOURCE_ID,
    ORIGINAL_EXTENSION_SOURCE_ID
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

    test('adds the local development source and a per-session cache key', () => {
        const sources = getExtensionGallerySources(true, 'session-123');
        const local = getExtensionGallerySource(
            sources,
            NH_TOYO_DEV_EXTENSION_SOURCE_ID
        );
        const assetURL = new URL(
            getExtensionAssetURL(local, 'CrispStrobe/spike.js')
        );

        expect(sources.map(source => source.id)).toEqual([
            ORIGINAL_EXTENSION_SOURCE_ID,
            NH_TOYO_DEV_EXTENSION_SOURCE_ID
        ]);
        expect(local.metadataURL).toBe(
            'http://localhost:8000/generated-metadata/extensions-v0.json'
        );
        expect(assetURL.origin).toBe('http://localhost:8000');
        expect(assetURL.searchParams.get(LOCAL_EXTENSION_BUILD_QUERY)).toBe(
            'session-123'
        );
        expect(identifyExtensionSource(assetURL.href)).toEqual({
            id: NH_TOYO_DEV_EXTENSION_SOURCE_ID,
            label: 'NHtoyo development server',
            assetPath: '/CrispStrobe/spike.js',
            buildId: 'session-123'
        });
    });

    test('trusts only the local SPIKE development asset in development mode', () => {
        const spikeURL =
            'http://localhost:8000/CrispStrobe/legospike_turbowarp_transpile.js?bwDevBuild=abc';

        expect(isTrustedLocalSpikeDevelopmentURL(spikeURL, 'development')).toBe(
            true
        );
        expect(isTrustedLocalSpikeDevelopmentURL(spikeURL, 'production')).toBe(
            false
        );
        expect(
            isTrustedLocalSpikeDevelopmentURL(
                'http://localhost:8000/CrispStrobe/another-extension.js',
                'development'
            )
        ).toBe(false);
        expect(
            isTrustedLocalSpikeDevelopmentURL(
                'http://127.0.0.1:8000/CrispStrobe/legospike_turbowarp_transpile.js',
                'development'
            )
        ).toBe(false);
        expect(
            isTrustedLocalSpikeDevelopmentURL(
                'https://localhost:8000/CrispStrobe/legospike_turbowarp_transpile.js',
                'development'
            )
        ).toBe(false);
        expect(
            isTrustedLocalSpikeDevelopmentURL(
                'http://localhost:8000/CrispStrobe/legospike_turbowarp_transpile.js',
                'development'
            )
        ).toBe(false);
        expect(
            isTrustedLocalSpikeDevelopmentURL(
                `${spikeURL}&other=1`,
                'development'
            )
        ).toBe(false);
    });
});
