import {getPaletteVisibility, isPaletteMode, updatePaletteMode} from '../../../src/lib/palette-mode';

describe('palette mode selection', () => {
    test('accepts independent Scratch/SPIKE visibility and legacy saved modes', () => {
        expect(isPaletteMode('scratch')).toBe(true);
        expect(isPaletteMode('spike')).toBe(true);
        expect(isPaletteMode('both')).toBe(true);
        expect(isPaletteMode('none')).toBe(true);
        expect(isPaletteMode(undefined)).toBe(false);
    });

    test('keeps existing per-target modes and defaults missing preferences to both visible', () => {
        expect(getPaletteVisibility(undefined)).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('both')).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('scratch')).toEqual({scratch: true, spike: false});
        expect(getPaletteVisibility('spike')).toEqual({scratch: false, spike: true});
        expect(getPaletteVisibility('none')).toEqual({scratch: false, spike: false});
    });

    test('updates each palette checkbox independently, including both unchecked', () => {
        expect(updatePaletteMode('both', 'scratch', false)).toBe('spike');
        expect(updatePaletteMode('spike', 'scratch', true)).toBe('both');
        expect(updatePaletteMode('both', 'spike', false)).toBe('scratch');
        expect(updatePaletteMode('scratch', 'spike', true)).toBe('both');
        expect(updatePaletteMode('scratch', 'scratch', false)).toBe('none');
        expect(updatePaletteMode('spike', 'spike', false)).toBe('none');
        expect(updatePaletteMode('none', 'scratch', true)).toBe('scratch');
        expect(updatePaletteMode('none', 'spike', true)).toBe('spike');
    });
});
