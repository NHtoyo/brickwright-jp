import React from 'react';
import {IntlProvider} from 'react-intl';
import {mount} from 'enzyme';
import {mountWithIntl} from '../../helpers/intl-helpers.jsx';
import Controls from '../../../src/components/controls/controls';
import TurboMode from '../../../src/components/turbo-mode/turbo-mode';
import GreenFlag from '../../../src/components/green-flag/green-flag';
import StopAll from '../../../src/components/stop-all/stop-all';

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
        expect(component.text()).toContain('ハブ 0');
        const withoutDestination = mountWithIntl(<Controls {...defaultProps()} />);
        expect(withoutDestination.find('select[aria-label="保存先"]')).toHaveLength(0);
        withoutDestination.unmount();
    });
});
