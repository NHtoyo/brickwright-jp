import {
    clampSpikePaletteWidth,
    SPIKE_PALETTE_WIDTH_DEFAULT,
    SPIKE_PALETTE_WIDTH_MAX,
    SPIKE_PALETTE_WIDTH_MIN
} from '../../../src/lib/spike-palette-width';

describe('SPIKE palette width', () => {
    test('uses the requested 280 px default and clamps against limits and viewport', () => {
        expect(SPIKE_PALETTE_WIDTH_DEFAULT).toBe(280);
        expect(clampSpikePaletteWidth(100)).toBe(SPIKE_PALETTE_WIDTH_MIN);
        expect(clampSpikePaletteWidth(800)).toBe(SPIKE_PALETTE_WIDTH_MAX);
        expect(clampSpikePaletteWidth(450, 760)).toBe(400);
        expect(clampSpikePaletteWidth(Number.NaN)).toBe(SPIKE_PALETTE_WIDTH_DEFAULT);
    });
});
