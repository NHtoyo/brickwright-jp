'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {URL} = require('node:url');
const {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    nativeImage,
    net,
    protocol,
    session,
    shell
} = require('electron');
const {autoUpdater} = require('electron-updater');
const {createAppProtocolHandler} = require('./app-protocol.cjs');
const {BluetoothSelectionQueue, handleBluetoothSelectionRequest} = require('./bluetooth-selection.cjs');
const {isSafeForUpdate} = require('./activity-guard.cjs');

const APP_ORIGIN = 'app://brickwright';
const APP_ASSET_ROOT = path.join(__dirname, 'build');
const BUILD_INFO_PATH = path.join(APP_ASSET_ROOT, 'build-info.json');

protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
    }
}]);

let mainWindow = null;
let aboutWindow = null;
let bluetoothWindow = null;
let activeBluetoothDialogId = null;
let currentBluetoothDevices = [];
let updateDownloaded = false;
let installingUpdate = false;
let updateMenuItem = null;
let appMenu = null;
let activity = {
    bluetoothConnected: false,
    projectRunning: false,
    motorActive: false,
    controllerReady: false
};

const buildInfo = async () => {
    try {
        return JSON.parse(await fs.readFile(BUILD_INFO_PATH, 'utf8'));
    } catch (error) {
        return {
            application: 'Brickwright',
            version: app.getVersion(),
            commit: 'unknown',
            branch: 'unknown',
            buildNumber: 'local',
            platform: process.platform,
            buildType: 'development'
        };
    }
};

const isTrustedAppURL = value => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'app:' && parsed.hostname === 'brickwright' &&
            !parsed.username && !parsed.password && !parsed.port;
    } catch (error) {
        return false;
    }
};

const refreshUpdateMenu = () => {
    if (updateMenuItem) updateMenuItem.enabled = updateDownloaded && isSafeForUpdate(activity);
};

const openExternalReference = async url => {
    if (typeof url !== 'string') return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') return false;
    await shell.openExternal(parsed.toString());
    return true;
};

const handleNavigation = (contents, targetUrl) => {
    if (isTrustedAppURL(targetUrl)) return true;
    void openExternalReference(targetUrl);
    return false;
};

const bluetoothQueue = new BluetoothSelectionQueue({
    onOpen: requestId => {
        if (bluetoothWindow && !bluetoothWindow.isDestroyed()) bluetoothWindow.close();
        activeBluetoothDialogId = requestId;
        bluetoothWindow = new BrowserWindow({
            width: 470,
            height: 470,
            minWidth: 420,
            minHeight: 380,
            resizable: true,
            modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
            parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
            title: 'Bluetoothデバイスを選択',
            autoHideMenuBar: true,
            icon: path.join(__dirname, 'assets', 'brickwright.png'),
            webPreferences: {
                preload: path.join(__dirname, 'bluetooth-selector-preload.cjs'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                webviewTag: false
            }
        });
        setupWebContents(bluetoothWindow.webContents);
        const dialogId = requestId;
        bluetoothWindow.webContents.once('did-finish-load', () => {
            if (activeBluetoothDialogId === requestId && bluetoothWindow && !bluetoothWindow.isDestroyed()) {
                bluetoothWindow.webContents.send('bluetooth:devices', {
                    requestId,
                    devices: currentBluetoothDevices
                });
            }
        });
        bluetoothWindow.on('closed', () => {
            if (activeBluetoothDialogId === dialogId) {
                activeBluetoothDialogId = null;
                bluetoothWindow = null;
                bluetoothQueue.cancel(dialogId);
            }
        });
        void bluetoothWindow.loadURL(`${APP_ORIGIN}/desktop/bluetooth-selector.html`);
    },
    onDevices: (requestId, devices) => {
        currentBluetoothDevices = devices;
        if (!bluetoothWindow || bluetoothWindow.isDestroyed() || activeBluetoothDialogId !== requestId) return;
        bluetoothWindow.webContents.send('bluetooth:devices', {requestId, devices});
    },
    onClose: requestId => {
        if (activeBluetoothDialogId !== requestId) return;
        activeBluetoothDialogId = null;
        if (bluetoothWindow && !bluetoothWindow.isDestroyed()) bluetoothWindow.close();
        bluetoothWindow = null;
        currentBluetoothDevices = [];
    }
});

const setupWebContents = contents => {
    contents.on('will-navigate', (event, url) => {
        if (!handleNavigation(contents, url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({url}) => {
        void handleNavigation(contents, url);
        return {action: 'deny'};
    });
    contents.on('will-attach-webview', event => event.preventDefault());
};

const readBuildInfo = buildInfo;

const openAboutWindow = async () => {
    if (aboutWindow && !aboutWindow.isDestroyed()) {
        aboutWindow.focus();
        return;
    }
    aboutWindow = new BrowserWindow({
        width: 760,
        height: 700,
        minWidth: 560,
        minHeight: 480,
        title: 'Brickwrightについて',
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets', 'brickwright.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false
        }
    });
    setupWebContents(aboutWindow.webContents);
    aboutWindow.on('closed', () => { aboutWindow = null; });
    await aboutWindow.loadURL(`${APP_ORIGIN}/desktop/about.html`);
};

const buildMenu = async () => {
    const info = await readBuildInfo();
    const template = [
        {
            label: 'ファイル',
            submenu: [{role: 'quit', label: '終了'}]
        },
        {
            label: 'ヘルプ',
            submenu: [
                {label: 'Brickwrightについて', click: () => { void openAboutWindow(); }},
                {label: 'ソースコードを開く', click: () => { void openExternalReference(`https://github.com/NHtoyo/brickwright-jp/tree/${encodeURIComponent(info.commit)}`); }},
                {type: 'separator'},
                {
                    label: '更新をインストールして再起動',
                    enabled: false,
                    click: () => {
                        if (updateDownloaded && isSafeForUpdate(activity)) autoUpdater.quitAndInstall(false, true);
                    }
                }
            ]
        }
    ];
    appMenu = Menu.buildFromTemplate(template);
    updateMenuItem = appMenu.items[1].submenu.items[3];
    refreshUpdateMenu();
    Menu.setApplicationMenu(appMenu);
};

const registerBluetoothPermissions = () => {
    const appOnlyPermissions = new Set(['bluetooth', 'bluetooth-scanning']);
    session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
        appOnlyPermissions.has(permission) && requestingOrigin === APP_ORIGIN &&
        Boolean(contents && !contents.isDestroyed() && (contents === (mainWindow && mainWindow.webContents)))
    );
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
        const requestingURL = details && (details.requestingUrl || details.requestingOrigin) || contents.getURL();
        const allowed = appOnlyPermissions.has(permission) && isTrustedAppURL(requestingURL) &&
            Boolean(mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents);
        callback(allowed);
    });
};

const createMainWindow = async () => {
    const iconPath = path.join(__dirname, 'assets', 'brickwright.png');
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 980,
        minHeight: 640,
        show: process.env.BRICKWRIGHT_DESKTOP_SMOKE !== '1',
        title: 'Brickwright',
        icon: nativeImage.createFromPath(iconPath),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false
        }
    });
    setupWebContents(mainWindow.webContents);
    mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
        handleBluetoothSelectionRequest(bluetoothQueue, event, devices, callback);
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    await mainWindow.loadURL(`${APP_ORIGIN}/editor.html`);

    if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') {
        const reportPath = process.env.BRICKWRIGHT_SMOKE_REPORT;
        const result = await mainWindow.webContents.executeJavaScript(`(async () => ({
            href: location.href,
            secure: window.isSecureContext,
            bluetooth: Boolean(navigator.bluetooth),
            editorReady: Boolean(document.querySelector('#app, .gui, [data-testid="gui"]')),
            extensionURL: ${JSON.stringify(`${APP_ORIGIN}/extensions/CrispStrobe/legospike_turbowarp_transpile.js`)},
            extensionStatus: await fetch('/extensions/CrispStrobe/legospike_turbowarp_transpile.js').then(response => response.status).catch(() => 0)
        }))()`);
        const fsSync = require('node:fs');
        if (reportPath) fsSync.writeFileSync(reportPath, JSON.stringify(result, null, 2));
        process.stdout.write(`BRICKWRIGHT_DESKTOP_SMOKE ${JSON.stringify(result)}\n`);
        setTimeout(() => app.quit(), 50);
    } else {
        mainWindow.show();
        if (!app.isPackaged) mainWindow.webContents.openDevTools({mode: 'detach'});
    }
};

const configureAutoUpdate = async () => {
    const info = await readBuildInfo();
    if (!app.isPackaged || info.buildType !== 'release') return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('error', error => console.error('Brickwright update error:', error.message));
    autoUpdater.on('update-downloaded', () => {
        updateDownloaded = true;
        refreshUpdateMenu();
        console.info('Brickwright update downloaded; it will only be installed after a safe app exit.');
    });
    try {
        await autoUpdater.checkForUpdates();
    } catch (error) {
        console.error('Brickwright update check failed:', error.message);
    }
};

app.setAppUserModelId('org.brickwright.editor');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    ipcMain.handle('desktop:get-app-info', async event => {
        if (!isTrustedAppURL(event.sender.getURL())) throw new Error('Untrusted app origin');
        const info = await readBuildInfo();
        return {
            ...info,
            version: app.getVersion(),
            sourceURL: `https://github.com/NHtoyo/brickwright-jp/tree/${encodeURIComponent(info.commit)}`
        };
    });
    ipcMain.handle('desktop:open-about', async event => {
        if (!isTrustedAppURL(event.sender.getURL())) return false;
        await openAboutWindow();
        return true;
    });
    ipcMain.handle('desktop:open-source', async event => {
        if (!isTrustedAppURL(event.sender.getURL())) return false;
        const info = await readBuildInfo();
        return openExternalReference(`https://github.com/NHtoyo/brickwright-jp/tree/${encodeURIComponent(info.commit)}`);
    });
    ipcMain.on('desktop:activity', (event, nextActivity) => {
        if (!isTrustedAppURL(event.sender.getURL()) || !nextActivity || typeof nextActivity !== 'object') return;
        activity = {
            bluetoothConnected: nextActivity.bluetoothConnected === true,
            projectRunning: nextActivity.projectRunning === true,
            motorActive: nextActivity.motorActive === true,
            controllerReady: nextActivity.controllerReady === true
        };
        refreshUpdateMenu();
    });
    ipcMain.on('bluetooth:select', (_event, payload) => {
        if (!payload || !Number.isInteger(payload.requestId) || typeof payload.deviceId !== 'string') return;
        bluetoothQueue.select(payload.requestId, payload.deviceId);
    });
    ipcMain.on('bluetooth:cancel', (_event, payload) => {
        if (!payload || !Number.isInteger(payload.requestId)) return;
        bluetoothQueue.cancel(payload.requestId);
    });

    app.whenReady().then(async () => {
        protocol.handle('app', createAppProtocolHandler({assetRoot: APP_ASSET_ROOT, net}));
        registerBluetoothPermissions();
        await buildMenu();
        await createMainWindow();
        await configureAutoUpdate();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
        });
    }).catch(error => {
        console.error('Brickwright failed to start:', error && error.stack ? error.stack : error);
        app.quit();
    });

    app.on('before-quit', event => {
        bluetoothQueue.dispose();
        if (updateDownloaded && isSafeForUpdate(activity) && !installingUpdate) {
            event.preventDefault();
            installingUpdate = true;
            setImmediate(() => autoUpdater.quitAndInstall(false, true));
        }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
