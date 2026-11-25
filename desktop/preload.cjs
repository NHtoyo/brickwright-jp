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
            controllerReady: state.controllerReady === true,
            controllerBusy: state.controllerBusy === true,
            projectChanged: state.projectChanged === true
        });
    },
    smokeFiles: Object.freeze({
        enabled: () => ipcRenderer.invoke('desktop:smoke-files-enabled'),
        getMode: () => ipcRenderer.invoke('desktop:smoke-files-get-mode'),
        setMode: mode => ipcRenderer.invoke('desktop:smoke-files-set-mode', mode),
        beginWrite: () => ipcRenderer.invoke('desktop:smoke-files-begin-write'),
        write: (id, base64) => ipcRenderer.invoke('desktop:smoke-files-write', {id, base64}),
        close: id => ipcRenderer.invoke('desktop:smoke-files-close', id),
        abort: id => ipcRenderer.invoke('desktop:smoke-files-abort', id),
        read: () => ipcRenderer.invoke('desktop:smoke-files-read')
    })
}));
