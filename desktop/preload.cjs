'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('brickwrightDesktop', Object.freeze({
    getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
    openAbout: () => ipcRenderer.invoke('desktop:open-about'),
    openSource: () => ipcRenderer.invoke('desktop:open-source'),
    updateActivity: state => {
        if (!state || typeof state !== 'object') return;
        ipcRenderer.send('desktop:activity', {
            bluetoothConnected: state.bluetoothConnected === true,
            projectRunning: state.projectRunning === true,
            motorActive: state.motorActive === true,
            controllerReady: state.controllerReady === true
        });
    }
}));
