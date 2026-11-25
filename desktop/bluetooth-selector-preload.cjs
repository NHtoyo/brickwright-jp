const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('bluetoothSelector', Object.freeze({
    onDevices: callback => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('device-picker:devices', listener);
        return () => ipcRenderer.removeListener('device-picker:devices', listener);
    },
    select: (requestId, deviceId, kind = 'bluetooth') =>
        ipcRenderer.send('device-picker:select', {requestId, deviceId, kind}),
    cancel: (requestId, kind = 'bluetooth') => ipcRenderer.send('device-picker:cancel', {requestId, kind})
}));
