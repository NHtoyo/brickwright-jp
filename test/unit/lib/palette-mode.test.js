import {getPaletteVisibility, updatePaletteMode} from '../../../src/lib/palette-mode';

describe('palette visibility toggles', () => {
    test('shows both palettes by default and preserves existing single-palette modes', () => {
        expect(getPaletteVisibility(undefined)).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('both')).toEqual({scratch: true, spike: true});
        expect(getPaletteVisibility('scratch')).toEqual({scratch: true, spike: false});
        expect(getPaletteVisibility('spike')).toEqual({scratch: false, spike: true});
    });

    test('toggles either palette independently without allowing both to be hidden', () => {
        expect(updatePaletteMode('both', 'scratch', false)).toBe('spike');
        expect(updatePaletteMode('spike', 'scratch', true)).toBe('both');
        expect(updatePaletteMode('both', 'spike', false)).toBe('scratch');
        expect(updatePaletteMode('scratch', 'spike', true)).toBe('both');
        expect(updatePaletteMode('scratch', 'scratch', false)).toBe('scratch');
        expect(updatePaletteMode('spike', 'spike', false)).toBe('spike');
    });
});
