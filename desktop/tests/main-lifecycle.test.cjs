const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const test = require('node:test');

const waitFor = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for the Electron lifecycle mock.');
};

const createHarness = async () => {
    const windows = [];
    const dialogResponses = [];
    const dialogCalls = [];
    let windowId = 0;
    let resolveReady;
    const ready = new Promise(resolve => {
        resolveReady = resolve;
    });

    const app = new EventEmitter();
    app.isPackaged = true;
    app.quitAttempts = 0;
    app.quitCompletions = 0;
    app.setAppUserModelId = () => {};
    app.requestSingleInstanceLock = () => true;
    app.getVersion = () => '1.0.0';
    app.setPath = () => {};
    app.whenReady = () => ready;
    app.quit = () => {
        app.quitAttempts++;
        let prevented = false;
        app.emit('before-quit', {preventDefault: () => {
            prevented = true;
        }});
        if (!prevented) app.quitCompletions++;
    };
    app.exit = code => {
        app.exitCode = code;
    };

    class FakeBrowserWindow extends EventEmitter {
        constructor (options) {
            super();
            this.id = ++windowId;
            this.options = options;
            this.destroyed = false;
            this.url = '';
            this.webContents = Object.assign(new EventEmitter(), {
                id: this.id,
                getURL: () => this.url,
                setWindowOpenHandler: () => {},
                send: () => {},
                focus: () => {},
                openDevTools: () => {},
                executeJavaScript: () => Promise.resolve({connectedAtStart: false, disconnected: true})
            });
            windows.push(this);
        }

        isDestroyed () {
            return this.destroyed;
        }

        isMinimized () {
            return false;
        }

        restore () {}
        show () {}
        focus () {}

        loadURL (url) {
            this.url = url;
            return Promise.resolve();
        }

        close () {
            if (this.destroyed) return;
            let prevented = false;
            this.emit('close', {preventDefault: () => {
                prevented = true;
            }});
            if (prevented) return;
            this.destroyed = true;
            const index = windows.indexOf(this);
            if (index !== -1) windows.splice(index, 1);
            this.emit('closed');
        }
    }
    FakeBrowserWindow.getAllWindows = () => windows.filter(window => !window.isDestroyed());

    const materializeMenuItem = item => {
        const materialized = {...item};
        if (item.submenu) materialized.submenu = {items: item.submenu.map(materializeMenuItem)};
        return materialized;
    };
    const Menu = {
        buildFromTemplate: template => ({items: template.map(materializeMenuItem)}),
        setApplicationMenu: menu => {
            Menu.applicationMenu = menu;
        }
    };
    const ipcMain = new EventEmitter();
    ipcMain.handlers = new Map();
    ipcMain.handle = (channel, handler) => ipcMain.handlers.set(channel, handler);
    const defaultSession = new EventEmitter();
    defaultSession.setPermissionCheckHandler = handler => {
        defaultSession.permissionCheckHandler = handler;
    };
    defaultSession.setPermissionRequestHandler = handler => {
        defaultSession.permissionRequestHandler = handler;
    };
    defaultSession.setDevicePermissionHandler = handler => {
        defaultSession.devicePermissionHandler = handler;
    };
    const electron = {
        app,
        BrowserWindow: FakeBrowserWindow,
        Menu,
        dialog: {
            showMessageBox: (_window, options) => {
                dialogCalls.push(options);
                return Promise.resolve({response: dialogResponses.length ? dialogResponses.shift() : 0});
            },
            showSaveDialog: () => Promise.resolve({canceled: true})
        },
        ipcMain,
        nativeImage: {createFromPath: () => ({})},
        net: {},
        powerMonitor: new EventEmitter(),
        protocol: {
            registerSchemesAsPrivileged: () => {},
            handle: () => {}
        },
        session: {defaultSession},
        shell: {openExternal: async () => {}},
        systemPreferences: {askForMediaAccess: () => Promise.resolve(true)}
    };
    const autoUpdater = Object.assign(new EventEmitter(), {
        checkForUpdates: async () => {},
        quitAndInstall: () => {}
    });

    const originalLoad = Module._load;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {...originalPlatform, value: 'darwin'});
    Module._load = function (request, parent, isMain) {
        if (request === 'electron') return electron;
        if (request === 'electron-updater') return {autoUpdater};
        if (request === 'node:fs/promises') {
            const fs = originalLoad.call(this, request, parent, isMain);
            return {
                ...fs,
                readFile: (filePath, encoding) => {
                    if (String(filePath).endsWith('build-info.json')) {
                        return Promise.resolve(JSON.stringify({
                            application: 'Brickwright',
                            version: '1.0.0',
                            commit: 'test-commit',
                            buildType: 'release'
                        }));
                    }
                    return fs.readFile(filePath, encoding);
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    const mainPath = require.resolve('../main.cjs');
    delete require.cache[mainPath];
    try {
        // eslint-disable-next-line global-require
        require(mainPath);
    } finally {
        Module._load = originalLoad;
    }
    resolveReady();
    await waitFor(() => windows.length === 1 && Menu.applicationMenu && autoUpdater.listenerCount('update-downloaded'));

    return {
        app,
        autoUpdater,
        dialogCalls,
        dialogResponses,
        electron,
        menu: Menu.applicationMenu,
        powerMonitor: electron.powerMonitor,
        windows,
        restore: () => {
            delete require.cache[mainPath];
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    };
};

const findMenuItem = (items, label) => {
    for (const item of items) {
        if (item.label === label) return item;
        const nested = item.submenu && findMenuItem(item.submenu.items, label);
        if (nested) return nested;
    }
    return null;
};

test('native menus, quit cancellation, window recreation, and sleep recovery stay safe', async () => {
    const harness = await createHarness();
    try {
        const {app, autoUpdater, dialogCalls, dialogResponses, electron, menu, powerMonitor, windows} = harness;
        assert.equal(menu.items[0].label, 'Brickwright');
        const editMenu = menu.items.find(item => item.label === '編集');
        const windowMenu = menu.items.find(item => item.label === 'ウインドウ');
        assert.ok(editMenu);
        assert.ok(windowMenu);
        assert.equal(editMenu.role, 'editMenu');
        assert.equal(windowMenu.role, 'windowMenu');
        assert.equal(Object.hasOwn(editMenu, 'accelerator'), false);
        assert.equal(Object.hasOwn(windowMenu, 'accelerator'), false);

        const updateMenuItem = findMenuItem(menu.items, '更新をインストールして再起動');
        autoUpdater.emit('update-downloaded');
        assert.equal(updateMenuItem.enabled, false);
        const sendActivity = projectChanged => {
            const mainWindow = windows[0];
            electron.ipcMain.emit('desktop:activity', {sender: mainWindow.webContents}, {
                bluetoothConnected: false,
                projectRunning: false,
                motorActive: false,
                controllerReady: false,
                controllerBusy: false,
                projectChanged
            });
        };
        sendActivity(false);
        assert.equal(updateMenuItem.enabled, true);
        powerMonitor.emit('suspend');
        assert.equal(updateMenuItem.enabled, false);
        powerMonitor.emit('resume');
        assert.equal(updateMenuItem.enabled, false);
        sendActivity(false);
        assert.equal(updateMenuItem.enabled, true);

        sendActivity(true);
        dialogResponses.push(2);
        app.quit();
        await waitFor(() => dialogCalls.length === 1);
        await new Promise(resolve => setTimeout(resolve, 10));
        const firstWindow = windows[0];
        assert.equal(firstWindow.isDestroyed(), false, 'a canceled quit leaves its window open');
        assert.equal(app.quitAttempts, 1);

        dialogResponses.push(1);
        firstWindow.close();
        await waitFor(() => windows.length === 0);
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(app.quitAttempts, 1, 'the canceled quit request is not reused by a later window close');

        app.emit('activate');
        await waitFor(() => windows.length === 1);
        const recreatedWindow = windows[0];
        dialogResponses.push(1);
        recreatedWindow.close();
        await waitFor(() => dialogCalls.length === 3);
        await waitFor(() => windows.length === 0);
        assert.equal(app.quitAttempts, 1);
    } finally {
        harness.restore();
    }
});
