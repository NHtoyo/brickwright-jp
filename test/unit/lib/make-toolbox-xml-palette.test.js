import makeToolboxXML, {filterSpikeCategoryXML} from '../../../src/lib/make-toolbox-xml';
import {
    getSpikeOpcodeCategories,
    getSpikeBlockColors,
    getUncategorizedSpikeOpcodes,
    SPIKE_CATEGORY_ORDER,
    SPIKE_EXTENSION_OPCODE_CATALOG
} from '../../../src/lib/spike-toolbox-categories';

const categories = [
    {id: 'spikeprime', xml: '<category id="spikeprime" name="SPIKE Prime">' +
        '<block type="spikeprime_connectHub"/><block type="spikeprime_moveForward"/>' +
        '<block type="spikeprime_motorRunFor"/>' +
        '<block type="spikeprime_displayText"/><block type="spikeprime_getAngle"/>' +
        '<block type="spikeprime_getCommunicationDiagnostics"/></category>'},
    {id: 'otherExtension', xml: '<category id="otherExtension" name="Other extension"/>'}
];

const colors = {
    motion: '#4c97ff',
    looks: '#9966ff',
    sounds: '#d65cd6',
    event: '#ffbf00',
    control: '#ffab19',
    sensing: '#4cbfe6',
    operators: '#59c059',
    data: '#ff8c1a',
    more: '#ff6680'
};

describe('makeToolboxXML palette mode', () => {
    test('both builds the 11 mapped categories and keeps unrelated extension categories', () => {
        const xml = makeToolboxXML(false, true, 'target', categories);

        expect(xml).toContain('id="motion"');
        expect(xml).toContain('id="bw-spike-motor"');
        expect(xml).toContain('id="bw-spike-light"');
        expect(xml).toContain('id="spikeprime"');
        expect(xml).toContain('id="otherExtension"');
        expect(xml.match(/<category /g)).toHaveLength(12); // 11 Brickwright categories + other extension
        expect(xml).toContain('iconURI="data:image/svg+xml,');
        expect(xml).toContain('spikeprime_connectHub');
        expect(xml).toContain('spikeprime_motorRunFor');
        expect(xml).toContain('spikeprime_displayText');
    });

    test('Scratch mode preserves Scratch primitive blocks and unrelated extensions but hides SPIKE', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'scratch');

        expect(xml).toContain('id="motion"');
        expect(xml).not.toContain('spikeprime_connectHub');
        expect(xml).not.toContain('spikeprime_motorRunFor');
        expect(xml).toContain('id="otherExtension"');
    });

    test('SPIKE mode uses the mapped categories without Scratch primitives or other extensions', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'spike');

        expect(xml).toContain('id="motion"'); // Movement has SPIKE blocks, but not Scratch motion blocks.
        expect(xml).toContain('id="spikeprime"');
        expect(xml).not.toContain('id="otherExtension"');
        expect(xml).not.toContain('motion_movesteps');
        expect(xml).toContain('spikeprime_motorRunFor');
    });

    test('filters unsupported SPIKE toolbox blocks without changing saved block definitions', () => {
        const spikeCategory = '<category id="spikeprime" name="SPIKE">' +
            '<block type="spikeprime_connect"/>' +
            '<block type="spikeprime_primeMotorRun"/>' +
            '</category>';
        const filtered = filterSpikeCategoryXML(spikeCategory, ['connect', 'primeMotorRun']);
        expect(filtered).toContain('spikeprime_connect');
        expect(filtered).toContain('spikeprime_primeMotorRun');
        expect(filterSpikeCategoryXML(spikeCategory, ['connect'])).toContain('spikeprime_connect');
        expect(filterSpikeCategoryXML(spikeCategory, ['connect'])).not.toContain('spikeprime_primeMotorRun');
        expect(filterSpikeCategoryXML(spikeCategory, null)).toBe(spikeCategory);
    });

    test('applies the supported block list to both visible palettes and preserves Scratch blocks', () => {
        const categoriesWithBlocks = [
            {id: 'spikeprime', xml: '<category id="spikeprime"><block type="spikeprime_supported"/><block type="spikeprime_unsupported"/></category>'},
            {id: 'otherExtension', xml: '<category id="otherExtension" name="Other extension"/>'}
        ];
        const xml = makeToolboxXML(
            false, true, 'target', categoriesWithBlocks, '', '', '', colors, 'both', ['supported']
        );
        expect(xml).toContain('id="motion"');
        expect(xml).toContain('spikeprime_supported');
        expect(xml).not.toContain('spikeprime_unsupported');
        expect(xml).toContain('id="otherExtension"');
    });

    test('every SPIKE extension opcode is explicitly mapped to a palette category', () => {
        expect(getUncategorizedSpikeOpcodes(SPIKE_EXTENSION_OPCODE_CATALOG)).toEqual([]);
        expect(SPIKE_CATEGORY_ORDER).toHaveLength(11);
        expect(getSpikeOpcodeCategories('motorRunFor')).toContain('motor');
        expect(getSpikeOpcodeCategories('getPosition')).toEqual(['motor']);
        expect(getSpikeOpcodeCategories('whenColor')).toContain('events');
        expect(getSpikeOpcodeCategories('whenColor')).toHaveLength(1);
    });

    test('SPIKE block definitions receive category-specific primary and outline colors', () => {
        expect(getSpikeBlockColors('motorRunFor')).toEqual({
            colour: '#4C97FF',
            colourSecondary: '#3373CC',
            colourTertiary: '#3373CC',
            colourQuaternary: '#3373CC'
        });
        expect(getSpikeBlockColors('moveForward').colour).toBe('#D65CD6');
        expect(getSpikeBlockColors('displayText').colour).toBe('#9966FF');
    });

    test('uses SPIKE palette category names only when the SPIKE palette is visible', () => {
        const japaneseCategories = {
            motor: 'モーター', movement: '移動', light: 'ライト', sound: '音',
            events: 'イベント', control: '制御', sensors: 'センサー', operators: '演算',
            variables: '変数', myBlocks: 'マイブロック', other: 'その他'
        };
        const both = makeToolboxXML(
            false, true, 'target', categories, '', '', '', colors, 'both', null, japaneseCategories
        );
        const scratch = makeToolboxXML(
            false, true, 'target', categories, '', '', '', colors, 'scratch', null, japaneseCategories
        );
        expect(both).toContain('name="移動"');
        expect(scratch).toContain('name="%{BKY_CATEGORY_MOTION}"');
    });
});
