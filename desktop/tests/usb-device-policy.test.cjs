const assert = require('node:assert/strict');
const test = require('node:test');
const {BluetoothSelectionQueue} = require('../bluetooth-selection.cjs');
const {
    createUsbDevicePermissionPolicy,
    handleUsbSelectionRequest,
    toPublicUsbDevice
} = require('../usb-device-policy.cjs');

const trustedOrigin = origin => {
    try {
        const url = new URL(origin);
        return url.protocol === 'app:' && url.hostname === 'brickwright' && url.pathname === '/editor.html';
    } catch (error) {
        return false;
    }
};

test('WebUSB selection requires a trusted editor gesture and approves only the selected device', () => {
    const approved = createUsbDevicePermissionPolicy({isTrustedOrigin: trustedOrigin});
    let requestId = null;
    let chooserDevices = [];
    let answer;
    let prevented = false;
    const queue = new BluetoothSelectionQueue({
        onOpen: id => {
            requestId = id;
        },
        onDevices: (_id, devices) => {
            chooserDevices = devices;
        }
    });
    const frame = {url: 'app://brickwright/editor.html', top: null};
    frame.top = frame;
    const deviceList = [{
        deviceId: 'usb-1',
        vendorId: 0x0d28,
        productId: 0x0204,
        manufacturerName: 'ARM',
        productName: 'BBC micro:bit'
    }];

    handleUsbSelectionRequest(queue, {preventDefault: () => {
        prevented = true;
    }}, {
        frame,
        deviceList
    }, id => {
        answer = id;
    }, {
        isTrustedFrame: candidate => candidate === frame && trustedOrigin(candidate.url),
        approve: (id, origin) => approved.approve(id, origin)
    });

    assert.equal(prevented, true);
    assert.equal(requestId, 1);
    assert.deepEqual(chooserDevices, [{deviceId: 'usb-1', deviceName: 'ARM BBC micro:bit'}]);
    assert.equal(approved.allow({deviceType: 'usb', origin: frame.url, device: {deviceId: 'usb-1'}}), false);
    assert.equal(queue.select(requestId, 'not-listed'), false);
    assert.equal(queue.select(requestId, 'usb-1'), true);
    assert.equal(answer, 'usb-1');
    assert.equal(approved.allow({deviceType: 'usb', origin: frame.url, device: {deviceId: 'usb-1'}}), true);
    assert.equal(approved.allow({deviceType: 'usb', origin: 'https://example.com', device: {deviceId: 'usb-1'}}), false);
    assert.equal(approved.allow({deviceType: 'hid', origin: frame.url, device: {deviceId: 'usb-1'}}), false);
    assert.equal(approved.revoke('usb-1'), true);
    assert.equal(approved.allow({deviceType: 'usb', origin: frame.url, device: {deviceId: 'usb-1'}}), false);
    queue.dispose();
});

test('WebUSB cancels untrusted requests and never grants a permission', () => {
    const approved = createUsbDevicePermissionPolicy({isTrustedOrigin: trustedOrigin});
    let answer = 'not-called';
    const queue = new BluetoothSelectionQueue({onOpen: () => {
        assert.fail('untrusted chooser must not open');
    }});
    let prevented = false;
    handleUsbSelectionRequest(queue, {preventDefault: () => {
        prevented = true;
    }}, {
        frame: {url: 'https://example.com', top: null},
        deviceList: [{deviceId: 'usb-2'}]
    }, id => {
        answer = id;
    }, {
        isTrustedFrame: candidate => trustedOrigin(candidate.url),
        approve: (id, origin) => approved.approve(id, origin)
    });
    assert.equal(prevented, true);
    assert.equal(answer, void 0);
    assert.equal(approved.hasApproval('usb-2'), false);
    queue.dispose();
});

test('WebUSB device labels have a stable VID/PID fallback', () => {
    assert.deepEqual(toPublicUsbDevice({deviceId: 'usb-3', vendorId: 0x1234, productId: 0xabcd}), {
        deviceId: 'usb-3',
        deviceName: 'USB機器（VID 1234 / PID abcd）'
    });
});
