import React from 'react';
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

    test('the green flag always uses Scratch VM execution and never converts or uploads Python', () => {
        const vm = new VM();
        const generatePython = jest.fn(() => 'should not be used');
        const uploadAndRun = jest.fn(() => Promise.resolve());
        vm.runtime.peripheralExtensions.spikeprime = {
            getControlCenterAPI: () => ({generatePython, uploadAndRun})
        };
        jest.spyOn(vm, 'start').mockImplementation(() => {});
        jest.spyOn(vm, 'greenFlag').mockImplementation(() => {});
        const component = mountWithIntl(
            <UnconnectedControlsContainer
                framerate={30}
                interpolation={false}
                isSmall={false}
                isStarted={false}
                projectRunning={false}
                turbo={false}
                vm={vm}
            />
        );

        expect(component.find('select')).toHaveLength(0);
        component.find(GreenFlag).simulate('click', {
            preventDefault: jest.fn(),
            shiftKey: false,
            altKey: false,
            type: 'click'
        });

        expect(vm.start).toHaveBeenCalledTimes(1);
        expect(vm.greenFlag).toHaveBeenCalledTimes(1);
        expect(generatePython).not.toHaveBeenCalled();
        expect(uploadAndRun).not.toHaveBeenCalled();
        component.unmount();
    });
});
