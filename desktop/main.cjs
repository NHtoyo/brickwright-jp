const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {URL} = require('node:url');
const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    ipcMain,
    nativeImage,
    net,
    protocol,
    session,
    shell,
    systemPreferences
} = require('electron');
const {autoUpdater} = require('electron-updater');
const {createAppProtocolHandler} = require('./app-protocol.cjs');
const {BluetoothSelectionQueue, handleBluetoothSelectionRequest} = require('./bluetooth-selection.cjs');
const {isSafeForUpdate} = require('./activity-guard.cjs');
const {isPackagerImportURL, isPackagerURL} = require('./navigation.cjs');
const {createPermissionPolicy} = require('./permission-policy.cjs');
const {getClosePolicy} = require('./close-policy.cjs');
const {
    createUsbDevicePermissionPolicy,
    handleUsbSelectionRequest,
    toPublicUsbDevice
} = require('./usb-device-policy.cjs');

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
let usbWindow = null;
let activeUsbDialogId = null;
let currentUsbDevices = [];
let usbDevicePermissions = null;
let bluetoothChooserEventCount = 0;
let usbChooserEventCount = 0;
let updateDownloaded = false;
let installingUpdate = false;
let updateMenuItem = null;
let appMenu = null;
let approvedWindowClose = false;
const closeRequest = new Set();
let quitRequested = false;
let activity = {
    bluetoothConnected: false,
    projectRunning: false,
    motorActive: false,
    controllerReady: false,
    controllerBusy: false,
    projectChanged: false,
    rendererResponsive: false,
    lastActivityAt: 0
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

usbDevicePermissions = createUsbDevicePermissionPolicy({isTrustedOrigin: isTrustedAppURL});

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
            parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
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
        // eslint-disable-next-line no-use-before-define
        setupWebContents(bluetoothWindow.webContents);
        const dialogId = requestId;
        bluetoothWindow.webContents.once('did-finish-load', () => {
            if (activeBluetoothDialogId === requestId && bluetoothWindow && !bluetoothWindow.isDestroyed()) {
                bluetoothWindow.webContents.send('device-picker:devices', {
                    requestId,
                    kind: 'bluetooth',
                    devices: currentBluetoothDevices
                });
                if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') {
                    setTimeout(() => bluetoothQueue.cancel(requestId), 150);
                }
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
        bluetoothWindow.webContents.send('device-picker:devices', {requestId, kind: 'bluetooth', devices});
    },
    onClose: requestId => {
        if (activeBluetoothDialogId !== requestId) return;
        activeBluetoothDialogId = null;
        if (bluetoothWindow && !bluetoothWindow.isDestroyed()) bluetoothWindow.close();
        bluetoothWindow = null;
        currentBluetoothDevices = [];
    }
});

const usbQueue = new BluetoothSelectionQueue({
    onOpen: requestId => {
        if (usbWindow && !usbWindow.isDestroyed()) usbWindow.close();
        activeUsbDialogId = requestId;
        usbWindow = new BrowserWindow({
            width: 470,
            height: 470,
            minWidth: 420,
            minHeight: 380,
            resizable: true,
            modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
            parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
            title: 'USBデバイスを選択',
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
        // eslint-disable-next-line no-use-before-define
        setupWebContents(usbWindow.webContents);
        const dialogId = requestId;
        usbWindow.webContents.once('did-finish-load', () => {
            if (activeUsbDialogId === requestId && usbWindow && !usbWindow.isDestroyed()) {
                usbWindow.webContents.send('device-picker:devices', {
                    requestId,
                    kind: 'usb',
                    devices: currentUsbDevices
                });
                if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') {
                    setTimeout(() => usbQueue.cancel(requestId), 150);
                }
            }
        });
        usbWindow.on('closed', () => {
            if (activeUsbDialogId === dialogId) {
                activeUsbDialogId = null;
                usbWindow = null;
                usbQueue.cancel(dialogId);
            }
        });
        void usbWindow.loadURL(`${APP_ORIGIN}/desktop/bluetooth-selector.html?kind=usb`);
    },
    onDevices: (requestId, devices) => {
        currentUsbDevices = devices;
        if (!usbWindow || usbWindow.isDestroyed() || activeUsbDialogId !== requestId) return;
        usbWindow.webContents.send('device-picker:devices', {requestId, kind: 'usb', devices});
    },
    onClose: requestId => {
        if (activeUsbDialogId !== requestId) return;
        activeUsbDialogId = null;
        if (usbWindow && !usbWindow.isDestroyed()) usbWindow.close();
        usbWindow = null;
        currentUsbDevices = [];
    }
});

const setupWebContents = contents => {
    contents.on('will-navigate', (event, url) => {
        if (!handleNavigation(contents, url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({url}) => {
        if (contents === (mainWindow && mainWindow.webContents) && isPackagerImportURL(url)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 1280,
                    height: 900,
                    minWidth: 900,
                    minHeight: 640,
                    autoHideMenuBar: true,
                    webPreferences: {
                        preload: '',
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                        webSecurity: true,
                        webviewTag: false
                    }
                }
            };
        }
        void handleNavigation(contents, url);
        return {action: 'deny'};
    });
    contents.on('did-create-window', (childWindow, details) => {
        if (contents !== (mainWindow && mainWindow.webContents) || !isPackagerImportURL(details.url)) {
            childWindow.close();
            return;
        }
        const childContents = childWindow.webContents;
        childContents.on('will-navigate', (event, url) => {
            if (!isPackagerURL(url)) {
                event.preventDefault();
                void openExternalReference(url);
            }
        });
        childContents.setWindowOpenHandler(({url}) => {
            void openExternalReference(url);
            return {action: 'deny'};
        });
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
    aboutWindow.on('closed', () => {
        aboutWindow = null;
    });
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
                {
                    label: 'Brickwrightについて',
                    click: () => {
                        void openAboutWindow();
                    }
                },
                {
                    label: 'ソースコードを開く',
                    click: () => {
                        void openExternalReference(
                            `https://github.com/NHtoyo/brickwright-jp/tree/${encodeURIComponent(info.commit)}`
                        );
                    }
                },
                {type: 'separator'},
                {
                    label: '更新をインストールして再起動',
                    enabled: false,
                    click: () => {
                        if (updateDownloaded && isSafeForUpdate(activity) && !installingUpdate) {
                            installingUpdate = true;
                            autoUpdater.quitAndInstall(false, true);
                        }
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
    const policy = createPermissionPolicy({
        getMainContents: () => {
            if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.webContents;
            return null;
        },
        confirm: async ({permission, mediaTypes}) => {
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            const purpose = permission === 'media' ?
                (mediaTypes.includes('video') ? 'カメラ' : '') +
                    (mediaTypes.includes('audio') ? (mediaTypes.includes('video') ? 'とマイク' : 'マイク') : '') :
                'クリップボードの読み取り';
            const result = await dialog.showMessageBox(mainWindow, {
                type: 'question',
                title: `${purpose}へのアクセス`,
                message: `Brickwrightが${purpose}を使用しようとしています。許可しますか？`,
                buttons: ['許可', '拒否'],
                defaultId: 1,
                cancelId: 1,
                noLink: true
            });
            return result.response === 0;
        },
        requestOSMediaAccess: mediaType => {
            if (process.platform === 'darwin') {
                return systemPreferences.askForMediaAccess(mediaType === 'video' ? 'camera' : 'microphone');
            }
            return Promise.resolve(true);
        }
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
        policy.permissionCheck(contents, permission, requestingOrigin, details)
    );
    session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback, details = {}) => {
        const requestingURL = details.requestingUrl || details.securityOrigin || contents.getURL();
        try {
            callback(await policy.permissionRequest(contents, permission, requestingURL, details));
        } catch (error) {
            console.error('Brickwright permission request failed:', error && error.message ? error.message : error);
            callback(false);
        }
    });
    session.defaultSession.setDevicePermissionHandler(details => usbDevicePermissions.allow(details));
    session.defaultSession.on('select-usb-device', (event, details, callback) => {
        usbChooserEventCount++;
        handleUsbSelectionRequest(usbQueue, event, details, callback, {
            isTrustedFrame: frame => {
                const frameURL = frame.url;
                return mainWindow && !mainWindow.isDestroyed() && frame.top === frame &&
                    isTrustedAppURL(frameURL) && new URL(frameURL).pathname === '/editor.html';
            },
            approve: (deviceId, origin) => usbDevicePermissions.approve(deviceId, origin)
        });
    });
    session.defaultSession.on('usb-device-added', (event, device, contents) => {
        if (!mainWindow || contents !== mainWindow.webContents || !activeUsbDialogId) return;
        const publicDevice = toPublicUsbDevice(device);
        if (!publicDevice) return;
        currentUsbDevices = [
            ...currentUsbDevices.filter(item => item.deviceId !== publicDevice.deviceId),
            publicDevice
        ];
        usbQueue.updateDevices(currentUsbDevices);
    });
    session.defaultSession.on('usb-device-removed', (_event, device, contents) => {
        if (device && typeof device.deviceId === 'string') usbDevicePermissions.revoke(device.deviceId);
        if (!mainWindow || contents !== mainWindow.webContents || !activeUsbDialogId || !device) return;
        currentUsbDevices = currentUsbDevices.filter(item => item.deviceId !== device.deviceId);
        usbQueue.updateDevices(currentUsbDevices);
    });
    session.defaultSession.on('usb-device-revoked', (_event, details) => {
        if (details && details.device && typeof details.device.deviceId === 'string') {
            usbDevicePermissions.revoke(details.device.deviceId);
        }
    });
};

const saveProjectBeforeClose = async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The editor window is unavailable.');
    const archive = await mainWindow.webContents.executeJavaScript([
        '(async () => {',
        'if (!window.vm || typeof window.vm.saveProjectSb3 !== "function") {',
        'throw new Error("The project serializer is unavailable.");',
        '}',
        'const data = await window.vm.saveProjectSb3("arraybuffer");',
        'const bytes = new Uint8Array(data);',
        'const parts = [];',
        'for (let offset = 0; offset < bytes.length; offset += 32768) {',
        'parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));',
        '}',
        'return {base64: btoa(parts.join("")), byteLength: bytes.length};',
        '})()'
    ].join('\n'));
    if (!archive || !Number.isInteger(archive.byteLength) || archive.byteLength < 1 ||
        typeof archive.base64 !== 'string' || Buffer.byteLength(archive.base64, 'base64') !== archive.byteLength) {
        throw new Error('The project archive could not be serialized.');
    }
    const choice = await dialog.showSaveDialog(mainWindow, {
        title: 'プロジェクトを保存して終了',
        defaultPath: 'Brickwright.sb3',
        filters: [{name: 'Scratchプロジェクト', extensions: ['sb3']}]
    });
    if (choice.canceled || !choice.filePath) return false;
    await fs.writeFile(choice.filePath, Buffer.from(archive.base64, 'base64'));
    return true;
};

const stopAndDisconnectBeforeClose = () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The editor window is unavailable.');
    return mainWindow.webContents.executeJavaScript([
        '(async () => {',
        'if (!window.vm || typeof window.vm.stopAll !== "function") {',
        'throw new Error("Scratch stop is unavailable.");',
        '}',
        'await window.vm.stopAll();',
        'const runtime = window.vm.runtime;',
        'const peripherals = runtime && runtime.peripheralExtensions;',
        'const router = peripherals && peripherals.spikeprime;',
        'const hub = router && router.active;',
        'const connected = Boolean(hub && typeof hub.isConnected === "function" && hub.isConnected());',
        'if (connected) {',
        'if (typeof router.stopAll !== "function" || typeof router.disconnect !== "function") {',
        'throw new Error("Hub stop or disconnect is unavailable.");',
        '}',
        'await router.stopAll();',
        'await router.disconnect();',
        'if (hub.isConnected()) throw new Error("The hub did not confirm disconnection.");',
        '}',
        'return {connectedAtStart: connected, disconnected: !connected || !hub.isConnected()};',
        '})()'
    ].join('\n'));
};

const handleMainWindowCloseRequest = async () => {
    if (closeRequest.has('active') || !mainWindow || mainWindow.isDestroyed()) return;
    closeRequest.add('active');
    try {
        const policy = getClosePolicy(activity);
        if (policy.requiresConfirmation) {
            const buttons = policy.projectChanged ?
                ['保存して停止して終了', '保存せず停止して終了', 'キャンセル'] :
                ['停止して終了', 'キャンセル'];
            const message = policy.statusKnown ?
                policy.projectChanged ?
                    '未保存の編集があります。終了前に保存するか選んでください。ハブに接続中の場合は停止を試みます。' :
                    'Scratchの実行またはハブ接続が有効です。終了前にScratchを停止し、ハブを停止して切断します。' :
                'アプリの状態を確認できません。終了前にScratchと接続中のハブの停止を試みます。';
            const choice = await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Brickwrightを終了',
                message,
                detail: policy.statusKnown ? '' : '状態が不明なため、停止を確認できない場合は終了を取り消してください。',
                buttons,
                defaultId: buttons.length - 1,
                cancelId: buttons.length - 1,
                noLink: true
            });
            if (choice.response === buttons.length - 1) return;
            if (policy.projectChanged && choice.response === 0) {
                const saved = await saveProjectBeforeClose();
                if (!saved) return;
            }
        }
        try {
            await stopAndDisconnectBeforeClose();
        } catch (error) {
            const result = await dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: '停止を確認できません',
                message: 'Scratch、モーター、またはハブの停止を確認できませんでした。',
                detail: error && error.message ? error.message : String(error),
                buttons: ['終了を続ける', 'キャンセル'],
                defaultId: 1,
                cancelId: 1,
                noLink: true
            });
            if (result.response !== 0) return;
        }
        approvedWindowClose = true;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        if (quitRequested) app.quit();
    } catch (error) {
        console.error('Brickwright close request failed:', error && error.stack ? error.stack : error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            await dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Brickwrightを終了できません',
                message: '保存または停止処理に失敗しました。アプリは開いたままです。',
                detail: error && error.message ? error.message : String(error),
                buttons: ['OK'],
                noLink: true
            });
        }
    } finally {
        closeRequest.delete('active');
    }
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
    mainWindow.on('close', event => {
        if (approvedWindowClose || process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') return;
        event.preventDefault();
        void handleMainWindowCloseRequest();
    });
    mainWindow.webContents.on('will-prevent-unload', event => {
        if (approvedWindowClose) event.preventDefault();
    });
    mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
        bluetoothChooserEventCount++;
        handleBluetoothSelectionRequest(bluetoothQueue, event, devices, callback);
    });
    const cancelPendingDevicePickers = () => {
        if (activeBluetoothDialogId !== null) bluetoothQueue.cancel(activeBluetoothDialogId);
        if (activeUsbDialogId !== null) usbQueue.cancel(activeUsbDialogId);
    };
    mainWindow.webContents.on('render-process-gone', cancelPendingDevicePickers);
    mainWindow.on('closed', () => {
        cancelPendingDevicePickers();
        mainWindow = null;
    });
    await mainWindow.loadURL(`${APP_ORIGIN}/editor.html`);

    if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') {
        const reportPath = process.env.BRICKWRIGHT_SMOKE_REPORT;
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const deadline = Date.now() + 30000;
            let vm = window.vm;
            while (
                (!vm || !vm.extensionManager || !vm.extensionManager.isExtensionLoaded('spikeprime')) &&
                Date.now() < deadline
            ) {
                await new Promise(resolve => setTimeout(resolve, 100));
                vm = window.vm;
            }
            while (Date.now() < deadline) {
                const handle = document.querySelector('[class*="palette-resize-handle"][role="separator"]');
                const container = document.querySelector('[class*="blocks-container"]');
                const flyout = document.querySelector('.blocklyFlyoutBackground');
                const hitArea = handle && handle.querySelector('[aria-hidden="true"]');
                if (handle && container && flyout && hitArea) {
                    const handleRect = handle.getBoundingClientRect();
                    const flyoutRect = flyout.getBoundingClientRect();
                    const hitRect = hitArea.getBoundingClientRect();
                    const rtl = getComputedStyle(container).direction === 'rtl';
                    const boundary = rtl ? flyoutRect.left : flyoutRect.right;
                    const clear = rtl ? hitRect.right <= boundary + 0.5 : hitRect.left >= boundary - 0.5;
                    if (Math.abs(((handleRect.left + handleRect.right) / 2) - boundary) <= 2 && clear) break;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            const runtime = vm && vm.runtime;
            const peripherals = runtime && runtime.peripheralExtensions;
            const router = peripherals && peripherals.spikeprime;
            const extensionURLs = vm && vm.extensionManager && vm.extensionManager.getExtensionURLs();
            const spikeCategory = vm && vm.runtime && vm.runtime._blockInfo &&
                vm.runtime._blockInfo.find(category => category.id === 'spikeprime');
            const resizeHandle = document.querySelector('[class*="palette-resize-handle"][role="separator"]');
            const blocksContainer = document.querySelector('[class*="blocks-container"]');
            const flyoutBackground = document.querySelector('.blocklyFlyoutBackground');
            const handleRect = resizeHandle && resizeHandle.getBoundingClientRect();
            const hitArea = resizeHandle && resizeHandle.querySelector('[aria-hidden="true"]');
            const hitAreaRect = hitArea && hitArea.getBoundingClientRect();
            const blocksRect = blocksContainer && blocksContainer.getBoundingClientRect();
            const flyoutRect = flyoutBackground && flyoutBackground.getBoundingClientRect();
            const paletteDirection = blocksContainer ? getComputedStyle(blocksContainer).direction : 'ltr';
            const paletteBoundaryX = flyoutRect ?
                (paletteDirection === 'rtl' ? flyoutRect.left : flyoutRect.right) : null;
            const handleCenterX = handleRect ? (handleRect.left + handleRect.right) / 2 : null;
            const paletteHitAreaClear = Boolean(hitAreaRect && flyoutRect && (paletteDirection === 'rtl' ?
                hitAreaRect.right <= flyoutRect.left + 0.5 : hitAreaRect.left >= flyoutRect.right - 0.5));
            const spriteTarget = vm && vm.runtime && vm.runtime.targets.find(target => !target.isStage);
            const spikeBlockId = 'brickwright-electron-smoke-spike-block';
            const scratchBlockId = 'brickwright-electron-smoke-scratch-block';
            if (spriteTarget && spriteTarget.blocks && typeof spriteTarget.blocks.createBlock === 'function') {
                spriteTarget.blocks.createBlock({
                    id: spikeBlockId,
                    opcode: 'spikeprime_getBatteryLevel',
                    inputs: {},
                    fields: {},
                    next: null,
                    parent: null,
                    shadow: false,
                    topLevel: true,
                    x: 40,
                    y: 40
                });
                spriteTarget.blocks.createBlock({
                    id: scratchBlockId,
                    opcode: 'event_whenflagclicked',
                    inputs: {},
                    fields: {},
                    next: null,
                    parent: null,
                    shadow: false,
                    topLevel: true,
                    x: 200,
                    y: 40
                });
            }
            let sb3RoundTrip = {success: false, savedBytes: 0, targetCount: 0};
            if (vm && typeof vm.saveProjectSb3 === 'function' && typeof vm.loadProject === 'function') {
                try {
                    const archive = await vm.saveProjectSb3('arraybuffer');
                    const savedBytes = archive && (archive.byteLength || archive.length) || 0;
                    if (savedBytes > 0) {
                        await vm.loadProject(archive);
                        const hasBlock = opcode => vm.runtime.targets.some(target =>
                            Object.values(target.blocks._blocks).some(block => block.opcode === opcode)
                        );
                        sb3RoundTrip = {
                            success: vm.runtime.targets.some(target => target.isStage) &&
                                vm.runtime.targets.some(target => !target.isStage) &&
                                hasBlock('spikeprime_getBatteryLevel') && hasBlock('event_whenflagclicked'),
                            savedBytes,
                            targetCount: vm.runtime.targets.length,
                            spikeBlockRestored: hasBlock('spikeprime_getBatteryLevel'),
                            scratchBlockRestored: hasBlock('event_whenflagclicked')
                        };
                    }
                } catch (error) {
                    sb3RoundTrip = {success: false, savedBytes: 0, targetCount: 0, error: error.message};
                }
            }
            return {
                href: location.href,
                secure: window.isSecureContext,
                bluetooth: Boolean(navigator.bluetooth),
                usb: Boolean(navigator.usb),
                editorReady: Boolean(document.querySelector('#app, .gui, [data-testid="gui"]')),
                controlCenterVisible: Boolean(document.querySelector(
                    '[aria-label="Live hub view"], [aria-label="ハブのライブ表示"]'
                )),
                spikeLoaded: Boolean(vm && vm.extensionManager && vm.extensionManager.isExtensionLoaded('spikeprime')),
                spikeRouterRegistered: Boolean(router && router.instanceId),
                spikeBlockCount: spikeCategory && Array.isArray(spikeCategory.blocks) ? spikeCategory.blocks.length : 0,
                spikeSourceURL: extensionURLs && extensionURLs.spikeprime || null,
                paletteWidth: resizeHandle ? Number(resizeHandle.getAttribute('aria-valuenow')) : null,
                paletteCenterErrorPx: Number.isFinite(paletteBoundaryX) && Number.isFinite(handleCenterX) ?
                    Math.abs(handleCenterX - paletteBoundaryX) : null,
                paletteHitAreaClear,
                paletteGeometry: handleRect && flyoutRect ? {
                    handleLeft: handleRect.left,
                    handleRight: handleRect.right,
                    flyoutLeft: flyoutRect.left,
                    flyoutRight: flyoutRect.right
                } : null,
                paletteHasWorkspaceReserve: blocksRect && flyoutRect ? blocksRect.width - (
                    paletteDirection === 'rtl' ? blocksRect.right - flyoutRect.left :
                        flyoutRect.right - blocksRect.left
                ) >= 360 : false,
                fileSystemAccess: typeof window.showOpenFilePicker === 'function' &&
                    typeof window.showSaveFilePicker === 'function',
                sb3RoundTrip,
                extensionStatus: await fetch(${JSON.stringify(
        `${APP_ORIGIN}/extensions/CrispStrobe/legospike_turbowarp_transpile.js`
    )})
                    .then(response => response.status)
                    .catch(() => 0)
            };
        })()`);
        result.devicePickerSmoke = {};
        for (const [kind, expression] of [
            ['bluetooth', 'navigator.bluetooth.requestDevice({acceptAllDevices: true})'],
            ['usb', 'navigator.usb.requestDevice({filters: [{vendorId: 0x0d28}]})']
        ]) {
            result.devicePickerSmoke[kind] = await mainWindow.webContents.executeJavaScript(`(async () => {
                try {
                    await ${expression};
                    return {outcome: 'resolved'};
                } catch (error) {
                    return {outcome: 'rejected', errorName: error.name};
                }
            })()`, true);
        }
        result.bluetoothChooserEventCount = bluetoothChooserEventCount;
        result.usbChooserEventCount = usbChooserEventCount;
        if (reportPath) fsSync.writeFileSync(reportPath, JSON.stringify(result, null, 2));
        process.stdout.write(`BRICKWRIGHT_DESKTOP_SMOKE ${JSON.stringify(result)}\n`);
        approvedWindowClose = true;
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
if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1' && process.env.BRICKWRIGHT_SMOKE_USER_DATA) {
    const smokeUserData = path.resolve(process.env.BRICKWRIGHT_SMOKE_USER_DATA);
    fsSync.mkdirSync(smokeUserData, {recursive: true});
    app.setPath('userData', smokeUserData);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
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
            controllerReady: nextActivity.controllerReady === true,
            controllerBusy: nextActivity.controllerBusy === true,
            projectChanged: nextActivity.projectChanged === true,
            rendererResponsive: true,
            lastActivityAt: Date.now()
        };
        refreshUpdateMenu();
    });
    const resolvePickerMessage = (event, payload) => {
        if (!payload || !Number.isInteger(payload.requestId) ||
            (payload.kind !== 'bluetooth' && payload.kind !== 'usb')) return null;
        const isUsb = payload.kind === 'usb';
        const pickerWindow = isUsb ? usbWindow : bluetoothWindow;
        const dialogId = isUsb ? activeUsbDialogId : activeBluetoothDialogId;
        const queue = isUsb ? usbQueue : bluetoothQueue;
        if (!pickerWindow || pickerWindow.isDestroyed() || event.sender !== pickerWindow.webContents ||
            dialogId !== payload.requestId || !isTrustedAppURL(event.sender.getURL())) return null;
        const url = new URL(event.sender.getURL());
        if (url.pathname !== '/desktop/bluetooth-selector.html' ||
            (url.searchParams.get('kind') === 'usb') !== isUsb) return null;
        return {queue, isUsb};
    };
    ipcMain.on('device-picker:select', (event, payload) => {
        if (!payload || typeof payload.deviceId !== 'string') return;
        const picker = resolvePickerMessage(event, payload);
        if (picker) picker.queue.select(payload.requestId, payload.deviceId);
    });
    ipcMain.on('device-picker:cancel', (event, payload) => {
        const picker = resolvePickerMessage(event, payload);
        if (picker) picker.queue.cancel(payload.requestId);
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
    })
        .catch(error => {
            console.error('Brickwright failed to start:', error && error.stack ? error.stack : error);
            app.quit();
        });

    app.on('before-quit', event => {
        if (approvedWindowClose || !mainWindow || mainWindow.isDestroyed()) {
            bluetoothQueue.dispose();
            usbQueue.dispose();
            return;
        }
        event.preventDefault();
        quitRequested = true;
        mainWindow.close();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
} else {
    app.quit();
}
