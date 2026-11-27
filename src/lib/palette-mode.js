export const isPaletteMode = mode => ['scratch', 'spike', 'both', 'none'].includes(mode);

export const getPaletteVisibility = mode => {
    if (mode === 'none') return {scratch: false, spike: false};
    if (mode === 'scratch') return {scratch: true, spike: false};
    if (mode === 'spike') return {scratch: false, spike: true};
    // `both` remains a persisted legacy value for existing projects.
    return {scratch: true, spike: true};
};

export const updatePaletteMode = (mode, palette, checked) => {
    if (palette !== 'scratch' && palette !== 'spike') return mode;
    const visibility = getPaletteVisibility(mode);
    visibility[palette] = Boolean(checked);
    if (visibility.scratch && visibility.spike) return 'both';
    if (!visibility.scratch && !visibility.spike) return 'none';
    return visibility.scratch ? 'scratch' : 'spike';
};

const SPIKE_PALETTE_STORAGE_KEY = 'brickwright.spikePaletteModel';
const VALID_SPIKE_PALETTE_MODELS = ['auto', 'prime', 'essential', 'all'];

export const getSpikePaletteModel = () => {
    try {
        const saved = window.localStorage.getItem(SPIKE_PALETTE_STORAGE_KEY);
        return VALID_SPIKE_PALETTE_MODELS.includes(saved) ? saved : 'auto';
    } catch (error) {
        return 'auto';
    }
};

export const setSpikePaletteModel = model => {
    if (!VALID_SPIKE_PALETTE_MODELS.includes(model)) return false;
    try {
        window.localStorage.setItem(SPIKE_PALETTE_STORAGE_KEY, model);
    } catch (error) {
        // Private browsing/storage-disabled contexts still keep the current UI
        // selection in component state for this session.
    }
    return true;
};
