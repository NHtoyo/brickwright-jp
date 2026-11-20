import makeToolboxXML, {filterSpikeCategoryXML} from '../../../src/lib/make-toolbox-xml';

const categories = [
    {id: 'spikeprime', xml: '<category id="spikeprime" name="SPIKE Prime"/>'},
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
    test('both is the default and shows Scratch, SPIKE, and other extension categories', () => {
        const xml = makeToolboxXML(false, true, 'target', categories);

        expect(xml).toContain('id="motion"');
        expect(xml).toContain('id="spikeprime"');
        expect(xml).toContain('id="otherExtension"');
    });

    test('Scratch mode keeps Scratch and unrelated extension categories but hides SPIKE', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'scratch');

        expect(xml).toContain('id="motion"');
        expect(xml).not.toContain('id="spikeprime"');
        expect(xml).toContain('id="otherExtension"');
    });

    test('SPIKE mode shows only the SPIKE extension category', () => {
        const xml = makeToolboxXML(false, true, 'target', categories, '', '', '', colors, 'spike');

        expect(xml).not.toContain('id="motion"');
        expect(xml).toContain('id="spikeprime"');
        expect(xml).not.toContain('id="otherExtension"');
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
});
