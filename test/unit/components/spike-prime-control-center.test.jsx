import React from 'react';
import {mount} from 'enzyme';
import {act} from 'react-dom/test-utils';
import VM from 'scratch-vm';
import SpikePrimeControlCenter from '../../../src/components/spike-prime-control-center/spike-prime-control-center.jsx';

describe('SPIKE Prime control center', () => {
    let vm;
    let api;
    let snapshot;

    beforeAll(() => {
        vm = new VM();
    });

    beforeEach(() => {
        snapshot = {
            available: true,
            connected: false,
            protocol: 'spike3',
            controllerReady: false,
            controllerStatus: 'disconnected',
            controllerSlot: 19,
            angles: {pitch: null, roll: null, yaw: null},
            imuReceivedAt: null,
            portSensors: {},
            motorPorts: {},
            diagnostics: {}
        };
        api = {
            getState: jest.fn(() => snapshot),
            connect: jest.fn(() => Promise.resolve()),
            disconnect: jest.fn(() => Promise.resolve()),
            installController: jest.fn(() => Promise.resolve()),
            stop: jest.fn(() => Promise.resolve()),
            generatePython: jest.fn(() => 'print("offline")'),
            uploadAndRun: jest.fn(() => Promise.resolve())
        };
        vm.runtime.brickwrightSpikePrimeControl = api;
    });

    test('connect control invokes the extension bridge from a user action', async () => {
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );
        component.find('button[aria-label="SPIKE hub"]').simulate('click');
        await act(async () => {
            component
                .find('button')
                .filterWhere(button => button.text() === 'Connect')
                .simulate('click');
            await Promise.resolve();
        });
        expect(api.connect).toHaveBeenCalledTimes(1);
        component.unmount();
    });

    test('shows live sensor zero distinctly from missing data and marks stale readings', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            firmwareVersion: '1.8.149',
            angles: {pitch: 0, roll: null, yaw: 10},
            imuReceivedAt: Date.now() - 4000,
            portSensors: {
                A: {
                    type: 'force',
                    force: 0,
                    pressed: false,
                    receivedAt: Date.now()
                },
                F: {
                    type: 'distance',
                    distanceMM: 0,
                    receivedAt: Date.now() - 4000
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'ja-JP'}}
                vm={vm}
            />
        );
        component.find('button[aria-label="SPIKE ハブ"]').simulate('click');
        expect(component.text()).toContain('0 °');
        expect(component.text()).toContain('0 %');
        expect(component.text()).toContain('まだ受信していません');
        expect(component.text()).toContain('値の更新が止まっています');
        component.unmount();
    });

    test('offline transfer stays behind a slot review and excludes controller slot', () => {
        snapshot = {...snapshot, connected: true, controllerSlot: 19};
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );
        component.find('button[aria-label="SPIKE hub"]').simulate('click');
        const slotOptions = component.find('details select option');
        expect(slotOptions).toHaveLength(19);
        expect(slotOptions.map(option => option.prop('value'))).not.toContain(
            19
        );
        expect(api.uploadAndRun).not.toHaveBeenCalled();
        component.unmount();
    });
});
