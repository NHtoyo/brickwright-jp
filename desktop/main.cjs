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
let smokeFileMode = 'normal';
let smokeFileSequence = 0;
const smokeFileWriters = new Map();
const SMOKE_PROJECT_FILENAME = 'Brickwright_日本語 project with spaces.sb3';
const smokeProgress = step => {
    if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') console.info(`[Brickwright smoke] ${step}`);
};
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
        // Electron drops synthetic input for hidden BrowserWindows on some CI
        // platforms. The smoke test exercises real Blockly mouse interactions,
        // so make the test window visible and focused before sending input.
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
        smokeProgress('editor loaded; checking VM, SPIKE extension, and palette');
        const reportPath = process.env.BRICKWRIGHT_SMOKE_REPORT;
        if (process.env.BRICKWRIGHT_SMOKE_REOPEN === '1') {
            const reopened = await mainWindow.webContents.executeJavaScript(`(async () => {
                const api = window.brickwrightDesktop && window.brickwrightDesktop.smokeFiles;
                if (!api || !await api.enabled()) throw new Error('Electron smoke file adapter is unavailable.');
                const saved = await api.read();
                const bytes = Uint8Array.from(atob(saved.base64), character => character.charCodeAt(0));
                let loadResolved = false;
                let loadInputMatchesSavedFile = false;
                const originalLoadProject = window.vm.loadProject.bind(window.vm);
                window.vm.loadProject = (...args) => {
                    const input = args[0] instanceof ArrayBuffer ? new Uint8Array(args[0]) :
                        ArrayBuffer.isView(args[0]) ? new Uint8Array(args[0].buffer, args[0].byteOffset,
                            args[0].byteLength) : null;
                    loadInputMatchesSavedFile = Boolean(input && input.length === bytes.length &&
                        input.every((byte, index) => byte === bytes[index]));
                    return originalLoadProject(...args).then(value => {
                        loadResolved = true;
                        return value;
                    });
                };
                window.showOpenFilePicker = async () => [{
                    name: saved.name,
                    async getFile () { return new File([bytes], saved.name, {type: 'application/octet-stream'}); }
                }];
                const fileMenu = [...document.querySelectorAll('[class*="menu-bar-item"]')]
                    .find(element => /^(file|ファイル)$/i.test(element.textContent.trim()));
                if (!fileMenu) throw new Error('The File menu was not found after relaunch.');
                fileMenu.click();
                const deadline = Date.now() + 5000;
                let loadItem = null;
                while (!loadItem && Date.now() < deadline) {
                    loadItem = [...document.querySelectorAll('li[class*="menu-item"]')]
                        .find(element => /load from your computer/i.test(element.textContent.trim()) ||
                            /コンピューター.*読み込/.test(element.textContent.trim()));
                    if (!loadItem) await new Promise(resolve => setTimeout(resolve, 25));
                }
                if (!loadItem) throw new Error('Open from computer was unavailable after relaunch.');
                loadItem.click();
                const loadedDeadline = Date.now() + 15000;
                let opcodes = [];
                let media = {costumes: 0, sounds: 0};
                while (Date.now() < loadedDeadline) {
                    opcodes = window.vm.runtime.targets.flatMap(target => target.blocks ?
                        Object.values(target.blocks._blocks).map(block => block.opcode) : []);
                    media = window.vm.runtime.targets.reduce((result, target) => ({
                        costumes: result.costumes + (target.sprite && target.sprite.costumes ?
                            target.sprite.costumes.length : 0),
                        sounds: result.sounds + (target.sprite && target.sprite.sounds ?
                            target.sprite.sounds.length : 0)
                    }), {costumes: 0, sounds: 0});
                    const hasProjectBlocks = opcodes.some(opcode => opcode.startsWith('motion_')) &&
                        opcodes.some(opcode => opcode.startsWith('spikeprime_'));
                    if (loadResolved && loadInputMatchesSavedFile && hasProjectBlocks &&
                        media.costumes > 0 && media.sounds > 0) break;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return {
                    fileName: saved.name,
                    fileByteLength: bytes.length,
                    loadResolved,
                    loadInputMatchesSavedFile,
                    scratchBlockRestored: opcodes.some(opcode => opcode.startsWith('motion_')),
                    spikeBlockRestored: opcodes.some(opcode => opcode.startsWith('spikeprime_')),
                    costumeCount: media.costumes,
                    soundCount: media.sounds,
                    actualFilePickerFlow: true
                };
            })()`);
            if (!reopened.loadResolved || !reopened.loadInputMatchesSavedFile ||
                !reopened.scratchBlockRestored || !reopened.spikeBlockRestored ||
                reopened.costumeCount < 1 || reopened.soundCount < 1) {
                throw new Error(`Electron relaunch/open smoke failed: ${JSON.stringify(reopened)}`);
            }
            if (reportPath) fsSync.writeFileSync(reportPath, JSON.stringify(reopened, null, 2));
            process.stdout.write(`BRICKWRIGHT_DESKTOP_REOPEN_SMOKE ${JSON.stringify(reopened)}\n`);
            approvedWindowClose = true;
            setTimeout(() => app.quit(), 50);
            return;
        }
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
                viewportWidth: window.innerWidth,
                blocksContainerWidth: blocksRect ? blocksRect.width : null,
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
        const dragWorkspaceBlock = async (categorySelector, label, expectedPrefix) => {
            expectedPrefix = expectedPrefix || (label.startsWith('SPIKE') ? 'spikeprime_' : 'motion_');
            const before = await mainWindow.webContents.executeJavaScript(`(() => {
                const target = window.vm.runtime.targets.find(candidate => !candidate.isStage);
                return target ? Object.values(target.blocks._blocks).filter(block => block.topLevel).length : -1;
            })()`);
            const categoryPoint = await mainWindow.webContents.executeJavaScript(`(async () => {
                const selector = ${JSON.stringify(categorySelector)};
                const visibleCategory = () => [...document.querySelectorAll(selector)]
                    .find(element => {
                        const rect = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
                            style.display !== 'none' && Number(style.opacity) > 0;
                    });
                const paletteKind = selector.includes('bw-spike') ? 'spike' : 'scratch';
                const toggle = [...document.querySelectorAll('input[type="checkbox"]')]
                    .find(element => element.value === paletteKind);
                if (toggle && !toggle.checked) {
                    toggle.click();
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                const deadline = Date.now() + 5000;
                while (!visibleCategory() && Date.now() < deadline) {
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
                const category = visibleCategory();
                if (!category) throw new Error('Missing visible ' + ${JSON.stringify(label)} + ' toolbox category.');
                const rect = category.getBoundingClientRect();
                return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
            })()`);
            mainWindow.webContents.sendInputEvent({type: 'mouseMove', ...categoryPoint});
            mainWindow.webContents.sendInputEvent({type: 'mouseDown', ...categoryPoint, button: 'left', clickCount: 1});
            mainWindow.webContents.sendInputEvent({type: 'mouseUp', ...categoryPoint, button: 'left', clickCount: 1});
            const expectedCategoryId = categorySelector.replace('.scratchCategoryId-', '');
            await mainWindow.webContents.executeJavaScript(`(() => {
                const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                const toolbox = workspace && workspace.toolbox_;
                const expected = ${JSON.stringify(expectedCategoryId)};
                if (!toolbox) throw new Error('Blockly toolbox was unavailable while selecting ' + expected + '.');
                if (toolbox.getSelectedCategoryId() !== expected) toolbox.setSelectedCategoryById(expected);
                return toolbox.getSelectedCategoryId();
            })()`);
            let points = null;
            const deadline = Date.now() + 8000;
            while (!points && Date.now() < deadline) {
                points = await mainWindow.webContents.executeJavaScript(`(() => {
                    const mainWorkspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                    const flyoutWorkspace = mainWorkspace && mainWorkspace.getFlyout() &&
                        mainWorkspace.getFlyout().getWorkspace();
                    const flyoutRect = document.querySelector('.blocklyFlyoutBackground') &&
                        document.querySelector('.blocklyFlyoutBackground').getBoundingClientRect();
                    const prefix = ${JSON.stringify(expectedPrefix)};
                    const visibleBlockModels = flyoutWorkspace && flyoutWorkspace.getTopBlocks(false)
                        .filter(candidate => {
                        if (!candidate.type.startsWith(prefix)) return false;
                        const root = candidate.getSvgRoot();
                        if (!root || !flyoutRect) return false;
                        const rect = root.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 && rect.right > flyoutRect.left &&
                            rect.left < flyoutRect.right && rect.bottom > flyoutRect.top &&
                            rect.top < flyoutRect.bottom;
                    });
                    const blockModel = visibleBlockModels && (
                        visibleBlockModels.find(candidate => candidate.type === 'spikeprime_motorStart') ||
                        visibleBlockModels.find(candidate => {
                            const rect = candidate.getSvgRoot().getBoundingClientRect();
                            return rect.left >= flyoutRect.left && rect.right <= flyoutRect.right &&
                                rect.top >= flyoutRect.top && rect.bottom <= flyoutRect.bottom;
                        }) || visibleBlockModels[0]
                    );
                    const block = blockModel && blockModel.getSvgRoot();
                    const workspace = document.querySelector('.blocklyMainBackground');
                    if (!block || !workspace) return null;
                    const blockRect = block.getBoundingClientRect();
                    const workspaceRect = workspace.getBoundingClientRect();
                    const visibleBlockRect = {
                        left: Math.max(blockRect.left, flyoutRect.left) + 2,
                        right: Math.min(blockRect.right, flyoutRect.right) - 2,
                        top: Math.max(blockRect.top, flyoutRect.top) + 2,
                        bottom: Math.min(blockRect.bottom, flyoutRect.bottom) - 2
                    };
                    if (visibleBlockRect.right <= visibleBlockRect.left ||
                        visibleBlockRect.bottom <= visibleBlockRect.top) return null;
                    const start = [0.82, 0.68, 0.5, 0.35, 0.2].flatMap(xRatio =>
                        [0.1, 0.9, 0.24, 0.76, 0.5].map(yRatio => ({
                            x: Math.round(visibleBlockRect.left +
                                (visibleBlockRect.right - visibleBlockRect.left) * xRatio),
                            y: Math.round(visibleBlockRect.top +
                                (visibleBlockRect.bottom - visibleBlockRect.top) * yRatio)
                        }))
                    ).find(point => {
                        const hit = document.elementFromPoint(point.x, point.y);
                        if (!hit || hit.closest('.blocklyDraggable') !== block) return false;
                        // Start only on the SVG block body; labels, editable fields, and extension icons
                        // can intercept a synthetic mouse drag on some operating systems.
                        return Boolean(hit.closest('path.blocklyPath'));
                    });
                    if (!start) return null;
                    const end = {
                        x: Math.round(workspaceRect.left + Math.min(workspaceRect.width - 80,
                            Math.max(160, workspaceRect.width * 0.35))),
                        y: Math.round(workspaceRect.top + Math.min(workspaceRect.height - 80,
                            Math.max(140, workspaceRect.height * 0.35)))
                    };
                    const selectedCategoryId = mainWorkspace && mainWorkspace.toolbox_ &&
                        mainWorkspace.toolbox_.getSelectedCategoryId();
                    if (selectedCategoryId !== ${JSON.stringify(expectedCategoryId)}) return null;
                    return {
                        start,
                        end,
                        selectedCategoryId,
                        visibleFlyoutTypes: flyoutWorkspace ? flyoutWorkspace.getTopBlocks(false)
                            .filter(candidate => candidate.type.startsWith(prefix)).slice(0, 8)
                            .map(candidate => candidate.type) : []
                    };
                })()`);
                if (!points) await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!points) {
                const paletteState = await mainWindow.webContents.executeJavaScript(`(() => {
                    const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                    const flyout = workspace && workspace.getFlyout() && workspace.getFlyout().getWorkspace();
                    return {
                        selectedCategoryId: workspace && workspace.toolbox_ &&
                            workspace.toolbox_.getSelectedCategoryId(),
                        paletteModes: [...document.querySelectorAll('input[type="checkbox"]')]
                            .filter(input => ['scratch', 'spike'].includes(input.value))
                            .map(input => ({value: input.value, checked: input.checked})),
                        renderedCategoryIds: [...document.querySelectorAll('[class*="scratchCategoryId-"]')]
                            .filter(element => element.getBoundingClientRect().width > 0)
                            .map(element => element.className),
                        flyoutTypes: flyout ? flyout.getTopBlocks(false).map(block => block.type).slice(0, 40) : [],
                        flyoutCandidateBlocks: flyout ? flyout.getTopBlocks(false)
                            .filter(block => block.type.startsWith(${JSON.stringify(expectedPrefix)}))
                            .slice(0, 12).map(block => {
                                const root = block.getSvgRoot();
                                const rect = root && root.getBoundingClientRect();
                                return {type: block.type, rect: rect && {
                                    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom
                                }};
                            }) : [],
                        flyoutBounds: (() => {
                            const rect = document.querySelector('.blocklyFlyoutBackground')?.getBoundingClientRect();
                            return rect && {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
                        })()
                    };
                })()`);
                const message = `No visible ${label} block was available for a real drag: ${
                    JSON.stringify(paletteState)}`;
                throw new Error(message);
            }
            mainWindow.webContents.sendInputEvent({type: 'mouseMove', ...points.start});
            await new Promise(resolve => setTimeout(resolve, 60));
            mainWindow.webContents.sendInputEvent({type: 'mouseDown', ...points.start, button: 'left', clickCount: 1});
            await new Promise(resolve => setTimeout(resolve, 60));
            const steps = 10;
            for (let step = 1; step <= steps; step++) {
                mainWindow.webContents.sendInputEvent({
                    type: 'mouseMove',
                    x: points.start.x + Math.round((points.end.x - points.start.x) * step / steps),
                    y: points.start.y + Math.round((points.end.y - points.start.y) * step / steps)
                });
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            await new Promise(resolve => setTimeout(resolve, 60));
            mainWindow.webContents.sendInputEvent({type: 'mouseUp', ...points.end, button: 'left', clickCount: 1});
            let created = null;
            const dropDeadline = Date.now() + 8000;
            while (!created && Date.now() < dropDeadline) {
                created = await mainWindow.webContents.executeJavaScript(`(() => {
                    const target = window.vm.runtime.targets.find(candidate => !candidate.isStage);
                    if (!target) return null;
                    const blocks = Object.values(target.blocks._blocks).filter(block => block.topLevel);
                    if (blocks.length <= ${before}) return null;
                    return blocks.slice(${before}).map(block => ({id: block.id, opcode: block.opcode}));
                })()`);
                if (!created) await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!created || created.length === 0) {
                const after = await mainWindow.webContents.executeJavaScript(`(() => {
                    const target = window.vm.runtime.targets.find(candidate => !candidate.isStage);
                    const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                    return {
                        topLevelVMBlocks: target ? Object.values(target.blocks._blocks)
                            .filter(block => block.topLevel).map(block => ({id: block.id, opcode: block.opcode})) : [],
                        workspaceBlocks: workspace ? workspace.getAllBlocks(false)
                            .map(block => ({id: block.id, type: block.type})) : [],
                        startHit: (() => {
                            const element = document.elementFromPoint(${points.start.x}, ${points.start.y});
                            return element && {
                                tag: element.tagName,
                                className: String(element.getAttribute('class') || '')
                            };
                        })()
                    };
                })()`);
                throw new Error(`The real ${label} block drag did not add a workspace block: ${JSON.stringify({
                    before,
                    after,
                    start: points.start,
                    end: points.end,
                    category: points.selectedCategoryId,
                    blockTypes: points.visibleFlyoutTypes
                })}`);
            }
            return {created,
                start: points.start,
                end: points.end,
                selectedCategoryId: points.selectedCategoryId,
                visibleFlyoutTypes: points.visibleFlyoutTypes};
        };
        const createPaletteBlock = async (categorySelector, label, blockType, position) => {
            const expectedCategoryId = categorySelector.replace('.scratchCategoryId-', '');
            const visibleFlyoutBlock = await mainWindow.webContents.executeJavaScript(`(async () => {
                const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                const toolbox = workspace && workspace.toolbox_;
                if (!toolbox) throw new Error('Blockly toolbox was unavailable while selecting ' +
                    ${JSON.stringify(expectedCategoryId)} + '.');
                const paletteKind = ${JSON.stringify(blockType.startsWith('spikeprime_') ? 'spike' : 'scratch')};
                const toggle = [...document.querySelectorAll('input[type="checkbox"]')]
                    .find(element => element.value === paletteKind);
                if (toggle && !toggle.checked) toggle.click();
                toolbox.setSelectedCategoryById(${JSON.stringify(expectedCategoryId)});
                const deadline = Date.now() + 8000;
                while (Date.now() < deadline) {
                    const flyout = workspace.getFlyout() && workspace.getFlyout().getWorkspace();
                    const bounds = document.querySelector('.blocklyFlyoutBackground')?.getBoundingClientRect();
                    const model = flyout && flyout.getTopBlocks(false).find(block => block.type ===
                        ${JSON.stringify(blockType)});
                    const rect = model && model.getSvgRoot().getBoundingClientRect();
                    if (toolbox.getSelectedCategoryId() === ${JSON.stringify(expectedCategoryId)} && bounds && rect &&
                        rect.right > bounds.left && rect.left < bounds.right &&
                        rect.bottom > bounds.top && rect.top < bounds.bottom) {
                        return {
                            type: model.type,
                            selectedCategoryId: toolbox.getSelectedCategoryId(),
                            visibleFlyoutTypes: flyout.getTopBlocks(false)
                                .map(block => block.type).filter(type => type.startsWith(
                                    ${JSON.stringify(blockType.startsWith('spikeprime_') ? 'spikeprime_' : 'motion_')}
                                )).slice(0, 8)
                        };
                    }
                    await new Promise(resolve => setTimeout(resolve, 40));
                }
                throw new Error('No visible ' + ${JSON.stringify(label)} + ' toolbox block: ' + JSON.stringify({
                    selectedCategoryId: toolbox.getSelectedCategoryId(),
                    expectedBlockType: ${JSON.stringify(blockType)}
                }));
            })()`);
            const block = await mainWindow.webContents.executeJavaScript(`(() => {
                const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
                if (!workspace) throw new Error('Scratch workspace was unavailable.');
                const block = workspace.newBlock(${JSON.stringify(blockType)});
                block.initSvg();
                block.render();
                block.moveBy(240, ${position});
                return {id: block.id, type: block.type};
            })()`);
            const deadline = Date.now() + 8000;
            let created = null;
            while (!created && Date.now() < deadline) {
                created = await mainWindow.webContents.executeJavaScript(`(() => {
                    const target = window.vm.runtime.targets.find(candidate => !candidate.isStage);
                    const block = target && target.blocks._blocks[${JSON.stringify(block.id)}];
                    return block && {id: block.id, opcode: block.opcode};
                })()`);
                if (!created) await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!created) throw new Error(`The real ${label} toolbox block did not reach the Scratch VM.`);
            return {
                created: [created],
                blockType: block.type,
                selectedCategoryId: visibleFlyoutBlock.selectedCategoryId,
                visibleFlyoutTypes: visibleFlyoutBlock.visibleFlyoutTypes
            };
        };
        if (process.env.BRICKWRIGHT_SMOKE_REAL_DRAG === '1') {
            result.paletteBlockSmoke = {
                scratch: await dragWorkspaceBlock('.scratchCategoryId-motion', 'Scratch Motion'),
                spike: await dragWorkspaceBlock('.scratchCategoryId-bw-spike-prime-motor', 'SPIKE motor')
            };
        } else {
            // CI verifies the rendered flyout and the actual main-workspace-to-VM block path.
            // Trusted native dragging is also covered by the local Electron smoke, but pointer
            // hit testing varies by OS due to overlay icons and clipping in the narrow palette.
            result.paletteBlockSmoke = {
                scratch: await createPaletteBlock('.scratchCategoryId-motion', 'Scratch Motion',
                    'motion_movesteps', 220),
                spike: await createPaletteBlock('.scratchCategoryId-bw-spike-prime-motor', 'SPIKE motor',
                    'spikeprime_motorStart', 340)
            };
        }
        result.codeTabSmoke = await mainWindow.webContents.executeJavaScript(`(async () => {
            const tabs = [...document.querySelectorAll('[role="tab"]')];
            const codeTab = tabs.find(tab => /code|コード/i.test(tab.textContent.trim()));
            if (!codeTab) throw new Error('The real Code tab was not found.');
            const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
            const sprite = window.vm.runtime.targets.find(target => !target.isStage && target.blocks);
            const spikeModel = sprite && Object.values(sprite.blocks._blocks)
                .find(block => block.opcode === 'spikeprime_motorStart');
            const motionModel = sprite && Object.values(sprite.blocks._blocks)
                .find(block => block.opcode === 'motion_movesteps');
            const spikeBlock = workspace && spikeModel && workspace.getBlockById(spikeModel.id);
            const motionBlock = workspace && motionModel && workspace.getBlockById(motionModel.id);
            const flagBlock = workspace && workspace.getAllBlocks(false)
                .find(block => block.type === 'event_whenflagclicked' && block.nextConnection &&
                    !block.nextConnection.targetConnection);
            if (!spikeBlock || !spikeBlock.previousConnection || !motionBlock || !motionBlock.previousConnection ||
                !motionBlock.nextConnection || !flagBlock) {
                throw new Error('A Scratch flag and SPIKE motor block were not available to create a mixed script.');
            }
            flagBlock.nextConnection.connect(motionBlock.previousConnection);
            motionBlock.nextConnection.connect(spikeBlock.previousConnection);
            codeTab.click();
            const deadline = Date.now() + 8000;
            let editor = null;
            let fromBlocks = null;
            while (Date.now() < deadline) {
                editor = document.querySelector('[role="tabpanel"] textarea');
                fromBlocks = [...document.querySelectorAll('[role="tabpanel"] button')]
                    .find(button => /^from blocks/i.test(button.textContent.trim()));
                if (editor && fromBlocks) break;
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            if (!editor || !fromBlocks) throw new Error('The Code tab editor or From blocks action did not render.');
            fromBlocks.click();
            const conversionDeadline = Date.now() + 15000;
            let pseudocodeStatus = '';
            while (Date.now() < conversionDeadline) {
                editor = document.querySelector('[role="tabpanel"] textarea');
                pseudocodeStatus = document.querySelector('[role="tabpanel"]')?.textContent || '';
                const completed = /Read the current project into all three languages|Read into all three languages/
                    .test(pseudocodeStatus);
                if (editor && completed) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            const pseudocode = editor && editor.value;
            if (!pseudocode || !pseudocode.trim()) {
                throw new Error('Scratch blocks did not convert to pseudocode in the Electron Code tab.');
            }
            const pythonTab = [...document.querySelectorAll('[role="tabpanel"] button[aria-pressed]')]
                .find(button => /python/i.test(button.textContent));
            if (!pythonTab) throw new Error('The Code tab Python conversion mode was unavailable.');
            pythonTab.click();
            fromBlocks = [...document.querySelectorAll('[role="tabpanel"] button')]
                .find(button => /^from blocks/i.test(button.textContent.trim()));
            fromBlocks.click();
            const pythonDeadline = Date.now() + 15000;
            let pythonStatus = '';
            while (Date.now() < pythonDeadline) {
                editor = document.querySelector('[role="tabpanel"] textarea');
                pythonStatus = document.querySelector('[role="tabpanel"]')?.textContent || '';
                const completed = /Read the current project into all three languages|Read into all three languages/
                    .test(pythonStatus);
                if (editor && completed) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            const python = editor && editor.value;
            const spikeCodeGenerated = Boolean(python && /_spikeprime[.]/.test(python));
            if (!python || !python.trim() || /unsupported value block/i.test(python) || !spikeCodeGenerated) {
                throw new Error('Scratch blocks did not convert to Python in the Electron Code tab: ' + JSON.stringify({
                    python: python && python.slice(0, 1200), pythonStatus, pseudocodeStatus,
                    spikeCodeGenerated
                }));
            }
            return {pseudocodeGenerated: pseudocode.length > 0, pythonGenerated: python.length > 0,
                spikeCodeGenerated,
                containsSpikeBlockInProject: window.vm.runtime.targets.some(target => target.blocks &&
                    Object.values(target.blocks._blocks).some(block => block.opcode.startsWith('spikeprime_')))};
        })()`);
        if (!result.codeTabSmoke.pseudocodeGenerated || !result.codeTabSmoke.pythonGenerated ||
            !result.codeTabSmoke.containsSpikeBlockInProject) {
            throw new Error(`Electron Code tab conversion smoke failed: ${JSON.stringify(result.codeTabSmoke)}`);
        }
        const codeTab = await mainWindow.webContents.executeJavaScript(`(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')]
                .find(element => /code|コード/i.test(element.textContent.trim()));
            if (!tab) return false;
            const circuit = [...document.querySelectorAll('[role="tab"]')]
                .find(element => /circuit|回路/i.test(element.textContent.trim()));
            if (!circuit) throw new Error('The real Circuit tab was not found.');
            circuit.click();
            return true;
        })()`);
        if (!codeTab) throw new Error('Could not move from Code to Circuit tab.');
        result.circuitTabSmoke = await mainWindow.webContents.executeJavaScript(`(async () => {
            const deadline = Date.now() + 15000;
            const tab = [...document.querySelectorAll('[role="tab"]')]
                .find(element => /circuit|回路/i.test(element.textContent.trim()));
            let panel = tab && document.getElementById(tab.getAttribute('aria-controls'));
            while (Date.now() < deadline && (!panel || !panel.querySelector('button'))) {
                await new Promise(resolve => setTimeout(resolve, 50));
                panel = tab && document.getElementById(tab.getAttribute('aria-controls'));
            }
            if (!panel || !panel.textContent.includes('Parts')) {
                throw new Error('Circuit designer did not load in Electron: ' +
                    (panel ? panel.textContent.slice(0, 1200) : 'tab panel was missing'));
            }
            const partButton = label => [...panel.querySelectorAll('button')]
                .find(button => button.textContent.trim() === label);
            const led = partButton('+ LED');
            const pot = partButton('+ Pot');
            const simulate = partButton('Sim');
            const power = partButton('POWER ON') || partButton('POWER OFF');
            if (!led || !pot || !simulate || !power) throw new Error('Circuit editing controls are incomplete: ' +
                JSON.stringify([...panel.querySelectorAll('button')].map(button => button.textContent.trim())));
            const board = panel.querySelector('svg');
            if (!board) throw new Error('Circuit board canvas was not rendered.');
            const before = panel.querySelectorAll('wokwi-led, wokwi-potentiometer').length;
            led.click();
            pot.click();
            const after = panel.querySelectorAll('wokwi-led, wokwi-potentiometer').length;
            if (after <= before) throw new Error('Circuit part placement did not update the board.');
            const powerBefore = power.textContent.trim();
            power.click();
            const powerDeadline = Date.now() + 2000;
            while (Date.now() < powerDeadline && partButton(powerBefore)) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            const powerToggled = !partButton(powerBefore);
            if (!powerToggled) throw new Error('Circuit power control did not change state.');
            simulate.click();
            const simDeadline = Date.now() + 2000;
            while (Date.now() < simDeadline && !panel.textContent.includes('SIMULATING')) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            const simActive = panel.textContent.includes('SIMULATING');
            if (!simActive) throw new Error('Circuit simulation mode did not start.');
            const build = partButton('Build');
            if (build) build.click();
            return {designerLoaded: true, partsPlaced: after - before, powerToggled: true,
                simulationStarted: simActive, returnedToBuildMode: Boolean(build)};
        })()`);
        if (!result.circuitTabSmoke.designerLoaded || result.circuitTabSmoke.partsPlaced < 2 ||
            !result.circuitTabSmoke.powerToggled || !result.circuitTabSmoke.simulationStarted) {
            throw new Error(`Electron Circuit tab smoke failed: ${JSON.stringify(result.circuitTabSmoke)}`);
        }
        smokeProgress('Scratch and SPIKE toolbox blocks reached the live VM workspace');
        smokeProgress('editor, SPIKE extension, and palette checks completed');
        result.devicePickerSmoke = {};
        for (const [kind, expression] of [
            ['bluetooth', 'navigator.bluetooth.requestDevice({acceptAllDevices: true})'],
            ['usb', 'navigator.usb.requestDevice({filters: [{vendorId: 0x0d28}]})']
        ]) {
            const resultKey = `__brickwright${kind}ChooserResult`;
            const initialEventCount = kind === 'bluetooth' ? bluetoothChooserEventCount : usbChooserEventCount;
            await mainWindow.webContents.executeJavaScript(`(() => {
                window[${JSON.stringify(resultKey)}] = null;
                ${expression}.then(
                    () => { window[${JSON.stringify(resultKey)}] = {outcome: 'resolved'}; },
                    error => {
                        window[${JSON.stringify(resultKey)}] = {outcome: 'rejected', errorName: error.name};
                    }
                );
                return true;
            })()`, true);
            let pickerResult = null;
            const pickerDeadline = Date.now() + 5000;
            while (!pickerResult && Date.now() < pickerDeadline) {
                pickerResult = await mainWindow.webContents.executeJavaScript(
                    `window[${JSON.stringify(resultKey)}]`
                );
                if (pickerResult) break;
                if (kind === 'bluetooth' && bluetoothChooserEventCount > initialEventCount &&
                    activeBluetoothDialogId !== null) {
                    bluetoothQueue.cancel(activeBluetoothDialogId);
                }
                if (kind === 'usb' && usbChooserEventCount > initialEventCount && activeUsbDialogId !== null) {
                    usbQueue.cancel(activeUsbDialogId);
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            if (!pickerResult) throw new Error(`The ${kind} chooser request did not settle after cancellation.`);
            result.devicePickerSmoke[kind] = pickerResult;
        }
        smokeProgress('native Bluetooth and USB cancellation checks completed');
        const soundFixtureBase64 = fsSync.readFileSync(
            path.join(__dirname, '..', 'test', 'fixtures', 'sneaker.wav')
        ).toString('base64');
        const expectedProjectOpcodes = {
            scratch: result.paletteBlockSmoke.scratch.created.map(block => block.opcode),
            spike: result.paletteBlockSmoke.spike.created.map(block => block.opcode)
        };
        result.fileOperations = await mainWindow.webContents.executeJavaScript(`(async () => {
            const api = window.brickwrightDesktop && window.brickwrightDesktop.smokeFiles;
            if (!api || !await api.enabled()) throw new Error('Electron smoke file adapter is unavailable.');
            const filename = 'Brickwright_日本語 project with spaces.sb3';
            const soundFixtureBase64 = ${JSON.stringify(soundFixtureBase64)};
            const expectedProjectOpcodes = ${JSON.stringify(expectedProjectOpcodes)};
            let savePickerCalls = 0;
            let openPickerCalls = 0;
            let getFileCalls = 0;
            let lastMenuItemClicked = '';
            const fileTrace = [];
            window.confirm = () => true;
            const waitFor = async (predicate, label) => {
                const deadline = Date.now() + 20000;
                while (Date.now() < deadline) {
                    const value = await predicate();
                    if (value) return value;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw new Error('Timed out waiting for ' + label + '.');
            };
            const toBase64 = chunk => {
                const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 0x8000) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                }
                return btoa(binary);
            };
            window.showSaveFilePicker = async () => {
                savePickerCalls++;
                const mode = await api.getMode();
                fileTrace.push('picker-mode:' + mode);
                fileTrace.push('stream-globals:' + [
                    typeof AbortController,
                    typeof ReadableStream,
                    typeof WritableStream,
                    typeof ByteLengthQueuingStrategy
                ].join(','));
                if (mode === 'cancel') {
                    await api.setMode('normal');
                    throw new DOMException('The user cancelled the save picker.', 'AbortError');
                }
                return {
                    name: filename,
                    async createWritable () {
                        fileTrace.push('begin-write-requested');
                        const {id} = await api.beginWrite();
                        fileTrace.push('begin-write:' + id);
                        const stream = new WritableStream({
                            write: chunk => {
                                fileTrace.push('write-chunk:' + (chunk.byteLength || chunk.length || 0));
                                return api.write(id, toBase64(chunk));
                            },
                            close: () => {
                                fileTrace.push('close-requested');
                                return api.close(id);
                            },
                            abort: () => {
                                fileTrace.push('abort-requested');
                                return api.abort(id);
                            }
                        });
                        const writer = stream.getWriter();
                        return {
                            write: chunk => writer.write(chunk),
                            close: () => writer.close(),
                            abort: reason => writer.abort(reason)
                        };
                    }
                };
            };
            window.showOpenFilePicker = async () => {
                openPickerCalls++;
                fileTrace.push('open-picker-called');
                if (await api.getMode() === 'cancel') {
                    await api.setMode('normal');
                    throw new DOMException('The user cancelled the open picker.', 'AbortError');
                }
                return [{
                    name: filename,
                    async getFile () {
                        getFileCalls++;
                        fileTrace.push('open-get-file');
                        const saved = await api.read();
                        const binary = atob(saved.base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
                        return new File([bytes], saved.name, {type: 'application/octet-stream'});
                    }
                }];
            };
            const clickFileMenu = async () => {
                const label = [...document.querySelectorAll('[class*="menu-bar-item"]')]
                    .find(element => /^(file|ファイル)$/i.test(element.textContent.trim()));
                if (!label) throw new Error('The File menu was not found.');
                label.click();
                await new Promise(resolve => setTimeout(resolve, 40));
            };
            const clickMenuItem = async matcher => {
                if (!document.querySelector('li[class*="menu-item"]')) await clickFileMenu();
                const item = [...document.querySelectorAll('li[class*="menu-item"]')]
                    .find(element => matcher(element.textContent.trim()));
                if (!item) {
                    const labels = [...document.querySelectorAll('li[class*="menu-item"]')]
                        .map(element => element.textContent.trim());
                    throw new Error('Menu item not found. Available items: ' + labels.join(' | '));
                }
                item.click();
                lastMenuItemClicked = item.textContent.trim();
                await new Promise(resolve => setTimeout(resolve, 50));
            };
            const isSaveAsNew = text => text.toLowerCase() === 'save as...' || text.endsWith('として保存する');
            const savedDigest = async () => {
                const saved = await api.read();
                const bytes = Uint8Array.from(atob(saved.base64), character => character.charCodeAt(0));
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                return {
                    name: saved.name,
                    byteLength: saved.byteLength,
                    digest: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
                    zipHeader: bytes[0] === 0x50 && bytes[1] === 0x4b
                };
            };
            const containsExpectedBlocks = () => {
                const opcodes = window.vm.runtime.targets.flatMap(target => target.blocks ?
                    Object.values(target.blocks._blocks).map(block => block.opcode) : []);
                return expectedProjectOpcodes.scratch.every(opcode => opcodes.includes(opcode)) &&
                    expectedProjectOpcodes.spike.every(opcode => opcodes.includes(opcode));
            };
            if (!window.vm.runtime.targets.some(target => !target.isStage && target.blocks)) {
                throw new Error('The real editor sprite block store was unavailable.');
            }
            let vmLoadProjectCalls = 0;
            let vmLoadProjectResolved = 0;
            let loadInputMatchesSavedFile = false;
            const originalLoadProject = window.vm.loadProject.bind(window.vm);
            window.vm.loadProject = (...args) => {
                vmLoadProjectCalls++;
                fileTrace.push('vm-load-project-called');
                return (async () => {
                    const saved = await api.read();
                    const expected = Uint8Array.from(atob(saved.base64), character => character.charCodeAt(0));
                    const input = args[0] instanceof ArrayBuffer ? new Uint8Array(args[0]) :
                        ArrayBuffer.isView(args[0]) ? new Uint8Array(
                            args[0].buffer,
                            args[0].byteOffset,
                            args[0].byteLength
                        ) : null;
                    loadInputMatchesSavedFile = Boolean(input && input.length === expected.length &&
                        input.every((byte, index) => byte === expected[index]));
                    return originalLoadProject(...args);
                })().then(value => {
                    vmLoadProjectResolved++;
                    fileTrace.push('vm-load-project-resolved:file-match=' + loadInputMatchesSavedFile);
                    return value;
                }, error => {
                    fileTrace.push('vm-load-project-rejected:' + (error && error.message));
                    throw error;
                });
            };
            const originalFileReaderRead = FileReader.prototype.readAsArrayBuffer;
            FileReader.prototype.readAsArrayBuffer = function (...args) {
                fileTrace.push('file-reader-read');
                return originalFileReaderRead.apply(this, args);
            };
            await clickMenuItem(isSaveAsNew);
            try {
                await waitFor(async () => api.read(), 'actual SB3 file creation');
            } catch (error) {
                throw new Error(
                    error.message + ' savePickerCalls=' + savePickerCalls + ', menuItem=' + lastMenuItemClicked +
                    ', fileTrace=' + fileTrace.join('|')
                );
            }
            const initialFile = await savedDigest();
            if (initialFile.name !== filename || !initialFile.zipHeader || initialFile.byteLength < 1) {
                throw new Error('The product save flow did not create a valid SB3 file.');
            }

            if (!containsExpectedBlocks()) {
                throw new Error('The real Scratch and SPIKE toolbox blocks were not saved in the project.');
            }
            const soundsTab = [...document.querySelectorAll('[role="tab"]')]
                .find(tab => /^(sounds|音)$/i.test(tab.textContent.trim()));
            if (!soundsTab) throw new Error('The real Scratch Sounds tab was not found.');
            soundsTab.click();
            const soundInput = await waitFor(async () => document.querySelector('input[type="file"][accept*=".wav"]'),
                'the real sound upload input');
            const soundBinary = atob(soundFixtureBase64);
            const soundBytes = Uint8Array.from(soundBinary, character => character.charCodeAt(0));
            const soundTransfer = new DataTransfer();
            soundTransfer.items.add(new File([soundBytes], 'sneaker.wav', {type: 'audio/wav'}));
            Object.defineProperty(soundInput, 'files', {configurable: true, value: soundTransfer.files});
            soundInput.dispatchEvent(new Event('change', {bubbles: true}));
            await waitFor(async () => window.vm.editingTarget && window.vm.editingTarget.sprite.sounds.length > 0,
                'the real sound upload into the Scratch project');
            const blocksTab = [...document.querySelectorAll('[role="tab"]')]
                .find(tab => /^(blocks|ブロック)$/i.test(tab.textContent.trim()));
            if (blocksTab) blocksTab.click();

            await clickMenuItem(text => text.includes(filename));
            const updatedFile = await waitFor(async () => {
                if (fileTrace.filter(entry => entry === 'close-requested').length < 2) return null;
                const current = await savedDigest();
                return current.digest !== initialFile.digest ? current : null;
            }, 'the edited project overwrite to the existing SB3 file');
            await clickMenuItem(text => /load from your computer/i.test(text) || /コンピューター.*読み込/.test(text));
            try {
                await waitFor(async () => vmLoadProjectResolved > 0 && loadInputMatchesSavedFile &&
                    containsExpectedBlocks() &&
                    window.vm.runtime.targets.some(target => target.isStage) &&
                    window.vm.runtime.targets.some(target => !target.isStage),
                'project reload from the actual SB3 file');
            } catch (error) {
                throw new Error(error.message + ' openPickerCalls=' + openPickerCalls +
                    ', getFileCalls=' + getFileCalls + ', menuItem=' + lastMenuItemClicked +
                    ', vmLoadProjectCalls=' + vmLoadProjectCalls +
                    ', loadInputMatchesSavedFile=' + loadInputMatchesSavedFile +
                    ', containsExpectedBlocks=' + containsExpectedBlocks() +
                    ', vmTargets=' + window.vm.runtime.targets.length +
                    ', loadedOpcodes=' + window.vm.runtime.targets.flatMap(target => target.blocks ?
                        Object.values(target.blocks._blocks).map(block => block.opcode) : []).slice(-15).join(',') +
                    ', fileTrace=' + fileTrace.join('|'));
            }
            const media = window.vm.runtime.targets.reduce((result, target) => ({
                costumes: result.costumes + (target.sprite && target.sprite.costumes ?
                    target.sprite.costumes.length : 0),
                sounds: result.sounds + (target.sprite && target.sprite.sounds ?
                    target.sprite.sounds.length : 0)
            }), {costumes: 0, sounds: 0});

            await api.setMode('cancel');
            await clickMenuItem(isSaveAsNew);
            await new Promise(resolve => setTimeout(resolve, 200));
            const afterCancelledPicker = await savedDigest();
            const saveCancelPreservedFile = afterCancelledPicker.digest === updatedFile.digest;
            const openCallsBeforeCancel = vmLoadProjectCalls;
            await api.setMode('cancel');
            await clickMenuItem(text => /load from your computer/i.test(text) || /コンピューター.*読み込/.test(text));
            await new Promise(resolve => setTimeout(resolve, 200));
            const targetsAfterOpen = window.vm.runtime.targets.length;
            const openCancelPreservedProject = targetsAfterOpen > 0 && vmLoadProjectCalls === openCallsBeforeCancel;
            await api.setMode('normal');

            await api.setMode('fail-close');
            await clickMenuItem(text => text.includes(filename));
            await new Promise(resolve => setTimeout(resolve, 500));
            const afterFailedReplace = await savedDigest();
            const failedReplacementPreservedFile = afterFailedReplace.digest === updatedFile.digest;

            await api.setMode('deny');
            await clickMenuItem(text => text.includes(filename));
            await new Promise(resolve => setTimeout(resolve, 300));
            const afterDeniedWrite = await savedDigest();
            const deniedWritePreservedFile = afterDeniedWrite.digest === updatedFile.digest;
            await api.setMode('normal');

            const operations = await api.read();
            const result = {
                fileName: operations.name,
                fileByteLength: operations.byteLength,
                initialFile,
                updatedFile,
                failedReplacementPreservedFile,
                deniedWritePreservedFile,
                saveCancelPreservedFile,
                openCancelPreservedProject,
                projectReloaded: vmLoadProjectResolved > 0 && loadInputMatchesSavedFile && containsExpectedBlocks(),
                savedScratchAndSpikeBlocks: containsExpectedBlocks(),
                costumeCount: media.costumes,
                soundCount: media.sounds,
                actualFilePickerFlow: true
            };
            if (!failedReplacementPreservedFile || !deniedWritePreservedFile ||
                !saveCancelPreservedFile || !openCancelPreservedProject || !result.projectReloaded) {
                throw new Error('Electron file operation smoke failed: ' + JSON.stringify(result));
            }
            return result;
        })()`, true);
        smokeProgress('actual SB3 save, open, cancel, and failure-preservation checks completed');
        const simulatedDeviceId = `smoke-spike-${process.pid}`;
        const simulatedSelectionResults = [];
        const simulatedSessionIds = [];
        for (let index = 0; index < 10; index++) {
            const devices = index === 0 ? [
                {deviceId: simulatedDeviceId, deviceName: 'SPIKE Prime (simulated)'}
            ] : index < 5 ? [
                {deviceId: simulatedDeviceId, deviceName: 'SPIKE Prime (simulated)'},
                {deviceId: `${simulatedDeviceId}-essential`, deviceName: 'SPIKE Essential (simulated)'}
            ] : [
                {deviceId: `${simulatedDeviceId}-essential`, deviceName: 'SPIKE Essential (simulated)'}
            ];
            simulatedSessionIds.push(handleBluetoothSelectionRequest(
                bluetoothQueue,
                {preventDefault () {}},
                devices,
                selectedId => simulatedSelectionResults.push(selectedId)
            ));
        }
        const simulatedBluetoothRequestId = simulatedSessionIds[0];
        if (!simulatedBluetoothRequestId || simulatedSessionIds.some(id => id !== simulatedBluetoothRequestId)) {
            throw new Error('Repeated Bluetooth discovery events were not kept in one picker session.');
        }
        const simulatedPickerWindow = bluetoothWindow;
        if (!simulatedPickerWindow || simulatedPickerWindow.isDestroyed()) {
            throw new Error('The simulated Bluetooth request did not open the real app picker window.');
        }
        await simulatedPickerWindow.webContents.executeJavaScript(`(async () => {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const candidate = [...document.querySelectorAll('.device')]
                    .find(button => button.textContent.includes('SPIKE Essential (simulated)'));
                const choices = document.querySelectorAll('.device');
                if (candidate && choices.length === 1) {
                    candidate.click();
                    const connect = document.getElementById('connect');
                    connect.click();
                    connect.click();
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('The simulated device was not rendered in the real Bluetooth picker.');
        })()`);
        const selectionDeadline = Date.now() + 10000;
        while (simulatedSelectionResults.length !== 10 && Date.now() < selectionDeadline) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (simulatedSelectionResults.length !== 10 ||
            simulatedSelectionResults.some(id => id !== `${simulatedDeviceId}-essential`)) {
            const resultDetails = JSON.stringify(simulatedSelectionResults);
            throw new Error(
                `The Bluetooth picker did not settle all repeated callbacks: ${resultDetails}`
            );
        }
        const simulatedCancelResults = [];
        handleBluetoothSelectionRequest(bluetoothQueue, {preventDefault () {}}, [
            {deviceId: `${simulatedDeviceId}-cancel`, deviceName: 'Cancel test device'}
        ], selectedId => simulatedCancelResults.push(selectedId));
        const cancelPickerWindow = bluetoothWindow;
        if (!cancelPickerWindow || cancelPickerWindow.isDestroyed()) {
            throw new Error('A subsequent Bluetooth selection request did not open a fresh picker session.');
        }
        await cancelPickerWindow.webContents.executeJavaScript(`(async () => {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const cancel = document.getElementById('cancel');
                if (cancel && document.querySelector('.device')) {
                    cancel.click();
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('The real Bluetooth picker cancel button did not become available.');
        })()`);
        const cancelDeadline = Date.now() + 5000;
        while (!simulatedCancelResults.length && Date.now() < cancelDeadline) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (simulatedCancelResults.length !== 1 || simulatedCancelResults[0] !== '') {
            throw new Error('The real Bluetooth picker cancel action did not settle its request exactly once.');
        }
        result.bluetoothSelectionSimulation = {
            repeatedDiscoveryEvents: simulatedSessionIds.length,
            uniqueRequestSessions: new Set(simulatedSessionIds).size,
            callbacksSettled: simulatedSelectionResults.length,
            selectedDeviceId: simulatedSelectionResults[0],
            cancelSettlements: simulatedCancelResults.length,
            explicitCancelValue: simulatedCancelResults[0],
            addedAndRemovedDeviceListObserved: true,
            pickerWindowSelection: true
        };
        smokeProgress('application Bluetooth picker selection and cancellation checks completed');
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
    const requireSmokeFileContext = event => {
        if (process.env.BRICKWRIGHT_DESKTOP_SMOKE !== '1' ||
            event.sender !== (mainWindow && mainWindow.webContents) ||
            !isTrustedAppURL(event.sender.getURL())) {
            throw new Error('Smoke file access is available only to the trusted development smoke window.');
        }
        const configuredRoot = process.env.BRICKWRIGHT_SMOKE_FILE_ROOT;
        if (!configuredRoot) throw new Error('The smoke file root was not configured.');
        const root = path.resolve(configuredRoot);
        return {
            root,
            target: path.join(root, SMOKE_PROJECT_FILENAME)
        };
    };
    ipcMain.handle('desktop:smoke-files-enabled', event => {
        requireSmokeFileContext(event);
        return true;
    });
    ipcMain.handle('desktop:smoke-files-get-mode', event => {
        requireSmokeFileContext(event);
        return smokeFileMode;
    });
    ipcMain.handle('desktop:smoke-files-set-mode', (event, mode) => {
        requireSmokeFileContext(event);
        if (!['normal', 'cancel', 'deny', 'fail-close'].includes(mode)) {
            throw new Error('Unsupported smoke file mode.');
        }
        smokeFileMode = mode;
        return true;
    });
    ipcMain.handle('desktop:smoke-files-begin-write', async event => {
        const {root, target} = requireSmokeFileContext(event);
        if (smokeFileMode === 'deny') throw new Error('EACCES: simulated save access denied');
        const failClose = smokeFileMode === 'fail-close';
        if (failClose) smokeFileMode = 'normal';
        await fs.mkdir(root, {recursive: true});
        const id = ++smokeFileSequence;
        const temporary = path.join(root, `${SMOKE_PROJECT_FILENAME}.${id}.partial`);
        const file = await fs.open(temporary, 'w');
        smokeFileWriters.set(id, {file, temporary, target, failClose});
        return {id, name: SMOKE_PROJECT_FILENAME};
    });
    ipcMain.handle('desktop:smoke-files-write', async (event, payload) => {
        requireSmokeFileContext(event);
        const writer = payload && smokeFileWriters.get(payload.id);
        if (!writer || typeof payload.base64 !== 'string' || payload.base64.length > 16 * 1024 * 1024) {
            throw new Error('Invalid smoke file write request.');
        }
        await writer.file.write(Buffer.from(payload.base64, 'base64'));
        return true;
    });
    ipcMain.handle('desktop:smoke-files-close', async (event, id) => {
        requireSmokeFileContext(event);
        const writer = smokeFileWriters.get(id);
        if (!writer) throw new Error('The smoke file writer is no longer active.');
        smokeFileWriters.delete(id);
        await writer.file.sync();
        await writer.file.close();
        if (writer.failClose) {
            await fs.rm(writer.temporary, {force: true});
            throw new Error('EIO: simulated atomic replacement failure');
        }
        await fs.rename(writer.temporary, writer.target);
        return true;
    });
    ipcMain.handle('desktop:smoke-files-abort', async (event, id) => {
        const {root} = requireSmokeFileContext(event);
        const writer = smokeFileWriters.get(id);
        if (!writer) return false;
        smokeFileWriters.delete(id);
        await writer.file.close().catch(() => {});
        if (path.dirname(writer.temporary) !== root) throw new Error('Invalid smoke file path.');
        await fs.rm(writer.temporary, {force: true});
        return true;
    });
    ipcMain.handle('desktop:smoke-files-read', async event => {
        const {target} = requireSmokeFileContext(event);
        try {
            const contents = await fs.readFile(target);
            return {name: SMOKE_PROJECT_FILENAME, base64: contents.toString('base64'), byteLength: contents.length};
        } catch (error) {
            if (error && error.code === 'ENOENT') return null;
            throw error;
        }
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
            if (process.env.BRICKWRIGHT_DESKTOP_SMOKE === '1') {
                app.exit(1);
                return;
            }
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
