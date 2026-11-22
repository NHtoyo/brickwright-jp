export const SPIKE_PALETTE_WIDTH_STORAGE_KEY = 'brickwright.spikePaletteWidth';
export const SPIKE_PALETTE_WIDTH_DEFAULT = 280;
export const SPIKE_PALETTE_WIDTH_MIN = 210;
export const SPIKE_PALETTE_WIDTH_MAX = 480;

export const getSpikePaletteBoundaryOffset = (containerRect, flyoutRect, isRtl, handleWidth = 8) => {
    if (!containerRect || !flyoutRect ||
        !Number.isFinite(containerRect.left) || !Number.isFinite(containerRect.right) ||
        !Number.isFinite(flyoutRect.left) || !Number.isFinite(flyoutRect.right) ||
        flyoutRect.width <= 0 || containerRect.width <= 0) return null;
    const boundary = isRtl ? containerRect.right - flyoutRect.left : flyoutRect.right - containerRect.left;
    return Number.isFinite(boundary) ? boundary - (handleWidth / 2) : null;
};

export const clampSpikePaletteWidth = (value, containerWidth = 1280) => {
    const width = value === null || typeof value === 'undefined' ||
        (typeof value === 'string' && value.trim() === '') ?
        Number.NaN : Number(value);
    const requested = Number.isFinite(width) ? width : SPIKE_PALETTE_WIDTH_DEFAULT;
    const availableMaximum = Math.max(SPIKE_PALETTE_WIDTH_MIN, Number(containerWidth) - 360);
    const maximum = Math.min(SPIKE_PALETTE_WIDTH_MAX, availableMaximum);
    return Math.round(Math.max(SPIKE_PALETTE_WIDTH_MIN, Math.min(maximum, requested)));
};

export const getStoredSpikePaletteWidth = () => {
    try {
        if (typeof window === 'undefined') return SPIKE_PALETTE_WIDTH_DEFAULT;
        const stored = window.localStorage.getItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY);
        if (stored === null || stored.trim() === '') return SPIKE_PALETTE_WIDTH_DEFAULT;
        const value = Number(stored);
        return Number.isFinite(value) ?
            clampSpikePaletteWidth(value, window.innerWidth) : SPIKE_PALETTE_WIDTH_DEFAULT;
    } catch (error) {
        return SPIKE_PALETTE_WIDTH_DEFAULT;
    }
};

export const storeSpikePaletteWidth = width => {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(
                SPIKE_PALETTE_WIDTH_STORAGE_KEY,
                String(clampSpikePaletteWidth(width, window.innerWidth))
            );
        }
    } catch (error) {
        // Keep the in-memory value when browser storage is unavailable.
    }
};
