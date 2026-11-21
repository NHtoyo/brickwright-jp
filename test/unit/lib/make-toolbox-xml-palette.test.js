import makeToolboxXML, {filterSpikeCategoryXML} from '../../../src/lib/make-toolbox-xml';
import {
    getSpikeOpcodeCategories,
    getSpikeBlockColors,
    getUncategorizedSpikeOpcodes,
    SPIKE_CATEGORY_ORDER,
    SPIKE_EXTENSION_OPCODE_CATALOG
} from '../../../src/lib/spike-toolbox-categories';

const scratchCategories = [
    ['motion', '#4c97ff'], ['looks', '#9966ff'], ['sound', '#d65cd6'], ['event', '#ffbf00'],
    ['control', '#ffab19'], ['sensing', '#4cbfe6'], ['operators', '#59c059'],
    ['data', '#ff8c1a'], ['procedures', '#ff6680']
].map(([id, colour]) => ({
    id,
    xml: `<category id="${id}" name="Scratch ${id}" colour="${colour}" secondaryColour="${colour}">` +
        `<block type="scratch_${id}"/></category>`
}));

const scratchMotionXML = scratchCategories.find(category => category.id === 'motion').xml;
const otherExtensionXML = '<category id="otherExtension" name="Other extension"><block type="other_extension_block"/></category>';
const categories = [
    ...scratchCategories,
    {id: 'spikeprime', xml: '<category id="spikeprime" name="SPIKE Prime">' +
        '<block type="spikeprime_connectHub"/><block type="spikeprime_moveForward"/>' +
        '<block type="spikeprime_motorRunFor"/><block type="spikeprime_playBeep"/>' +
        '<block type="spikeprime_whenColor"/><block type="spikeprime_displayText"/>' +
        '<block type="spikeprime_getAngle"/>' +
        '<block type="spikeprime_getCommunicationDiagnostics"/></category>'},
    {id: 'otherExtension', xml: otherExtensionXML}
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
    test('both preserves Scratch categories and appends an isolated, uniquely identified SPIKE section', () => {
        const xml = makeToolboxXML(false, true, 'target', categories);

        const ids = Array.from(new DOMParser().parseFromString(xml, 'text/xml')
            .documentElement.querySelectorAll('category')).map(category => category.getAttribute('id'));
        expect(ids.slice(0, 9)).toEqual([
            'motion', 'looks', 'sound', 'event', 'control', 'sensing', 'operators', 'data', 'procedures'
        ]);
        expect(ids.indexOf('otherExtension')).toBeLessThan(ids.indexOf('bw-spike-prime-motor'));
        expect(ids).toContain('bw-spike-prime-motor');
        expect(ids).toContain('bw-spike-prime-movement');
        expect(ids).toContain('bw-spike-prime-sound');
        expect(ids).toContain('bw-spike-prime-events');
        expect(ids).toContain('bw-spike-prime-control');
        expect(ids).not.toContain('bw-spike-prime-operators');
        expect(new Set(ids).size).toBe(ids.length);
        expect(xml).toContain('id="otherExtension"');
        expect(xml).toContain('iconURI="data:image/svg+xml,');
        expect(xml).toContain('spikeprime_connectHub');
        expect(xml).toContain('spikeprime_motorRunFor');
        expect(xml).toContain('spikeprime_displayText');
        expect(xml).toContain('SPIKE · Movement');
        expect(xml).toContain(scratchMotionXML);
        expect(xml).toContain('colour="#4c97ff" secondaryColour="#4c97ff"');

        const parsed = new DOMParser().parseFromString(xml, 'text/xml');
        expect(parsed.querySelector('#motion').querySelectorAll('block')[0].getAttribute('type'))
            .toBe('scratch_motion');
        expect(parsed.querySelector('#bw-spike-prime-movement').querySelectorAll('block'))
            .toHaveLength(1);
        expect(parsed.querySelector('#bw-spike-prime-movement').textContent)
            .not.toContain('scratch_motion');
        expect(parsed.querySelector('#bw-spike-prime-sound').querySelectorAll('block')[0]
            .getAttribute('type')).toBe('spikeprime_playBeep');
        expect(parsed.querySelector('#sound').textContent).not.toContain('spikeprime_playBeep');
    });

    test('Scratch mode preserves the original Scratch and unrelated extension XML but hides SPIKE', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'scratch');

        expect(xml).toContain(scratchMotionXML);
        expect(xml).not.toContain('spikeprime_connectHub');
        expect(xml).not.toContain('spikeprime_motorRunFor');
        expect(xml).toContain(otherExtensionXML);
    });

    test('SPIKE mode contains only SPIKE blocks with unique ids; it hides Scratch and unrelated extensions', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'spike');

        expect(xml).toContain('id="bw-spike-prime-movement"');
        expect(xml).toContain('id="bw-spike-prime-control"');
        expect(xml).not.toContain('id="otherExtension"');
        expect(xml).not.toContain('id="motion"');
        expect(xml).not.toContain('motion_movesteps');
        expect(xml).not.toContain('scratch_motion');
        expect(xml).toContain('spikeprime_motorRunFor');
        expect(xml).not.toContain('other_extension_block');
    });

    test('none mode hides both palettes without merging or leaking blocks', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'none');
        expect(xml).not.toContain('scratch_motion');
        expect(xml).not.toContain('spikeprime_motorRunFor');
        expect(xml).not.toContain('other_extension_block');
        expect(new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('category')).toHaveLength(0);
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
        expect(xml).toContain('id="bw-spike-prime-other"');
        expect(xml).toContain('spikeprime_supported');
        expect(xml).not.toContain('spikeprime_unsupported');
        expect(xml).toContain('id="otherExtension"');
    });

    test('every SPIKE extension opcode is explicitly mapped to a palette category', () => {
        expect(getUncategorizedSpikeOpcodes(SPIKE_EXTENSION_OPCODE_CATALOG)).toEqual([]);
        expect(SPIKE_CATEGORY_ORDER).toEqual([
            'motor', 'movement', 'light', 'sound', 'events', 'control',
            'sensors', 'operators', 'variables', 'myBlocks', 'other'
        ]);
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
        expect(both).toContain('name="SPIKE · 移動"');
        expect(scratch).toContain('name="Scratch motion"');
        expect(scratch).not.toContain('SPIKE ·');
    });
});
