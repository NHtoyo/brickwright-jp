import {
    installSpikeMotorPortPicker,
    setSpikePortLanguageProvider,
    setSpikePortStateProvider
} from '../../../src/lib/spike-motor-port-picker';

const makeBlocks = () => {
    const content = document.createElement('div');
    const dropdown = {
        hideWithoutAnimation: jest.fn(),
        clearContent: jest.fn(() => {
            content.replaceChildren();
        }),
        getContentDiv: jest.fn(() => content),
        hide: jest.fn(),
        setColour: jest.fn(),
        setCategory: jest.fn(),
        setBoundsElement: jest.fn(),
        show: jest.fn()
    };
    class FieldDropdown {
        constructor ({name, sourceBlock, options, value}) {
            this.name = name;
            this.sourceBlock_ = sourceBlock;
            this.options = options;
            this.value = value;
            this.fieldGroup_ = {getBoundingClientRect: () => ({left: 10, top: 20})};
            this.originalShow = jest.fn();
            this.onHide = jest.fn();
            this.getSize = () => ({width: 30, height: 16});
        }

        showEditor_ () {
            this.originalShow();
        }

        getOptions () {
            return this.options;
        }

        getValue () {
            return this.value;
        }

        setValue (value) {
            this.value = value;
        }

        callValidator (value) {
            return value;
        }
    }
    return {
        blocks: {
            FieldDropdown,
            DropDownDiv: dropdown,
            Events: {getGroup: () => false, setGroup: jest.fn()}
        },
        content,
        dropdown
    };
};

const makeShadowField = (blocks, {
    parentType = 'spikeprime_motorRunFor',
    name = 'MULTIPLE_PORT',
    options = [['A', 'A'], ['B', 'B'], ['A+B', 'A+B']],
    value = 'A'
} = {}) => {
    const workspaceParent = document.createElement('div');
    const parent = {
        type: parentType,
        getColour: () => '#00a087',
        getColourTertiary: () => '#00816c',
        getCategory: () => 'spikeprime'
    };
    const shadow = {
        type: `spikeprime_menu_${name}`,
        parentBlock_: parent,
        workspace: {
            scale: 1,
            getParentSvg: () => ({parentNode: workspaceParent})
        },
        isShadow: () => true,
        getColour: () => '#00a087',
        getColourTertiary: () => '#00816c',
        getCategory: () => 'spikeprime'
    };
    const field = new blocks.FieldDropdown({name, sourceBlock: shadow, options, value});
    shadow.inputList = [{fieldRow: [field]}];
    return {field, parent, shadow};
};

describe('SPIKE spatial motor port picker', () => {
    beforeEach(() => {
        document.documentElement.lang = 'ja-JP';
    });

    test('uses the real shadow-to-motor parent relationship and limits Essential to A/B', () => {
        const {blocks, content} = makeBlocks();
        installSpikeMotorPortPicker(blocks);
        document.documentElement.lang = 'en';
        let locale = 'ja-JP';
        setSpikePortLanguageProvider(blocks, () => locale);
        setSpikePortStateProvider(blocks, () => ({
            connected: true,
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            portSensors: {A: {connected: true, type: 'motor', deviceType: 0x41}}
        }));
        const {field} = makeShadowField(blocks);
        field.showEditor_();
        expect(content.textContent).toContain('モーターのポートを選択');
        expect(content.querySelectorAll('.bw-spike-port-picker__port')).toHaveLength(2);
        expect(content.querySelector('[data-port="C"]')).toBeNull();
        expect(content.querySelector('[data-port="A"]').getAttribute('aria-label')).toContain('モーター');
        expect(content.textContent).toContain('表示中のすべて');
        locale = 'en-US';
        field.showEditor_();
        expect(content.textContent).toContain('Select motor port');
    });

    test('chooses one port by default and only combines ports after enabling multi-select', () => {
        const {blocks, content, dropdown} = makeBlocks();
        installSpikeMotorPortPicker(blocks);
        setSpikePortStateProvider(blocks, () => ({effectiveHubModel: 'essential', availablePorts: ['A', 'B']}));
        const {field} = makeShadowField(blocks);
        field.showEditor_();
        content.querySelector('[data-port="B"]').click();
        expect(field.getValue()).toBe('B');
        expect(dropdown.hide).toHaveBeenCalledTimes(1);

        const next = makeShadowField(blocks, {value: 'A'}).field;
        next.showEditor_();
        content.querySelector('.bw-spike-port-picker__multi-toggle input').click();
        content.querySelector('[data-port="B"]').click();
        expect(next.getValue()).toBe('A');
        const applyButton = Array.from(content.querySelectorAll('.bw-spike-port-picker__actions button'))
            .find(button => button.textContent === '選択');
        applyButton.click();
        expect(next.getValue()).toBe('A+B');
    });

    test('preserves an existing unavailable selection until the user chooses another value', () => {
        const {blocks, content} = makeBlocks();
        installSpikeMotorPortPicker(blocks);
        setSpikePortStateProvider(blocks, () => ({effectiveHubModel: 'essential', availablePorts: ['A', 'B']}));
        const {field} = makeShadowField(blocks, {value: 'A+B+C+D+E+F'});
        field.showEditor_();
        expect(field.getValue()).toBe('A+B+C+D+E+F');
        expect(content.textContent).toContain('このハブで使えないポート');
    });

    test('leaves sensor menu dropdowns unchanged', () => {
        const {blocks} = makeBlocks();
        installSpikeMotorPortPicker(blocks);
        const {field} = makeShadowField(blocks, {parentType: 'spikeprime_distance', name: 'PORT'});
        field.showEditor_();
        expect(field.originalShow).toHaveBeenCalledTimes(1);
    });
});
