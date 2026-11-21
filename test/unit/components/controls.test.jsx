import React from 'react';
import {IntlProvider} from 'react-intl';
import {mount} from 'enzyme';
import {act} from 'react-dom/test-utils';
import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import Controls from '../../../src/components/controls/controls';
import TurboMode from '../../../src/components/turbo-mode/turbo-mode';
import GreenFlag from '../../../src/components/green-flag/green-flag';
import StopAll from '../../../src/components/stop-all/stop-all';
import VM from 'scratch-vm';
import ControlsContainer from '../../../src/containers/controls';

const UnconnectedControlsContainer = ControlsContainer.WrappedComponent;

describe('Controls component', () => {
    const defaultProps = () => ({
        active: false,
        onGreenFlagClick: jest.fn(),
        onStopAllClick: jest.fn(),
        turbo: false
    });

    test('shows turbo mode when in turbo mode', () => {
        const component = mountWithIntl(
            <Controls
                {...defaultProps()}
            />
        );
        expect(component.find(TurboMode).exists()).toEqual(false);
        component.setProps({turbo: true});
        expect(component.find(TurboMode).exists()).toEqual(true);
    });

    test('triggers the right callbacks when clicked', () => {
        const props = defaultProps();
        const component = mountWithIntl(
            <Controls
                {...props}
            />
        );
        component.find(GreenFlag).simulate('click');
        expect(props.onGreenFlagClick).toHaveBeenCalled();

        component.find(StopAll).simulate('click');
        expect(props.onStopAllClick).toHaveBeenCalled();
    });

    test('shows the destination selector beside the one native green flag', () => {
        const component = mountWithIntl(
            <Controls
                {...defaultProps()}
                destination="hub:0"
                destinationOptions={[{slot: 0, reserved: false}, {slot: 1, reserved: true}]}
                onDestinationChange={jest.fn()}
                showSpikeDestination
            />
        );
        expect(component.find('select[aria-label="Destination"]').prop('value')).toBe('hub:0');
        expect(component.find('select[aria-label="Destination"] option')).toHaveLength(3);
        expect(component.find('select[aria-label="Destination"] option').at(2)
            .prop('disabled')).toBe(true);
        expect(component.find(GreenFlag)).toHaveLength(1);
    });

    test('uses the concise Japanese destination label and hides the selector when not exposed', () => {
        const component = mount(
            <IntlProvider locale="ja-JP">
                <Controls
                    {...defaultProps()}
                    destination="pc"
                    destinationOptions={[{slot: 0, reserved: false}]}
                    onDestinationChange={jest.fn()}
                    showSpikeDestination
                />
            </IntlProvider>
        );
        expect(component.find('select[aria-label="保存先"]')).toHaveLength(1);
        expect(component.text()).toContain('通常実行');
        expect(component.text()).toContain('転送：0');
        const withoutDestination = mountWithIntl(<Controls {...defaultProps()} />);
        expect(withoutDestination.find('select[aria-label="保存先"]')).toHaveLength(0);
        withoutDestination.unmount();
    });

    const makeHubVM = snapshot => {
        const vm = new VM();
        const api = {
            hubRouterId: 'test-router',
            getState: jest.fn(() => snapshot),
            generatePython: jest.fn(),
            uploadAndRun: jest.fn(() => Promise.resolve())
        };
        const router = {
            instanceId: 'test-router',
            active: {_link: {id: 'hub-session-a'}},
            getControlCenterAPI: () => api
        };
        vm.runtime.peripheralExtensions.spikeprime = router;
        return {vm, api};
    };

    const containerProps = vm => ({
        isStarted: false,
        projectRunning: false,
        turbo: false,
        framerate: 30,
        interpolation: false,
        showSpikeDestination: true,
        vm
    });

    test('runs the normal PC destination through Scratch VM green flag', () => {
        const {vm} = makeHubVM({
            connected: true,
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerSlot: null
        });
        jest.spyOn(vm, 'start').mockImplementation(() => {});
        jest.spyOn(vm, 'greenFlag').mockImplementation(() => {});
        const component = mount(
            <IntlProvider locale="en">
                <UnconnectedControlsContainer {...containerProps(vm)} />
            </IntlProvider>
        );
        expect(component.find('select[aria-label="Destination"]').text()).toContain('Run normally');
        expect(component.find(GreenFlag)).toHaveLength(1);
        component.find(GreenFlag).simulate('click', {
            preventDefault: jest.fn(),
            shiftKey: false,
            altKey: false,
            type: 'click'
        });
        expect(vm.start).toHaveBeenCalledTimes(1);
        expect(vm.greenFlag).toHaveBeenCalledTimes(1);
        component.unmount();
    });

    test('does not fall back to PC when the selected hub transfer cannot convert a block', async () => {
        const {vm, api} = makeHubVM({
            connected: true,
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerSlot: null
        });
        jest.spyOn(vm, 'start').mockImplementation(() => {});
        jest.spyOn(vm, 'greenFlag').mockImplementation(() => {});
        api.generatePython.mockImplementation(() => {
            throw Object.assign(new Error('unsupported block'), {
                code: 'ERR_SPIKE_STANDALONE_UNSUPPORTED_VALUE',
                opcode: 'operator_add'
            });
        });
        const component = mount(
            <IntlProvider locale="ja-JP">
                <UnconnectedControlsContainer {...containerProps(vm)} />
            </IntlProvider>
        );
        component.find('select[aria-label="保存先"]').simulate('change', {
            target: {value: 'hub:0'}
        });
        component.update();
        component.find(GreenFlag).simulate('click', {
            preventDefault: jest.fn(),
            shiftKey: false,
            altKey: false,
            type: 'click'
        });
        component.update();
        expect(component.text()).toContain('転送：0');
        expect(component.text()).toContain('スロット0を消去して転送・実行');

        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'スロット0を消去して転送・実行')
                .simulate('click');
            await Promise.resolve();
        });
        component.update();
        expect(api.generatePython).toHaveBeenCalledTimes(1);
        expect(api.uploadAndRun).not.toHaveBeenCalled();
        expect(vm.greenFlag).not.toHaveBeenCalled();
        expect(component.text()).toContain('スロット0へ転送できません。このブロックはハブ単独実行に未対応です（operator_add）。「通常実行」に切り替えてください。');
        component.unmount();
    });
});
