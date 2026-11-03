import React from 'react';
import {shallow} from 'enzyme';
import DefaultMonitor from '../../../src/components/monitor/default-monitor';
import Monitor from '../../../src/components/monitor/monitor';
import {BLOCKS_HIGH_CONTRAST, Theme} from '../../../src/lib/themes';

describe('Monitor Component', () => {
    test('it selects the correct colors based on default theme', () => {
        const noop = () => {};

        const wrapper = shallow(<Monitor
            category="motion"
            // eslint-disable-next-line react/jsx-no-bind
            componentRef={noop}
            draggable={false}
            label="My label"
            mode="default"
            // eslint-disable-next-line react/jsx-no-bind
            onDragEnd={noop}
            // eslint-disable-next-line react/jsx-no-bind
            onNextMode={noop}
            theme={Theme.light}
        />);

        const defaultMonitor = wrapper.find(DefaultMonitor);

        const colors = Theme.light.getStageBlockColors();
        expect(defaultMonitor.props().categoryColor).toEqual({
            background: colors.motion.primary,
            text: colors.text
        });
    });

    test('it selects the correct colors based on dark mode theme', () => {
        const noop = () => {};
        const theme = Theme.light.set('blocks', BLOCKS_HIGH_CONTRAST);

        const wrapper = shallow(<Monitor
            category="motion"
            // eslint-disable-next-line react/jsx-no-bind
            componentRef={noop}
            draggable={false}
            label="My label"
            mode="default"
            // eslint-disable-next-line react/jsx-no-bind
            onDragEnd={noop}
            // eslint-disable-next-line react/jsx-no-bind
            onNextMode={noop}
            theme={theme}
        />);

        const defaultMonitor = wrapper.find(DefaultMonitor);

        const colors = theme.getStageBlockColors();
        expect(defaultMonitor.props().categoryColor).toEqual({
            background: colors.motion.primary,
            text: colors.text
        });
    });
});
