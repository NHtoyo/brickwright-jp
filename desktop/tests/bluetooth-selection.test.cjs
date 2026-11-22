'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {BluetoothSelectionQueue, handleBluetoothSelectionRequest} = require('../bluetooth-selection.cjs');

const queueHarness = options => {
    const opened = [];
    const updates = [];
    const closed = [];
    const queue = new BluetoothSelectionQueue({
        onOpen: id => opened.push(id),
        onDevices: (id, devices) => updates.push({id, devices}),
        onClose: id => closed.push(id),
        ...options
    });
    return {queue, opened, updates, closed};
};

test('prevents Chromium auto-selection and waits for an explicit device choice', () => {
    const {queue, opened, updates} = queueHarness();
    const callbacks = [];
    let prevented = false;
    const id = handleBluetoothSelectionRequest(queue, {preventDefault: () => { prevented = true; }}, [
        {deviceId: 'device-1', deviceName: 'SPIKE Prime'}
    ], value => callbacks.push(value));

    assert.equal(prevented, true);
    assert.equal(opened[0], id);
    assert.equal(updates.at(-1).devices[0].deviceName, 'SPIKE Prime');
    assert.deepEqual(callbacks, [], 'the first detected device must never be selected automatically');
    assert.equal(queue.select(id, 'unknown-device'), false);
    assert.equal(queue.select(id, 'device-1'), true);
    assert.deepEqual(callbacks, ['device-1']);
    assert.equal(queue.select(id, 'device-1'), false);
});

test('serializes concurrent selection requests and cancels only the active request', () => {
    const {queue, opened, closed} = queueHarness();
    const results = [];
    const first = queue.enqueue(value => results.push(['first', value]));
    const second = queue.enqueue(value => results.push(['second', value]));
    queue.updateDevices([{deviceId: 'p', deviceName: 'SPIKE Prime'}]);
    assert.deepEqual(opened, [first]);
    assert.equal(queue.cancel(second), false);
    assert.equal(queue.cancel(first), true);
    assert.deepEqual(results, [['first', '']]);
    assert.deepEqual(opened, [first, second]);
    assert.equal(queue.select(second, 'p'), false, 'queued request has no devices until it becomes active');
    queue.updateDevices([{deviceId: 'e', deviceName: 'SPIKE Essential'}]);
    assert.equal(queue.select(second, 'e'), true);
    assert.deepEqual(results, [['first', ''], ['second', 'e']]);
    assert.deepEqual(closed, [first, second]);
});

test('cancels the request exactly once when the selection dialog is disposed or times out', () => {
    let timeoutHandler = null;
    const results = [];
    const {queue} = queueHarness({
        setTimer: handler => { timeoutHandler = handler; return 1; },
        clearTimer: () => {}
    });
    const timedOut = queue.enqueue(value => results.push(['timeout', value]));
    timeoutHandler();
    assert.deepEqual(results, [['timeout', '']]);
    assert.equal(queue.cancel(timedOut), false);

    const disposed = queue.enqueue(value => results.push(['dispose', value]));
    queue.dispose();
    assert.deepEqual(results, [['timeout', ''], ['dispose', '']]);
    let disposedCallbackResult = null;
    assert.equal(queue.enqueue(value => { disposedCallbackResult = value; }), null);
    assert.equal(disposedCallbackResult, '', 'enqueueing after disposal resolves as an explicit cancellation');
});
