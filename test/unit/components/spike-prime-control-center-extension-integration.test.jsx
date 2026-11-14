import React from 'react';
import {mount} from 'enzyme';
import {act} from 'react-dom/test-utils';
import VM from 'scratch-vm';
import fs from 'fs';
import path from 'path';
import nodeVM from 'vm';
import {TextDecoder, TextEncoder} from 'util';
import SpikePrimeControlCenter from '../../../src/components/spike-prime-control-center/spike-prime-control-center.jsx';

const extensionPath = process.env.BRICKWRIGHT_SPIKE_EXTENSION_PATH || path.resolve(
    __dirname,
    '../../../../brickwright-jp-extensions-spikeprime/extensions/CrispStrobe/legospike_turbowarp_transpile.js'
);
const hasExtensionSource = fs.existsSync(extensionPath);
const testIfExtensionAvailable = hasExtensionSource ? test : test.skip;

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

const motorNotification = () => {
    const record = new Uint8Array(12);
    record[0] = 0x0a;
    record[1] = 5; // Port F.
    record[2] = 0x31;
    const view = new DataView(record.buffer);
    view.setInt16(3, -42, true);
    view.setInt16(5, 75, true);
    record[7] = 12;
    view.setInt32(8, 1380, true);
    return record;
};

const forceNotification = () => Uint8Array.from([0x0b, 0, 20, 1]);

describe('SPIKE control center with the actual extension source and Scratch VM', () => {
    testIfExtensionAvailable(
        'shares the Scratch peripheral router, decoder state, and slot action',
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

            // Feed the real SPIKE 3 device-notification decoder the same wire
            // message shape used by the BLE transport. This is not synthetic GUI
            // state: it exercises the parser in the checked-out extension source.
            const hub = router._spike3;
            router._activeProtocol = 'spike3';
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
            component.find('button[aria-label="SPIKE hub"]').simulate('click');
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            expect(extension.isConnected()).toBe(true);
            expect(component.text()).toContain('Connected · Fake SPIKE Prime');
            expect(component.text()).toContain('Motor');
            expect(component.text()).toContain('-42 °');
            expect(component.text()).toContain('1380 °');
            expect(component.text()).toContain('12 °/s');
            expect(component.text()).toContain('Force sensor');
            expect(component.text()).toContain('20 %');

            extension.installHubController = jest.fn(() => Promise.resolve());
            component.find('select[aria-label="Controller slot"]').simulate('change', {
                target: {value: '7'}
            });
            component.find('button')
                .filterWhere(button => button.text() === 'Install controller')
                .simulate('click');
            component.update();
            component.find('button')
                .filterWhere(button => button.text().includes('Install to slot 7'))
                .simulate('click');
            await act(async () => {
                await Promise.resolve();
            });
            expect(extension.installHubController).toHaveBeenCalledWith({SLOT: 7});
            component.unmount();
        }
    );
});
