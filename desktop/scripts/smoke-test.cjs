const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const electron = require('electron');

const desktopDir = path.resolve(__dirname, '..');
const reportFile = path.join(os.tmpdir(), `brickwright-smoke-${process.pid}.json`);
const userDataDir = path.join(os.tmpdir(), `brickwright-smoke-profile-${process.pid}`);
const packagedExecutable = process.env.BRICKWRIGHT_SMOKE_EXECUTABLE;
const electronBinary = packagedExecutable || electron;
const child = spawn(electronBinary, packagedExecutable ? [] : ['.'], {
    cwd: desktopDir,
    env: {
        ...process.env,
        BRICKWRIGHT_DESKTOP_SMOKE: '1',
        BRICKWRIGHT_SMOKE_REPORT: reportFile,
        BRICKWRIGHT_SMOKE_USER_DATA: userDataDir
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
});
let stdout = '';
let stderr = '';
let timedOut = false;
const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
}, 45000);

child.stdout.on('data', chunk => {
    stdout += chunk.toString();
});
child.stderr.on('data', chunk => {
    stderr += chunk.toString();
});
child.on('error', error => {
    clearTimeout(timer);
    console.error(error);
    process.exitCode = 1;
});
child.on('exit', code => {
    clearTimeout(timer);
    try {
        assert.equal(timedOut, false, `Electron smoke timed out. stderr: ${stderr}`);
        assert.equal(code, 0, `Electron exited with ${code}. stderr: ${stderr}`);
        const result = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.match(result.href, /^app:\/\/brickwright\/editor\.html(?:#.*)?$/);
        assert.equal(result.secure, true);
        assert.equal(result.bluetooth, true,
            'Chromium must expose navigator.bluetooth in the app:// secure context');
        assert.equal(result.usb, true,
            'Chromium must expose navigator.usb in the app:// secure context');
        assert.equal(result.devicePickerSmoke.bluetooth.outcome, 'rejected',
            'the Bluetooth requestDevice call must return from the application picker cancellation');
        assert.ok(result.bluetoothChooserEventCount > 0,
            'a real Electron Web Bluetooth request must reach the picker event');
        assert.equal(result.devicePickerSmoke.usb.outcome, 'rejected',
            'the USB requestDevice call must return from the application picker cancellation');
        if (result.usbChooserEventCount === 0) {
            assert.equal(result.devicePickerSmoke.usb.errorName, 'NotFoundError',
                'without an attached matching USB device, WebUSB must report no available candidate');
        }
        assert.equal(result.extensionStatus, 200,
            'bundled SPIKE extension must be served from app://');
        assert.equal(result.editorReady, true, 'editor root must be mounted');
        assert.equal(result.controlCenterVisible, true,
            'SPIKE live control center must be rendered');
        assert.equal(result.spikeLoaded, true, 'SPIKE must be registered in the real Scratch VM');
        assert.equal(result.spikeRouterRegistered, true,
            'SPIKE control center must share the registered VM HubRouter');
        assert.ok(result.spikeBlockCount > 0, 'SPIKE block metadata must be registered in the real Scratch VM');
        assert.equal(result.paletteWidth, 280, 'fresh desktop profiles use the requested 280px default palette width');
        assert.ok(result.paletteCenterErrorPx <= 2, 'resize handle center must match the rendered flyout boundary');
        assert.equal(result.paletteHitAreaClear, true, 'resize hit area must not cover palette blocks');
        assert.equal(result.paletteHasWorkspaceReserve, true,
            'the palette must leave at least 360px for the workspace');
        assert.equal(result.fileSystemAccess, true, 'Electron must expose the existing File System Access APIs');
        assert.equal(result.sb3RoundTrip.success, true,
            'the real Electron Scratch VM must save and reload an SB3 archive');
        assert.ok(result.sb3RoundTrip.savedBytes > 0, 'SB3 round trip must produce a non-empty project archive');
        assert.ok(result.sb3RoundTrip.targetCount >= 2, 'SB3 round trip must restore stage and sprite targets');
        assert.equal(result.sb3RoundTrip.spikeBlockRestored, true, 'SB3 round trip must retain a SPIKE opcode');
        assert.equal(result.sb3RoundTrip.scratchBlockRestored, true, 'SB3 round trip must retain a Scratch opcode');
        const spikeSourcePattern = /^app:\/\/brickwright\/extensions\/CrispStrobe\/legospike_turbowarp_transpile\.js\?/;
        assert.match(result.spikeSourceURL, spikeSourcePattern);
        console.log(`Electron app shell smoke passed: ${JSON.stringify(result)}`);
    } catch (error) {
        console.error(error.message);
        console.error(stdout);
        console.error(stderr);
        process.exitCode = 1;
    } finally {
        try {
            fs.unlinkSync(reportFile);
        } catch (error) { /* best effort */ }
        try {
            fs.rmSync(userDataDir, {recursive: true, force: true});
        } catch (error) { /* best effort */ }
    }
});
