const toPublicDevice = device => {
    if (!device || typeof device.deviceId !== 'string' || !device.deviceId) return null;
    return {
        deviceId: device.deviceId,
        deviceName: typeof device.deviceName === 'string' && device.deviceName ? device.deviceName : '名前のないデバイス'
    };
};

class BluetoothSelectionQueue {
    constructor ({onOpen, onDevices, onClose, timeoutMs = 120000, setTimer = setTimeout, clearTimer = clearTimeout}) {
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

    enqueue (callback) {
        if (this.disposed || typeof callback !== 'function') {
            if (typeof callback === 'function') callback('');
            return null;
        }
        // Chromium can emit select-bluetooth-device repeatedly while one
        // requestDevice() call is discovering devices. Keep one logical
        // picker session and settle every callback Electron supplied for
        // that session with the same explicit choice.
        if (this.active && !this.active.settled) {
            this.active.callbacks.add(callback);
            return this.active.id;
        }
        const request = {id: this.nextId++, callback, devices: [], settled: false, timer: null};
        request.callbacks = new Set([callback]);
        this.queue.push(request);
        this._activateNext();
        return request.id;
    }

    updateDevices (devices) {
        if (!this.active || this.active.settled) return;
        this.active.devices = (Array.isArray(devices) ? devices : []).map(toPublicDevice).filter(Boolean);
        if (this.onDevices) this.onDevices(this.active.id, this.active.devices.slice());
    }

    select (requestId, deviceId) {
        if (!this.active || this.active.id !== requestId || typeof deviceId !== 'string') return false;
        if (!this.active.devices.some(device => device.deviceId === deviceId)) return false;
        this._settle(this.active, deviceId);
        return true;
    }

    cancel (requestId) {
        if (!this.active || this.active.id !== requestId) return false;
        this._settle(this.active, '');
        return true;
    }

    dispose () {
        this.disposed = true;
        const pending = [this.active, ...this.queue].filter(Boolean);
        this.active = null;
        this.queue = [];
        pending.forEach(request => this._settleDetached(request));
    }

    _settleDetached (request) {
        if (request.settled) return;
        request.settled = true;
        if (request.timer !== null) this.clearTimer(request.timer);
        this._invokeCallbacks(request, '');
    }

    _activateNext () {
        if (this.disposed || this.active || !this.queue.length) return;
        this.active = this.queue.shift();
        const request = this.active;
        request.timer = this.setTimer(() => {
            if (this.active === request) this._settle(request, '');
        }, this.timeoutMs);
        if (this.onOpen) this.onOpen(request.id);
        if (this.onDevices) this.onDevices(request.id, []);
    }

    _settle (request, deviceId) {
        if (!request || request.settled) return;
        request.settled = true;
        if (request.timer !== null) this.clearTimer(request.timer);
        if (this.active === request) this.active = null;
        try {
            this._invokeCallbacks(request, deviceId);
        } finally {
            if (this.onClose) this.onClose(request.id);
            this._activateNext();
        }
    }

    _invokeCallbacks (request, deviceId) {
        for (const callback of request.callbacks) {
            try {
                callback(deviceId);
            } catch (error) {
                console.error('Bluetooth selection callback failed:', error);
            }
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
