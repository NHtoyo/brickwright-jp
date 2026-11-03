import {BLOCKS_DARK, BLOCKS_HIGH_CONTRAST, Theme} from '../../../src/lib/themes';
import {injectExtensionBlockTheme, injectExtensionCategoryTheme} from '../../../src/lib/themes/blockHelpers';
import {detectTheme, persistTheme} from '../../../src/lib/themes/themePersistance';

describe('Theme', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('presets expose the current GUI and block themes', () => {
        expect(Theme.light.isDark()).toBe(false);
        expect(Theme.dark.isDark()).toBe(true);
        expect(Theme.highContrast.blocks).toBe(BLOCKS_HIGH_CONTRAST);
        expect(Theme.highContrast.getBlocksMediaFolder()).toContain('high-contrast');
    });

    test('changing block colors leaves the input theme unchanged', () => {
        const darkBlocksTheme = Theme.light.set('blocks', BLOCKS_DARK);

        expect(Theme.light.blocks).not.toBe(BLOCKS_DARK);
        expect(darkBlocksTheme.blocks).toBe(BLOCKS_DARK);
        expect(darkBlocksTheme.getBlockColors().motion.primary).not.toBe(
            Theme.light.getBlockColors().motion.primary
        );
    });

    test('default extension block colors are preserved in the standard theme', () => {
        const blockInfo = {
            type: 'pen_test',
            extensions: ['default_extension_colors'],
            colour: '#0fbd8c',
            colourSecondary: '#0da57a',
            colourTertiary: '#0b8e69'
        };

        expect(injectExtensionBlockTheme(blockInfo, Theme.light)).toBe(blockInfo);
    });

    test('extension blocks receive the selected dark palette', () => {
        const theme = Theme.light.set('blocks', BLOCKS_DARK);
        const blockInfo = {
            type: 'pen_test',
            extensions: ['default_extension_colors'],
            colour: '#0fbd8c'
        };

        expect(injectExtensionBlockTheme(blockInfo, theme)).toMatchObject({
            colour: theme.getBlockColors().pen.primary,
            colourSecondary: theme.getBlockColors().pen.secondary,
            colourTertiary: theme.getBlockColors().pen.tertiary,
            colourQuaternary: theme.getBlockColors().pen.quaternary
        });
    });

    test('extension categories receive the selected palette', () => {
        const theme = Theme.light.set('blocks', BLOCKS_DARK);
        const categories = [{
            id: 'pen',
            xml: '<category name="Pen" colour="#0fbd8c" secondaryColour="#0da57a"></category>'
        }];

        const updated = injectExtensionCategoryTheme(categories, theme);
        const category = new DOMParser().parseFromString(updated[0].xml, 'text/xml').documentElement;

        expect(category.getAttribute('colour')).toBe(theme.getBlockColors().pen.primary);
        expect(category.getAttribute('secondaryColour')).toBe(theme.getBlockColors().pen.tertiary);
        expect(categories[0].xml).toContain('#0fbd8c');
    });

    test('theme preferences persist only settings that differ from system defaults', () => {
        persistTheme(Theme.dark);
        expect(detectTheme().gui).toBe(Theme.dark.gui);

        persistTheme(Theme.light);
        expect(localStorage.getItem('tw:theme')).toBeNull();
    });
});
