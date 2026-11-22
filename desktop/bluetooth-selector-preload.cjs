'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('bluetoothSelector', Object.freeze({
    onDevices: callback => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('bluetooth:devices', listener);
        return () => ipcRenderer.removeListener('bluetooth:devices', listener);
    },
    select: (requestId, deviceId) => ipcRenderer.send('bluetooth:select', {requestId, deviceId}),
    cancel: requestId => ipcRenderer.send('bluetooth:cancel', {requestId})
}));
