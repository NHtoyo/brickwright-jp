export const SPIKE_PALETTE_WIDTH_STORAGE_KEY = 'brickwright.spikePaletteWidth';
export const SPIKE_PALETTE_WIDTH_DEFAULT = 280;
export const SPIKE_PALETTE_WIDTH_MIN = 210;
export const SPIKE_PALETTE_WIDTH_MAX = 480;

export const clampSpikePaletteWidth = (value, viewportWidth = 1280) => {
    const width = Number(value);
    const requested = Number.isFinite(width) ? width : SPIKE_PALETTE_WIDTH_DEFAULT;
    const viewportMaximum = Math.max(SPIKE_PALETTE_WIDTH_MIN, Number(viewportWidth) - 360);
    const maximum = Math.min(SPIKE_PALETTE_WIDTH_MAX, viewportMaximum);
    return Math.round(Math.max(SPIKE_PALETTE_WIDTH_MIN, Math.min(maximum, requested)));
};

export const getStoredSpikePaletteWidth = () => {
    try {
        if (typeof window === 'undefined') return SPIKE_PALETTE_WIDTH_DEFAULT;
        const value = Number(window.localStorage.getItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY));
        return Number.isFinite(value) ? clampSpikePaletteWidth(value, window.innerWidth) : SPIKE_PALETTE_WIDTH_DEFAULT;
    } catch (error) {
        return SPIKE_PALETTE_WIDTH_DEFAULT;
    }
};

export const storeSpikePaletteWidth = width => {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY, String(width));
        }
    } catch (error) {
        // Keep the in-memory value when browser storage is unavailable.
    }
};
