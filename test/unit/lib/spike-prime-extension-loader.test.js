import {
    installStandardSpikeExtensionResolver,
    loadStandardSpikeExtension
} from '../../../src/lib/spike-prime-extension-loader';

const standardURL = 'https://example.invalid/pinned-spikeprime.js';

const createVM = () => {
    const manager = {
        isExtensionLoaded: jest.fn(() => false),
        getExtensionURLs: jest.fn(() => ({})),
        loadExtensionURL: jest.fn(() => Promise.resolve())
    };
    const vm = {
        extensionManager: manager,
        _loadExtensions: jest.fn((ids, urls) => Promise.resolve({ids, urls}))
    };
    return {vm, manager};
};

describe('standard SPIKE extension loading', () => {
    test('project metadata cannot replace the standard extension URL', async () => {
        const {vm} = createVM();
        installStandardSpikeExtensionResolver(vm, standardURL);

        const result = await vm._loadExtensions(
            ['motion', 'spikeprime'],
            new Map([
                ['spikeprime', 'https://untrusted.invalid/old-spike.js'],
                ['other', 'https://example.invalid/other.js']
            ])
        );

        expect(result.urls.get('spikeprime')).toBe(standardURL);
        expect(result.urls.get('other')).toBe('https://example.invalid/other.js');
    });

    test('loads the extension once and returns the same pending promise', async () => {
        const {vm, manager} = createVM();
        let resolveLoad;
        manager.loadExtensionURL.mockImplementation(() => new Promise(resolve => {
            resolveLoad = resolve;
        }));

        const first = loadStandardSpikeExtension(vm, standardURL);
        const second = loadStandardSpikeExtension(vm, standardURL);
        expect(first).toBe(second);
        expect(manager.loadExtensionURL).toHaveBeenCalledTimes(1);
        expect(manager.loadExtensionURL).toHaveBeenCalledWith(standardURL);

        resolveLoad();
        await expect(first).resolves.toEqual({status: 'loaded', sourceURL: standardURL});
    });

    test('reports an already-loaded different implementation without fetching it again', async () => {
        const {vm, manager} = createVM();
        manager.isExtensionLoaded.mockReturnValue(true);
        manager.getExtensionURLs.mockReturnValue({spikeprime: 'https://old.invalid/spike.js'});

        await expect(loadStandardSpikeExtension(vm, standardURL)).resolves.toEqual({
            status: 'source-conflict',
            sourceURL: standardURL,
            loadedURL: 'https://old.invalid/spike.js'
        });
        expect(manager.loadExtensionURL).not.toHaveBeenCalled();
    });
});
