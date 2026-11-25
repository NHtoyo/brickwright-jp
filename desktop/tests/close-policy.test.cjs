const assert = require('node:assert/strict');
const test = require('node:test');
const {getClosePolicy} = require('../close-policy.cjs');

const idle = {
    rendererResponsive: true,
    lastActivityAt: 1000,
    projectChanged: false,
    bluetoothConnected: false,
    projectRunning: false,
    motorActive: false,
    controllerReady: false,
    controllerBusy: false
};

test('allows a quiet close only with a recent, responsive, saved renderer', () => {
    assert.deepEqual(getClosePolicy(idle, 1500), {
        statusKnown: true,
        projectChanged: false,
        active: false,
        requiresConfirmation: false
    });
    assert.equal(getClosePolicy({...idle, rendererResponsive: false}, 1500).requiresConfirmation, true);
    assert.equal(getClosePolicy(idle, 6000).statusKnown, false);
});

test('requires a close decision for unsaved projects and every active hub or VM state', () => {
    assert.equal(getClosePolicy({...idle, projectChanged: true}, 1500).requiresConfirmation, true);
    for (const field of ['bluetoothConnected', 'projectRunning', 'motorActive', 'controllerReady', 'controllerBusy']) {
        const result = getClosePolicy({...idle, [field]: true}, 1500);
        assert.equal(result.requiresConfirmation, true, field);
        assert.equal(result.active, true, field);
    }
});
