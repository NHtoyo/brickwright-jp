'use strict';

const toPublicDevice = device => {
    if (!device || typeof device.deviceId !== 'string' || !device.deviceId) return null;
    return {
        deviceId: device.deviceId,
        deviceName: typeof device.deviceName === 'string' && device.deviceName ? device.deviceName : '名前のないデバイス'
    };
};

class BluetoothSelectionQueue {
    constructor({onOpen, onDevices, onClose, timeoutMs = 120000, setTimer = setTimeout, clearTimer = clearTimeout}) {
        this.onOpen = onOpen;
        this.onDevices = onDevices;
        this.onClose = onClose;
        this.timeoutMs = timeoutMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.nextId = 1;
        this.active = null;
        this.queue = [];
        this.disposed = false;
    }

    enqueue(callback) {
        if (this.disposed || typeof callback !== 'function') {
            if (typeof callback === 'function') callback('');
            return null;
        }
        const request = {id: this.nextId++, callback, devices: [], settled: false, timer: null};
        this.queue.push(request);
        this._activateNext();
        return request.id;
    }

    updateDevices(devices) {
        if (!this.active || this.active.settled) return;
        this.active.devices = (Array.isArray(devices) ? devices : []).map(toPublicDevice).filter(Boolean);
        if (this.onDevices) this.onDevices(this.active.id, this.active.devices.slice());
    }

    select(requestId, deviceId) {
        if (!this.active || this.active.id !== requestId || typeof deviceId !== 'string') return false;
        if (!this.active.devices.some(device => device.deviceId === deviceId)) return false;
        this._settle(this.active, deviceId);
        return true;
    }

    cancel(requestId) {
        if (!this.active || this.active.id !== requestId) return false;
        this._settle(this.active, '');
        return true;
    }

    dispose() {
        this.disposed = true;
        const pending = [this.active, ...this.queue].filter(Boolean);
        this.active = null;
        this.queue = [];
        pending.forEach(request => this._settleDetached(request));
    }

    _settleDetached(request) {
        if (request.settled) return;
        request.settled = true;
        if (request.timer !== null) this.clearTimer(request.timer);
        request.callback('');
    }

    _activateNext() {
        if (this.disposed || this.active || !this.queue.length) return;
        this.active = this.queue.shift();
        const request = this.active;
        request.timer = this.setTimer(() => {
            if (this.active === request) this._settle(request, '');
        }, this.timeoutMs);
        if (this.onOpen) this.onOpen(request.id);
        if (this.onDevices) this.onDevices(request.id, []);
    }

    _settle(request, deviceId) {
        if (!request || request.settled) return;
        request.settled = true;
        if (request.timer !== null) this.clearTimer(request.timer);
        if (this.active === request) this.active = null;
        try {
            request.callback(deviceId);
        } finally {
            if (this.onClose) this.onClose(request.id);
            this._activateNext();
        }
    }
}

const handleBluetoothSelectionRequest = (queue, event, devices, callback) => {
    event.preventDefault();
    const requestId = queue.enqueue(callback);
    queue.updateDevices(devices);
    return requestId;
};

module.exports = {BluetoothSelectionQueue, handleBluetoothSelectionRequest};
