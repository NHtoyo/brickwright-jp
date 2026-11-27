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

    test('does not expose manual controller slot registration, restart or installation UI', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerReady: false,
            controllerSlot: null
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
        );
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        expect(component.find('select[aria-label="Controller slot"]')).toHaveLength(0);
        expect(component.find('button').filterWhere(button =>
            /install controller|run saved controller|register controller slot|verify controller/i.test(button.text())
        )).toHaveLength(0);
        expect(component.text()).not.toContain('Install to slot');
        expect(component.text()).not.toContain('Controller slot');
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
                A: {connected: true, type: 'motor', absolutePosition: -12, speed: 3, receivedAt: Date.now()}
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
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(0);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
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

        // The compact destination selector now lives beside the existing stage
        // green flag, not in the hub details panel.
        expect(component.find('select[aria-label="Standalone slot"]')).toHaveLength(0);
        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        expect(component.find('select[aria-label="Controller slot"]')).toHaveLength(0);
        expect(component.find('[aria-label^="C:"]')).toHaveLength(0);
        component.unmount();
    });

    test('keeps fresh zero readings but hides stale sensor values', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            firmwareVersion: '1.8.149',
            availablePorts: ['A', 'B', 'C', 'D', 'E', 'F'],
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
            },
            diagnostics: {
                ...snapshot.diagnostics,
                portObservations: {
                    A: {status: 'observed', lastObservedAt: Date.now()},
                    B: {status: 'observed', lastObservedAt: Date.now()},
                    F: {status: 'stale', lastObservedAt: Date.now() - 4000}
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
        expect(component.text()).not.toContain('0%');
        expect(component.text()).not.toContain('機器未接続');
        expect(component.text()).not.toMatch(/古い値|更新遅延|更新停止|最終受信|測定待ち|接続状態不明/);
        expect(component.find('section[aria-label="LEGO ハブ"]')).toHaveLength(0);
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('0');
        expect(component.find('[aria-label^="F:"]')).toHaveLength(0);
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).toContain('赤');
        component.find('button[aria-expanded]').simulate('click');
        expect(component.text()).not.toMatch(/古い値|更新遅延|更新停止|最終受信|測定待ち|接続状態不明/);
        expect(component.text()).not.toContain('10°');
        expect(component.text()).not.toContain('0 mm');
        expect(component.text()).toContain('力: 0');
        component.find('select[aria-label="ポート表示"]').simulate('change', {target: {value: 'state'}});
        component.update();
        expect(component.text()).toContain('押されていません');
        expect(component.text()).toContain('反射光: 21 %');
        component.unmount();
    });

    test('shows a connected Essential device name without stale or missing-value labels', () => {
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
        expect(component.find('[aria-label^="A:"]').text()).not.toMatch(/Waiting|sample|stale/i);
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).toContain('Force sensor');
        expect(component.find('[aria-label^="B:"]').prop('aria-label')).not.toMatch(/Stale|0/);
        expect(component.text()).not.toMatch(/Waiting|stale|Delayed|Updates stopped|Last update/i);
        component.unmount();
    });

    test.each([
        ['Prime', 'spike3', 'prime', ['A', 'B', 'C', 'D', 'E', 'F'], false, 'percent-of-max',
            'Measured speed: 12 %'],
        ['Essential', 'lwp3', 'essential', ['A', 'B'], true, 'degrees-per-second',
            'Derived speed (from POS): 12 °/s']
    ])('%s displays normalized APOS separately from cumulative POS',
        (name, protocol, model, ports, speedDerived, speedUnit, speedDescription) => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol,
            detectedHubModel: model,
            effectiveHubModel: model,
            availablePorts: ports,
            portSensors: {
                A: {
                    connected: true,
                    deviceType: model === 'essential' ? 0x41 : 0x30,
                    type: 'motor',
                    absolutePosition: -90,
                    absolutePositionRaw: -90,
                    relativePosition: 1506,
                    speed: 12,
                    speedDerived,
                    speedUnit,
                    receivedAt: Date.now()
                }
            },
            diagnostics: protocol === 'spike3' ? {
                ...snapshot.diagnostics,
                portObservations: {A: {status: 'observed', lastObservedAt: Date.now()}}
            } : snapshot.diagnostics
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('270°');
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).not.toContain('1506°');

        component.find('button[aria-label^="LEGO hub:"]').simulate('click');
        expect(component.text()).toContain('APOS (0–359°): 270 °');
        expect(component.text()).toContain('APOS raw (signed): -90°');
        expect(component.text()).toContain('POS (cumulative): 1506 °');
        expect(component.text()).toContain(speedDescription);
        component.unmount();
    });

    test('does not substitute cumulative POS for missing APOS and identifies measured speed', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            portSensors: {
                A: {
                    connected: true,
                    deviceType: 0x41,
                    type: 'motor',
                    absolutePosition: null,
                    absolutePositionAvailable: false,
                    relativePosition: 1506,
                    speed: 0,
                    speedDerived: false,
                    speedUnit: 'percent-of-max',
                    receivedAt: Date.now()
                }
            },
            motorPorts: {A: {absolutePosition: 8, absolutePositionRaw: -352}}
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />);
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).toBe('A: 小型モーター');
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).not.toContain('1506°');
        component.find('button[aria-expanded]').simulate('click');
        expect(component.text()).not.toContain('APOS（0～359°）: —');
        expect(component.text()).toContain('POS（累積角度）: 1506 °');
        expect(component.text()).toContain('実測速度: 0 %');
        expect(component.find('[aria-label^="A:"]').text()).toContain('小型モーター');
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
        expect(component.find('[aria-label^="A:"]').prop('aria-label')).not.toContain('0°');
        expect(component.find('[aria-label^="B:"]')).toHaveLength(0);
        expect(component.text()).not.toContain('92');
        component.find('button[aria-expanded]').simulate('click');
        expect(component.text()).toContain('小型モーター');
        expect(component.text()).not.toMatch(/最終受信|古い値|更新停止|更新遅延|測定待ち/);
        component.unmount();
    });

    test('Prime stale port observations hide cached device identity without claiming detach', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            portSensors: {
                A: {type: 'color', color: 9, receivedAt: Date.now() - 5000}
            },
            diagnostics: {
                ...snapshot.diagnostics,
                portObservations: {
                    A: {status: 'stale', lastObservedAt: Date.now() - 3000}
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );

        expect(component.find('[aria-label^="A:"]')).toHaveLength(0);
        expect(component.text()).not.toContain('No device');
        component.find('button[aria-expanded]').simulate('click');
        const textOutsideDiagnostics = component.text().replace(component.find('pre').text(), '');
        expect(textOutsideDiagnostics).not.toMatch(/Stale|old value|Last update|Waiting for sample/i);
        expect(component.text()).not.toContain('Color sensor');
        expect(component.text()).not.toContain('No device');
        expect(component.text()).not.toContain('Disconnected');
        component.unmount();
    });

    test('Prime type-only or malformed records remain unknown until a validated observation arrives', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            portSensors: {
                A: {type: 'distance', distanceMM: 0, receivedAt: 'not-a-timestamp'}
            },
            diagnostics: {
                ...snapshot.diagnostics,
                portObservations: {
                    A: {status: 'unknown', lastObservedAt: null}
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );

        expect(component.find('[aria-label^="A:"]')).toHaveLength(0);
        expect(component.text()).not.toContain('Distance sensor');
        expect(component.text()).not.toContain('No device');
        expect(component.text()).not.toContain('Disconnected');
        component.unmount();
    });

    test('an Essential type-only stale record is unknown without explicit attachment evidence', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            portSensors: {
                A: {type: 'motor', receivedAt: Date.now() - 5000}
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter
                intl={{locale: 'en'}}
                vm={vm}
            />
        );

        expect(component.find('[aria-label^="A:"]')).toHaveLength(0);
        expect(component.text()).not.toContain('No device');
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
        component.find('button[aria-expanded]').simulate('click');
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
        component.find('button[aria-expanded]').simulate('click');
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

    test('the control panel keeps diagnostics and sensor detail but never exposes internal slot management', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            deviceName: 'SPIKE Prime',
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            standaloneCapable: true,
            controllerReady: true,
            controllerSlot: 0
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(
            <SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />
        );
        expect(component.find('select[aria-label="単独実行の保存先"]')).toHaveLength(0);
        component.find('button[aria-expanded]').simulate('click');
        expect(component.find('select[aria-label="接続方式"]')).toHaveLength(1);
        expect(component.find('select[aria-label="制御プログラム用スロット"]')).toHaveLength(0);
        expect(component.text()).not.toContain('制御プログラムを導入');
        expect(component.text()).not.toContain('保存済みスロット0のプログラムを起動');
        expect(component.text()).toContain('通信診断');
        component.unmount();
    });

    test('port details keep communication diagnostics in the existing diagnostics section', () => {
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'lwp3',
            detectedHubModel: 'essential',
            effectiveHubModel: 'essential',
            availablePorts: ['A', 'B'],
            portSensors: {
                A: {
                    connected: true,
                    attachmentId: 17,
                    deviceType: 0x30,
                    type: 'motor',
                    receivedAt: Date.now()
                }
            },
            diagnostics: {
                sensorScheduler: {
                    ports: {
                        A: {
                            attachmentId: 17,
                            mode: 3,
                            targetIntervalMs: 25,
                            averageIntervalMs: 24.5,
                            medianIntervalMs: 24,
                            p95IntervalMs: 32,
                            effectiveHz: 40.82,
                            lastSampleAgeMs: 12,
                            pollsSent: 8,
                            queuedExpirations: 1,
                            writeFailures: 2,
                            noSampleCount: 3,
                            spontaneousNotificationCount: 6,
                            ambiguousResponseCount: 4,
                            currentPollIntervalMs: 50,
                            communicationState: 'DEGRADED',
                            lastError: 'sample timeout'
                        }
                    }
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'ja-JP'}} vm={vm} />);
        component.find('button[aria-expanded]').simulate('click');
        expect(component.find('summary').filterWhere(summary => summary.text() === 'センサー通信の詳細')).toHaveLength(0);
        expect(component.text()).not.toContain('平均受信間隔');
        expect(component.text()).not.toContain('最終測定からの経過');
        expect(component.find('summary').filterWhere(summary => summary.text() === '通信診断')).toHaveLength(1);
        expect(component.find('pre').text()).toContain('24.5');
        expect(component.find('pre').text()).toContain('"mode": 3');
        expect(component.find('pre').text()).toContain('"attachmentId": 17');
        component.unmount();
    });

    test('Prime shows only connected C and E devices and keeps the hub control after the scroll region', () => {
        const receivedAt = Date.now();
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            availablePorts: ['A', 'B', 'C', 'D', 'E', 'F'],
            portSensors: {
                A: {type: 'motor', deviceType: 0x30, absolutePosition: 0, receivedAt},
                C: {type: 'motor', deviceType: 0x30, absolutePosition: 90, receivedAt},
                E: {type: 'motor', deviceType: 0x31, absolutePosition: 180, receivedAt}
            },
            diagnostics: {
                portObservations: {
                    A: {status: 'unknown', lastObservedAt: null},
                    C: {status: 'observed', lastObservedAt: receivedAt, type: 'motor', deviceType: 0x30},
                    E: {status: 'observed', lastObservedAt: receivedAt, type: 'motor', deviceType: 0x31},
                    F: {status: 'stale', lastObservedAt: receivedAt - 3000, type: 'motor', deviceType: 0x30}
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);

        expect(component.find('[aria-label^="A:"]')).toHaveLength(0);
        expect(component.find('[aria-label^="B:"]')).toHaveLength(0);
        expect(component.find('[aria-label^="C:"]')).toHaveLength(1);
        expect(component.find('[aria-label^="D:"]')).toHaveLength(0);
        expect(component.find('[aria-label^="E:"]')).toHaveLength(1);
        expect(component.find('[aria-label^="F:"]')).toHaveLength(0);
        expect(component.text()).not.toMatch(/unknown|stale|waiting|last update|old value/i);
        const strip = component.find('[aria-label="Ports"]');
        const hub = component.find('button[aria-label^="LEGO hub:"]');
        expect(strip.length).toBe(1);
        expect(hub.length).toBe(1);
        expect(strip.getDOMNode().parentElement.lastElementChild).toBe(hub.getDOMNode());
        component.unmount();
    });

    test.each(['A', 'B', 'C', 'D', 'E', 'F'])('Prime port %s renders when observed and disappears on hub disconnect', port => {
        const receivedAt = Date.now();
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            portSensors: {[port]: {type: 'motor', deviceType: 0x30, absolutePosition: 45, receivedAt}},
            diagnostics: {
                portObservations: {
                    [port]: {status: 'observed', lastObservedAt: receivedAt, type: 'motor', deviceType: 0x30}
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        expect(component.find(`[aria-label^="${port}:"]`)).toHaveLength(1);
        snapshot = {...snapshot, connected: false};
        component.instance().refresh();
        component.update();
        expect(component.find(`[aria-label^="${port}:"]`)).toHaveLength(0);
        component.unmount();
    });

    test('device replacement shows only the new confirmed type and omits invalid measurements', () => {
        const receivedAt = Date.now();
        snapshot = {
            ...snapshot,
            connected: true,
            protocol: 'spike3',
            detectedHubModel: 'prime',
            effectiveHubModel: 'prime',
            portSensors: {C: {type: 'motor', deviceType: 0x30, absolutePosition: 120, receivedAt}},
            diagnostics: {
                portObservations: {
                    C: {status: 'observed', lastObservedAt: receivedAt, type: 'motor', deviceType: 0x30}
                }
            }
        };
        api.getState.mockImplementation(() => snapshot);
        const component = mount(<SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />);
        expect(component.find('[aria-label^="C:"]').prop('aria-label')).toContain('Medium motor');
        snapshot = {
            ...snapshot,
            portSensors: {C: {connected: true, type: 'distance', receivedAt: null}},
            diagnostics: {
                portObservations: {
                    C: {status: 'observed', lastObservedAt: Date.now(), type: 'distance', deviceType: 0x3e}
                }
            }
        };
        component.instance().refresh();
        component.update();
        expect(component.find('[aria-label^="C:"]').prop('aria-label')).toContain('Distance sensor');
        expect(component.find('[aria-label^="C:"]').prop('aria-label')).not.toContain('Medium motor');
        expect(component.find('[aria-label^="C:"]').prop('aria-label')).not.toContain('120');
        component.unmount();
    });
});
