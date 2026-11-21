import React from 'react';
import {mount} from 'enzyme';
import {act} from 'react-dom/test-utils';
import VM from 'scratch-vm';
import fs from 'fs';
import path from 'path';
import nodeVM from 'vm';
import {TextDecoder, TextEncoder} from 'util';
import SpikePrimeControlCenter from '../../../src/components/spike-prime-control-center/spike-prime-control-center.jsx';

const extensionPath = path.resolve(
    __dirname,
    '../../../static/extensions/CrispStrobe/legospike_turbowarp_transpile.js'
);

const enumProxy = new Proxy({}, {get: (_target, key) => String(key)});

const loadRealSpikeExtension = vm => {
    const source = fs.readFileSync(extensionPath, 'utf8');
    let extension;
    const scratch = {
        vm,
        extensions: {
            unsandboxed: true,
            register: instance => {
                extension = instance;
            }
        },
        ArgumentType: enumProxy,
        BlockType: enumProxy,
        Cast: {
            toString: value => String(value),
            toNumber: value => (Number.isFinite(Number(value)) ? Number(value) : 0),
            toBoolean: Boolean
        },
        BWConfirm: () => true
    };
    const sourceDocument = {
        currentScript: {src: 'https://test.invalid/CrispStrobe/legospike_turbowarp_transpile.js'},
        documentElement: {lang: 'en'}
    };
    const context = {
        Scratch: scratch,
        document: sourceDocument,
        navigator: {language: 'en', languages: ['en']},
        window: {
            location: {search: ''},
            addEventListener () {},
            setTimeout,
            clearTimeout
        },
        localStorage,
        console: {
            log () {},
            warn () {},
            error () {},
            info () {},
            debug () {}
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        DataView,
        Date,
        Promise,
        URL,
        Blob,
        JSON,
        Math,
        btoa,
        atob
    };
    nodeVM.runInNewContext(source, context, {filename: extensionPath});
    if (!extension) throw new Error('The real SPIKE extension did not register with Scratch.');
    return extension;
};

const motorNotification = (port = 5, absolutePosition = -42) => {
    const record = new Uint8Array(12);
    record[0] = 0x0a;
    record[1] = port;
    record[2] = 0x31;
    const view = new DataView(record.buffer);
    view.setInt16(3, absolutePosition, true);
    view.setInt16(5, 75, true);
    record[7] = 12;
    view.setInt32(8, 1380, true);
    return record;
};

const forceNotification = () => Uint8Array.from([0x0b, 0, 20, 1]);

describe('SPIKE control center with the actual extension source and Scratch VM', () => {
    test(
        'shares the Scratch peripheral router and decoder state',
        async () => {
            const vm = new VM();
            const extension = loadRealSpikeExtension(vm);
            const router = vm.runtime.peripheralExtensions.spikeprime;
            const api = router && router.getControlCenterAPI();

            expect(router).toBe(extension._peripheral);
            expect(api).toBe(vm.runtime.brickwrightSpikePrimeControl);
            expect(api.hubRouterId).toBe(router.instanceId);
            expect(api.getState().runtimeRegistered).toBe(true);
            expect(api.getState().sourceURL).toContain('legospike_turbowarp_transpile.js');
            expect(extension.isConnected()).toBe(api.getState().connected);
            api.setHubModel('prime');

            // Feed the real SPIKE 3 device-notification decoder the same wire
            // message shape used by the BLE transport. This is not synthetic GUI
            // state: it exercises the parser in the checked-out extension source.
            const hub = router._spike3;
            router._activeProtocol = 'spike3';
            hub._diagnostics.detectedHubModel = 'prime';
            hub._link = {
                isConnected: () => true,
                _device: {name: 'Fake SPIKE Prime'}
            };
            hub._firmware = '1.8.149';
            const records = [motorNotification(), forceNotification()];
            const payloadLength = records.reduce((total, record) => total + record.length, 0);
            const notification = new Uint8Array(3 + payloadLength);
            notification[0] = 0x3c;
            notification[1] = payloadLength & 0xff;
            notification[2] = payloadLength >> 8;
            let offset = 3;
            for (const record of records) {
                notification.set(record, offset);
                offset += record.length;
            }
            hub._handleDeviceNotification(notification);

            const component = mount(
                <SpikePrimeControlCenter
                    intl={{locale: 'en'}}
                    vm={vm}
                />
            );
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            expect(extension.isConnected()).toBe(true);
            expect(component.find('button[aria-label^="LEGO hub:"]').prop('aria-label'))
                .toContain('Connected');
            expect(component.find('[aria-label^="A:"]')).toHaveLength(1);
            expect(component.find('[aria-label^="F:"]')).toHaveLength(1);
            expect(component.find('[aria-label^="F:"]').prop('aria-label')).toContain('Large motor');
            expect(component.text()).toContain('318°');
            expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('Force sensor');
            // Live port values are visible before the optional detail panel is
            // opened, so routine monitoring never depends on a popup.
            expect(component.find('section[aria-label="LEGO hub"]')).toHaveLength(0);

            // Exercise the installed VM's real greenFlag sequence (which emits
            // PROJECT_STOP_ALL followed synchronously by PROJECT_START), then
            // feed another decoded BLE record and ensure the live row updates.
            const linkBeforeScratchRun = hub._link;
            vm.greenFlag();
            hub._handleDeviceNotification(notification);
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 220));
            });
            component.update();
            expect(extension.isConnected()).toBe(true);
            expect(hub._link).toBe(linkBeforeScratchRun);
            expect(component.text()).toContain('318°');

            component.find('button[aria-label^="LEGO hub:"]').simulate('click');
            expect(component.text()).toContain('Connected · Fake SPIKE Prime');
            expect(component.text()).toContain('Measured speed: 12 %');
            expect(component.text()).toContain('Force: 20');
            expect(component.text()).toContain('APOS (0–359°): 318 °');
            expect(component.text()).toContain('APOS raw (signed): -42°');
            expect(component.text()).toContain('POS (cumulative): 1380 °');

            component.unmount();
        }
    );

    test(
        'renders the signed Essential APOS sample decoded by the real LWP3 parser',
        () => {
            const vm = new VM();
            const extension = loadRealSpikeExtension(vm);
            const router = vm.runtime.peripheralExtensions.spikeprime;
            const api = router.getControlCenterAPI();
            api.setHubModel('essential');
            router._activeProtocol = 'essential';
            router._resolvedMode = 'web-ble';
            const hub = router._essential;
            hub._link = {
                isConnected: () => true,
                _device: {name: 'Fake SPIKE Essential'}
            };
            hub._detectedHubModel = 'essential';
            hub._firmware = '1.8.149';
            hub._devices.A = {
                type: 'motor',
                deviceType: 0x41,
                deviceName: 'Small Angular Motor',
                attachmentId: 1
            };
            hub._portModes.A = 3;
            hub._portValues.A = {
                connected: true,
                type: 'motor',
                deviceType: 0x41,
                absolutePosition: null,
                absolutePositionRaw: null,
                absolutePositionAvailable: false,
                relativePosition: 1506,
                degreesCounted: 1506,
                receivedAt: null
            };
            hub._motorPositionModes.A = {
                attachmentId: 1,
                aposStatus: 'ready',
                modeMetadata: {
                    3: {
                        format: {status: 'verified', dataSets: 1, dataType: 1, decimals: 0},
                        symbol: 'DEG',
                        siRange: {min: -180, max: 180}
                    }
                }
            };

            // LWP3 PortValue: port A, APOS mode 3, signed int16 value -90.
            hub._handleMessage(Uint8Array.from([6, 0, 0x45, 0, 0xa6, 0xff]));
            expect(api.getState().portSensors.A.absolutePosition).toBe(-90);
            expect(api.getState().portSensors.A.relativePosition).toBe(1506);

            const component = mount(
                <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
            );
            expect(component.find('[aria-label^="A:"]').prop('aria-label')).toContain('270°');
            expect(component.find('[aria-label^="A:"]').prop('aria-label')).not.toContain('1506°');
            component.find('button[aria-label^="LEGO hub:"]').simulate('click');
            expect(component.text()).toContain('APOS raw (signed): -90°');
            expect(component.text()).toContain('POS (cumulative): 1506 °');
            component.unmount();
        }
    );

    test(
        'keeps zero and negative measurements visible without treating stationary values as a failure',
        async () => {
            const vm = new VM();
            const extension = loadRealSpikeExtension(vm);
            const router = vm.runtime.peripheralExtensions.spikeprime;
            router.getControlCenterAPI().setHubModel('prime');
            const hub = router._spike3;
            router._activeProtocol = 'spike3';
            hub._diagnostics.detectedHubModel = 'prime';
            hub._link = {
                isConnected: () => true,
                _device: {name: 'Fake SPIKE Prime'}
            };
            const feedMotor = record => {
                const notification = new Uint8Array(3 + record.length);
                notification[0] = 0x3c;
                notification[1] = record.length;
                notification[2] = 0;
                notification.set(record, 3);
                hub._handleDeviceNotification(notification);
            };
            feedMotor(motorNotification(5, 0));

            const component = mount(
                <SpikePrimeControlCenter intl={{locale: 'en'}} vm={vm} />
            );
            expect(component.text()).toContain('0°');
            expect(component.find('[aria-label^="F:"]').prop('aria-label')).toContain('Large motor');

            feedMotor(motorNotification(4, -42));
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 220));
            });
            component.update();
            expect(component.text()).toContain('318°');
            hub._portValues.E.receivedAt = Date.now() - 4000;
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 220));
            });
            component.update();
            expect(component.text()).not.toContain('Reading is stale');
            expect(component.text()).toContain('318°');
            component.find('button[aria-label^="LEGO hub:"]').simulate('click');
            expect(component.text()).toContain('Last update:');
            component.unmount();
        }
    );
});
