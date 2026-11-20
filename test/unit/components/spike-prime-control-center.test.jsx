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
            selectedHubModel: 'auto',
            detectedHubModel: null,
            effectiveHubModel: null,
            modelMismatch: false,
            modelStatus: 'waiting',
            modelWarning: null,
            availablePorts: ['A', 'B', 'C', 'D', 'E', 'F'],
            standaloneCapable: true,
            controllerReady: false,
            controllerStatus: 'disconnected',
            controllerSlot: null,
            angles: {pitch: null, roll: null, yaw: null},
            imuReceivedAt: null,
            portSensors: {},
            motorPorts: {},
            diagnostics: {}
        };
        api = {
            extensionId: 'spikeprime',
            hubRouterId: 'test-router',
            getState: jest.fn(() => snapshot),
            connect: jest.fn(() => Promise.resolve()),
            setHubModel: jest.fn(model => {
                snapshot = {...snapshot, selectedHubModel: model};
            }),
            disconnect: jest.fn(() => Promise.resolve()),
            installController: jest.fn(() => Promise.resolve()),
            stop: jest.fn(() => Promise.resolve()),
            generatePython: jest.fn(() => 'print("offline")'),
            uploadAndRun: jest.fn(() => Promise.resolve())
        };
        vm.runtime.peripheralExtensions.spikeprime = {
            instanceId: 'test-router',
            getControlCenterAPI: () => api
        };
        api.hubRouterId = 'test-router';
    });

    test('connect control invokes the extension bridge from a user action', async () => {
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
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

    test('does not probe on connection and verifies the controller only from its explicit Prime action', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true
        };
        api.verifyController = jest.fn(() => Promise.resolve({version: 'controller/1'}));
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );

        expect(api.verifyController).not.toHaveBeenCalled();
        expect(api.installController).not.toHaveBeenCalled();
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === 'Controller')
            .find('summary').simulate('click');
        expect(component.find('button').filterWhere(button => button.text() === 'Verify controller'))
            .toHaveLength(1);
        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'Verify controller')
                .simulate('click');
            await Promise.resolve();
        });
        expect(api.verifyController).toHaveBeenCalledTimes(1);
        expect(api.installController).not.toHaveBeenCalled();
        component.unmount();
    });

    test('starts the explicitly confirmed saved controller without transferring or clearing the slot', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerSlot: 7,
            deviceId: 'hub-session-a'
        };
        api.startSavedController = jest.fn(() => Promise.resolve({ready: true}));
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />);
        expect(api.startSavedController).not.toHaveBeenCalled();
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === '制御プログラム')
            .find('summary').simulate('click');

        component.find('button').filterWhere(button => button.text() === '保存済みスロット7のプログラムを起動')
            .simulate('click');
        component.update();
        expect(component.text()).toContain('スロット7に現在保存されているプログラムを起動します。転送・消去は行いません。');
        expect(api.startSavedController).not.toHaveBeenCalled();
        expect(api.installController).not.toHaveBeenCalled();

        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'スロット7を起動').simulate('click');
            await Promise.resolve();
        });
        expect(api.startSavedController).toHaveBeenCalledTimes(1);
        expect(api.startSavedController).toHaveBeenCalledWith(7);
        expect(api.installController).not.toHaveBeenCalled();
        expect(api.uploadAndRun).not.toHaveBeenCalled();
        component.unmount();
    });

    test('cancels a saved-controller confirmation if the connected hub session changes', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerSlot: 7,
            deviceId: 'hub-session-a'
        };
        api.startSavedController = jest.fn(() => Promise.resolve({ready: true}));
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === 'Controller')
            .find('summary').simulate('click');
        component.find('button').filterWhere(button => button.text() === 'Run saved controller in slot 7')
            .simulate('click');
        expect(component.text()).toContain('This starts the program currently stored in slot 7.');

        snapshot = {...snapshot, deviceId: 'hub-session-b'};
        await act(async () => {
            component.instance().refresh();
            await Promise.resolve();
        });
        component.update();
        expect(component.text()).not.toContain('Start slot 7');
        expect(api.startSavedController).not.toHaveBeenCalled();
        component.unmount();
    });

    test('does not offer a saved-controller restart while that controller is already ready', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerReady: true,
            controllerSlot: 7,
            deviceId: 'hub-session-a'
        };
        api.startSavedController = jest.fn(() => Promise.resolve({ready: true}));
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === 'Controller')
            .find('summary').simulate('click');
        expect(component.find('button').filterWhere(button => button.text() === 'Run saved controller in slot 7'))
            .toHaveLength(0);
        expect(api.startSavedController).not.toHaveBeenCalled();
        component.unmount();
    });

    test('selects SPIKE Essential, shows A/B only, and hides Prime slot controls', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            selectedHubModel: 'auto',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            standaloneCapable: false,
            portSensors: {
                A: {type: 'motor', absolutePosition: -12, speed: 3, receivedAt: Date.now()}
            }
        };
        api.setHubModel.mockImplementation(model => {
            snapshot = {
                ...snapshot,
                selectedHubModel: model,
                modelMismatch: model === 'prime',
                modelWarning: model === 'prime' ? 'Mismatch from fake API' : null
            };
        });
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        expect(component.find('select[aria-label="Hub standalone"]')).toHaveLength(0);
        expect(component.find('select[aria-label="Controller slot"]')).toHaveLength(0);
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('Motor');
        for (const port of ['C', 'D', 'E', 'F']) {
            expect(component.find(`[aria-label^="${port}:"]`)).toHaveLength(0);
        }

        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('select[aria-label="Hub model"]').simulate('change', {
            target: {value: 'prime'}
        });
        await act(async () => {
            await Promise.resolve();
        });
        component.update();
        expect(api.setHubModel).toHaveBeenCalledWith('prime');
        expect(component.text()).toContain('Selected and detected models differ');
        component.unmount();
    });

    test('keeps a user-selected hub model when the polling snapshot is stale', async () => {
        // A disconnected extension can report standaloneCapable=false until it
        // identifies the active transport, but Prime slot settings still need
        // to be configurable before a connection is made.
        snapshot = {...snapshot, standaloneCapable: false};
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(1);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(1);
        await act(async () => {
            component.find('select[aria-label="Hub model"]').simulate('change', {
                target: {value: 'essential'}
            });
            await Promise.resolve();
        });
        component.update();
        expect(component.find('select[aria-label="Hub model"]').prop('value')).toBe('essential');
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(0);

        // The extension has not acknowledged the selection yet; its poll still
        // reports the old Auto value. The control must retain the explicit user choice.
        component.instance().refresh();
        component.update();
        expect(component.find('select[aria-label="Hub model"]').prop('value')).toBe('essential');
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(0);
        expect(component.text()).not.toContain('Controller slot');
        component.unmount();
    });

    test('does not infer an offline Essential hub from a stale protocol snapshot', () => {
        snapshot = {
            ...snapshot,
            connected: false,
            protocol: 'lwp3-essential',
            selectedHubModel: 'auto',
            detectedHubModel: null,
            effectiveHubModel: null,
            modelStatus: 'not-connected',
            availablePorts: ['A', 'B'],
            standaloneCapable: false
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );

        // Auto mode stays configurable offline; only an explicitly selected
        // Essential hub hides slot-based execution.
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(1);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(1);
        expect(component.find('select[aria-label="Controller slot"]')).toHaveLength(1);
        expect(component.find('[aria-label^="C:"]')).toHaveLength(0);
        component.unmount();
    });

    test('shows zero and missing readings without a false stale warning', () => {
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
                B: {
                    type: 'color',
                    color: 9,
                    red: 100,
                    green: 10,
                    blue: 0,
                    reflection: 21,
                    receivedAt: Date.now()
                },
                F: {
                    type: 'distance',
                    distanceMM: 0,
                    receivedAt: Date.now() - 4000
                }
            },
            motorPorts: {
                E: {absolutePosition: 0, relativePosition: 0, speed: 0, receivedAt: Date.now()}
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'ja-JP'}}
                vm={vm}
            />
        );
        expect(component.text()).toContain('0°');
        expect(component.text()).not.toContain('0%');
        expect(component.text()).not.toContain('機器未接続');
        expect(component.text()).not.toContain('値の更新が止まっています');
        expect(component.text()).not.toContain('Reading is stale');
        expect(component.find('section[aria-label="LEGO ハブ"]')).toHaveLength(0);
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('0');
        expect(component.find('[aria-label^="F:"]').prop('aria-label')).toContain('0 mm');
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).toContain('赤');
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        expect(component.text()).toContain('力: 0');
        component.find('select[aria-label="ポート表示"]').simulate('change', {target: {value: 'state'}});
        component.update();
        expect(component.text()).toContain('押されていません');
        expect(component.text()).toContain('反射光: 21 %');
        component.unmount();
    });

    test('shows an Essential motor model before its first value and retains stationary values', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            standaloneCapable: false,
            portSensors: {
                A: {connected: true, deviceType: 0x41, type: 'motor', receivedAt: null},
                B: {
                    connected: true,
                    deviceType: 0x3f,
                    type: 'force',
                    force: 0,
                    pressed: false,
                    receivedAt: Date.now() - 5000
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('Small motor');
        expect(component.find('[aria-label^="A:"]').text()).toContain('No reading yet');
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).toContain('Force sensor');
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).toContain('0');
        expect(component.text()).not.toContain('stale');
        component.unmount();
    });

    test('uses localized motor names and clears cached readings after physical detach', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            standaloneCapable: false,
            portSensors: {
                A: {connected: true, deviceType: 0x41, type: 'motor', receivedAt: Date.now() - 4000},
                B: {connected: false, type: 'unknown', receivedAt: null}
            },
            motorPorts: {
                A: {absolutePosition: 0, relativePosition: 0, speed: 0, receivedAt: Date.now() - 4000},
                B: {absolutePosition: 92, relativePosition: 92, speed: 20, receivedAt: Date.now() - 50}
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />
        );
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('小型モーター');
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('0°');
        expect(component.find('[aria-label^="B:"]')).toHaveLength(0);
        expect(component.text()).not.toContain('92');
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        expect(component.text()).toContain('小型モーター');
        expect(component.text()).toContain('最終受信：約');
        expect(component.text()).not.toContain('値の更新が止まっています');
        component.unmount();
    });

    test('reports an unsupported operation without classifying it as a connection failure', async () => {
        snapshot = {...snapshot, connected: true, deviceName: 'SPIKE Essential'};
        api.getState.mockImplementation(() => snapshot);
        api.stop.mockRejectedValue(Object.assign(new Error('internal capability detail'), {
            code: 'ERR_SPIKE_UNSUPPORTED_CAPABILITY',
            kind: 'unsupported-capability'
        }));
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />
        );
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'ハブのプログラムを停止')
                .simulate('click');
            await Promise.resolve();
        });
        component.update();
        expect(component.text()).toContain('接続中のハブではこの操作を利用できません。');
        expect(component.find('button[aria-label^="LEGO ハブ:"]').prop('aria-label')).toContain('接続済み');
        expect(component.text()).not.toContain('接続エラー');
        component.unmount();
    });

    test('reports an unsupported accessory separately from transport failure', async () => {
        snapshot = {...snapshot, connected: true, deviceName: 'SPIKE Essential'};
        api.getState.mockImplementation(() => snapshot);
        api.stop.mockRejectedValue(Object.assign(new Error('unsupported accessory'), {
            code: 'ERR_SPIKE_DEVICE_UNSUPPORTED',
            kind: 'unsupported-device'
        }));
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />
        );
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'ハブのプログラムを停止')
                .simulate('click');
            await Promise.resolve();
        });
        component.update();
        expect(component.text()).toContain('この機器は接続中のハブでは利用できません。');
        expect(component.find('button[aria-label^="LEGO ハブ:"]').prop('aria-label')).toContain('接続済み');
        expect(component.text()).not.toContain('接続エラー');
        component.unmount();
    });

    test('slot selection stays available and transfer is guarded by review', async () => {
        snapshot = {...snapshot, connected: true, deviceName: 'SPIKE Prime', controllerSlot: 19};
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );
        const slotSelect = component.find('select[aria-label="Standalone slot"]');
        expect(slotSelect.prop('value')).toBe(0);
        expect(slotSelect.find('option')).toHaveLength(20);
        expect(slotSelect.find('option').filterWhere(option => option.prop('value') === 19).prop('disabled')).toBe(true);
        slotSelect.simulate('change', {target: {value: '7'}});
        component.find('button').filterWhere(button => button.text() === 'Transfer and run').simulate('click');
        component.update();
        expect(component.text()).toContain('Slot 7 will be cleared before the program is transferred.');
        expect(api.uploadAndRun).not.toHaveBeenCalled();
        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'Clear, upload, and run slot 7').simulate('click');
            await Promise.resolve();
        });
        expect(api.generatePython).toHaveBeenCalledTimes(1);
        expect(api.uploadAndRun).toHaveBeenCalledWith(7, 'print("offline")');
        component.unmount();
    });

    test('controller and standalone slot settings remain visible before connecting', () => {
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'ja-JP'}}
                vm={vm}
            />
        );
        expect(component.find('select[aria-label="単独実行の保存先"]')).toHaveLength(1);
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        expect(component.find('select[aria-label="接続方式"]')).toHaveLength(1);
        expect(component.find('select[aria-label="単独実行の保存先"] option')).toHaveLength(20);
        expect(component.text()).toContain('PC上のScratch：緑の旗で実行');
        component.find('details').filterWhere(details => details.find('summary').text() === '制御プログラム').
            find('summary').simulate('click');
        expect(component.find('select[aria-label="制御プログラム用スロット"] option')).toHaveLength(20);
        expect(component.find('button')
            .filterWhere(button => button.text() === '制御プログラムを導入')
            .prop('disabled')).toBe(true);
        component.unmount();
    });

    test('confirms the slot 0 controller install and only then schedules known old-slot cleanup', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            controllerReady: true,
            controllerSlot: 19,
            controllerMigrationSlot: 19
        };
        api.getState.mockImplementation(() => snapshot);
        api.installController.mockResolvedValue({cleanup: {status: 'deleted', previousSlot: 19}});
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === 'Controller').
            find('summary').simulate('click');
        expect(component.find('select[aria-label="Controller slot"]').prop('value')).toBe(0);
        expect(component.text()).toContain('Ready · Controller slot 19');
        component.find('button').filterWhere(button => button.text() === 'Install controller').simulate('click');
        component.update();
        expect(component.text()).toContain('Install to slot 0');
        expect(component.text()).toContain('slot 19 is cleared before the new program starts');
        expect(api.installController).not.toHaveBeenCalled();
        await act(async () => {
            component.find('button').filterWhere(button => button.text() === 'Install to slot 0').simulate('click');
            await Promise.resolve();
        });
        expect(api.installController).toHaveBeenCalledWith(0, {previousSlot: 19});
        component.unmount();
    });

    test('reports failed old-slot cleanup in Japanese after the new controller is ready', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            controllerReady: true,
            controllerSlot: 19,
            controllerMigrationSlot: 19
        };
        api.getState.mockImplementation(() => snapshot);
        api.installController.mockResolvedValue({
            cleanup: {
                status: 'failed',
                previousSlot: 19,
                newControllerReady: true,
                error: {name: 'Error', message: 'clear response timed out'}
            }
        });
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />);
        component.find('button[aria-label^="LEGO ハブ:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === '制御プログラム')
            .find('summary').simulate('click');
        component.find('button').filterWhere(button => button.text() === '制御プログラムを導入').simulate('click');
        component.update();
        await act(async () => {
            component.find('button').filterWhere(button => button.text().includes('次のスロットに導入 0'))
                .simulate('click');
            await Promise.resolve();
        });
        component.update();
        expect(api.installController).toHaveBeenCalledWith(0, {previousSlot: 19});
        expect(component.text()).toContain('新しい制御プログラムは起動しましたが');
        expect(component.text()).toContain('clear response timed out');
        expect(component.text()).not.toContain('[object Object]');
        expect(component.text()).not.toContain('次のスロットに導入 0');
        component.unmount();
    });

    test('does not describe the controller as ready when install explicitly reports not ready', async () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            controllerReady: true,
            controllerSlot: 19,
            controllerMigrationSlot: 19
        };
        api.getState.mockImplementation(() => snapshot);
        api.installController.mockResolvedValue({
            cleanup: {
                status: 'failed',
                previousSlot: 19,
                newControllerReady: false,
                previousSlotRemains: false,
                error: {name: 'Error', message: 'hello timed out'}
            }
        });
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('details').filterWhere(details => details.find('summary').text() === 'Controller')
            .find('summary').simulate('click');
        component.find('button').filterWhere(button => button.text() === 'Install controller').simulate('click');
        component.update();
        await act(async () => {
            component.find('button').filterWhere(button => button.text().includes('Install to slot 0'))
                .simulate('click');
            await Promise.resolve();
        });
        component.update();
        expect(component.text()).toContain('The new controller did not reach ready state.');
        expect(component.text()).not.toContain('The new controller is ready');
        expect(component.text()).toContain('Previous slot 19: the previous controller was cleared after the new transfer.');
        expect(component.text()).not.toContain('Install to slot 0');
        component.unmount();
    });

    test('keeps a newly reserved destination visible, clears old confirmation, and blocks a write', async () => {
        snapshot = {...snapshot, connected: true, deviceName: 'SPIKE Prime'};
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        component.find('select[aria-label="Standalone slot"]').simulate('change', {target: {value: '1'}});
        expect(component.find('select[aria-label="Standalone slot"]').prop('value')).toBe(1);
        component.find('button').filterWhere(button => button.text() === 'Transfer and run').simulate('click');
        expect(component.text()).toContain('Slot 1 will be cleared before the program is transferred.');
        snapshot = {...snapshot, controllerSlot: 1};
        await act(async () => {
            component.instance().refresh();
            await Promise.resolve();
        });
        component.update();
        expect(component.find('select[aria-label="Standalone slot"]').prop('value')).toBe(1);
        expect(component.find('select[aria-label="Standalone slot"] option')
            .filterWhere(option => option.prop('value') === 1).prop('disabled')).toBe(true);
        expect(component.text()).not.toContain('Clear, upload, and run slot 1');
        expect(component.find('button').filterWhere(button => button.text() === 'Transfer and run').prop('disabled')).toBe(true);
        expect(api.uploadAndRun).not.toHaveBeenCalled();
        component.unmount();
    });
});
