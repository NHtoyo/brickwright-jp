import {
    clampSpikePaletteWidth,
    getSpikePaletteBoundaryOffset,
    getStoredSpikePaletteWidth,
    SPIKE_PALETTE_WIDTH_DEFAULT,
    SPIKE_PALETTE_WIDTH_MAX,
    SPIKE_PALETTE_WIDTH_MIN,
    SPIKE_PALETTE_WIDTH_STORAGE_KEY,
    storeSpikePaletteWidth
} from '../../../src/lib/spike-palette-width';

describe('SPIKE palette width', () => {
    beforeEach(() => localStorage.clear());

    test('defaults to 280px for absent, blank, and invalid stored values', () => {
        expect(getStoredSpikePaletteWidth()).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
        localStorage.setItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY, '');
        expect(getStoredSpikePaletteWidth()).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
        localStorage.setItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY, 'Infinity');
        expect(getStoredSpikePaletteWidth()).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
        localStorage.setItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY, 'not-a-width');
        expect(getStoredSpikePaletteWidth()).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
    });

    test('clamps saved widths and leaves a 360px work area when the container permits it', () => {
        expect(clampSpikePaletteWidth(100, 1000)).toBe(SPIKE_PALETTE_WIDTH_MIN);
        expect(clampSpikePaletteWidth(400, 1000)).toBe(400);
        expect(clampSpikePaletteWidth(900, 1000)).toBe(SPIKE_PALETTE_WIDTH_MAX);
        expect(clampSpikePaletteWidth(480, 700)).toBe(340);
        expect(clampSpikePaletteWidth(400, 500)).toBe(SPIKE_PALETTE_WIDTH_MIN);
        expect(SPIKE_PALETTE_WIDTH_MAX).toBe(480);
    });

    test('stores clamped values and uses 280px when browser storage is denied', () => {
        storeSpikePaletteWidth(999);
        expect(localStorage.getItem(SPIKE_PALETTE_WIDTH_STORAGE_KEY)).toBe('480');
        const original = window.localStorage;
        Object.defineProperty(window, 'localStorage', {configurable: true, get: () => { throw new Error('denied'); }});
        expect(getStoredSpikePaletteWidth()).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
        Object.defineProperty(window, 'localStorage', {configurable: true, value: original});
    });

    test('positions the handle at the measured LTR and RTL flyout boundary', () => {
        const container = {left: 100, right: 900, width: 800};
        const ltrFlyout = {left: 160, right: 380, width: 220};
        const rtlFlyout = {left: 620, right: 840, width: 220};
        expect(getSpikePaletteBoundaryOffset(container, ltrFlyout, false)).toBe(276);
        expect(getSpikePaletteBoundaryOffset(container, rtlFlyout, true)).toBe(276);
        expect(getSpikePaletteBoundaryOffset(container, {...ltrFlyout, width: 0}, false)).toBeNull();
    });
});
