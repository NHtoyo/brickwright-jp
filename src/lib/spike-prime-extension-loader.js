import {
    getStandardSpikeExtensionURL,
    STANDARD_SPIKE_EXTENSION_ID
} from './extension-gallery-sources';

const resolverState = new WeakMap();
const loadPromises = new WeakMap();

/**
 * Make the standard SPIKE implementation win over project.json extensionURLs.
 * The runtime has one extension manager, so both the palette and GUI use the
 * same registered extension instance and HubRouter.
 * @param {VM} vm Scratch VM instance.
 * @param {string} [sourceURL] Trusted, resolved SPIKE source URL.
 * @returns {string} The URL pinned to this editor session.
 */
export const installStandardSpikeExtensionResolver = (
    vm,
    sourceURL = getStandardSpikeExtensionURL()
) => {
    if (!vm || typeof vm._loadExtensions !== 'function') {
        throw new Error('The Scratch VM cannot resolve extension URLs.');
    }
    const current = resolverState.get(vm);
    if (current) return current.sourceURL;

    const originalLoadExtensions = vm._loadExtensions;
    vm._loadExtensions = function (extensionIDs, extensionURLs) {
        const ids = Array.from(extensionIDs || []);
        if (!ids.includes(STANDARD_SPIKE_EXTENSION_ID)) {
            return originalLoadExtensions.call(this, extensionIDs, extensionURLs);
        }
        const urls = extensionURLs instanceof Map ?
            new Map(extensionURLs) :
            new Map(Object.entries(extensionURLs || {}));
        urls.set(STANDARD_SPIKE_EXTENSION_ID, sourceURL);
        // Share the same pending load with the GUI bootstrap so opening an
        // SB3 that uses SPIKE cannot race a second fetch of the same script.
        // eslint-disable-next-line no-use-before-define
        return loadStandardSpikeExtension(vm, sourceURL)
            .then(() => originalLoadExtensions.call(this, extensionIDs, urls));
    };
    resolverState.set(vm, {sourceURL, originalLoadExtensions});
    return sourceURL;
};

/**
 * Load the pinned standard SPIKE extension exactly once for this VM.
 * @param {VM} vm Scratch VM instance.
 * @param {string} [sourceURL] Trusted, resolved SPIKE source URL.
 * @returns {Promise<{status: string, sourceURL: string}>} Load result.
 */
export const loadStandardSpikeExtension = (
    vm,
    sourceURL = installStandardSpikeExtensionResolver(vm)
) => {
    installStandardSpikeExtensionResolver(vm, sourceURL);
    const manager = vm.extensionManager;
    if (!manager || typeof manager.loadExtensionURL !== 'function') {
        return Promise.reject(new Error('The Scratch extension manager is unavailable.'));
    }

    if (manager.isExtensionLoaded(STANDARD_SPIKE_EXTENSION_ID)) {
        const urls = typeof manager.getExtensionURLs === 'function' ?
            manager.getExtensionURLs() : {};
        const loadedURL = urls[STANDARD_SPIKE_EXTENSION_ID];
        if (loadedURL === sourceURL) return Promise.resolve({status: 'loaded', sourceURL});
        return Promise.resolve({
            status: 'source-conflict',
            sourceURL,
            loadedURL: loadedURL || null
        });
    }

    const pending = loadPromises.get(vm);
    if (pending) return pending;

    const promise = manager.loadExtensionURL(sourceURL)
        .then(() => ({status: 'loaded', sourceURL}))
        .finally(() => {
            loadPromises.delete(vm);
        });
    loadPromises.set(vm, promise);
    return promise;
};

export const getStandardSpikeExtensionSourceURL = vm => {
    const urls = vm && vm.extensionManager &&
        typeof vm.extensionManager.getExtensionURLs === 'function' ?
        vm.extensionManager.getExtensionURLs() : {};
    return urls[STANDARD_SPIKE_EXTENSION_ID] ||
        (resolverState.get(vm) && resolverState.get(vm).sourceURL) || null;
};
