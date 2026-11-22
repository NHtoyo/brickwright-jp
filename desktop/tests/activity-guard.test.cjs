'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {isSafeForUpdate} = require('../activity-guard.cjs');

test('updates are deferred while Bluetooth, Scratch, motors, or controller are active', () => {
    assert.equal(isSafeForUpdate({bluetoothConnected: false, projectRunning: false, motorActive: false, controllerReady: false}), true);
    for (const field of ['bluetoothConnected', 'projectRunning', 'motorActive', 'controllerReady']) {
        assert.equal(isSafeForUpdate({bluetoothConnected: false, projectRunning: false, motorActive: false, controllerReady: false, [field]: true}), false, field);
    }
});
