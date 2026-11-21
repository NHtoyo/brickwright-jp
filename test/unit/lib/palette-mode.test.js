import {getPaletteVisibility, isPaletteMode, updatePaletteMode} from '../../../src/lib/palette-mode';

describe('palette mode selection', () => {
    test('accepts the explicit Scratch, SPIKE and Both modes', () => {
        expect(isPaletteMode('scratch')).toBe(true);
        expect(isPaletteMode('spike')).toBe(true);
        expect(isPaletteMode('both')).toBe(true);
        expect(isPaletteMode(undefined)).toBe(false);
        expect(isPaletteMode('none')).toBe(false);
    });

    test('keeps existing per-target modes and defaults missing preferences to Both', () => {
        expect(getPaletteVisibility(undefined)).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('both')).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('scratch')).toEqual({scratch: true, spike: false});
        expect(getPaletteVisibility('spike')).toEqual({scratch: false, spike: true});
    });

    test('retains the legacy visibility reducer behavior for persisted preference migration', () => {
        expect(updatePaletteMode('both', 'scratch', false)).toBe('spike');
        expect(updatePaletteMode('spike', 'scratch', true)).toBe('both');
        expect(updatePaletteMode('both', 'spike', false)).toBe('scratch');
        expect(updatePaletteMode('scratch', 'spike', true)).toBe('both');
        expect(updatePaletteMode('scratch', 'scratch', false)).toBe('scratch');
        expect(updatePaletteMode('spike', 'spike', false)).toBe('spike');
    });
});
