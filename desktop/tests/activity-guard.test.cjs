const assert = require('node:assert/strict');
const test = require('node:test');
const {isSafeForUpdate} = require('../activity-guard.cjs');

test('updates require a recent renderer heartbeat and an idle, saved, non-transferring project', () => {
    const idle = {
        bluetoothConnected: false,
        projectRunning: false,
        motorActive: false,
        controllerReady: false,
        controllerBusy: false,
        projectChanged: false,
        rendererResponsive: true,
        lastActivityAt: 1000
    };
    assert.equal(isSafeForUpdate(idle, 1500), true);
    const activeFields = [
        'bluetoothConnected', 'projectRunning', 'motorActive', 'controllerReady', 'controllerBusy', 'projectChanged'
    ];
    for (const field of activeFields) {
        assert.equal(isSafeForUpdate({...idle, [field]: true}, 1500), false, field);
    }
    assert.equal(isSafeForUpdate({...idle, rendererResponsive: false}, 1500), false);
    assert.equal(isSafeForUpdate({...idle, lastActivityAt: 0}, 6000), false, 'stale renderer status is unsafe');
});
