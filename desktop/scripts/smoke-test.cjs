const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const electron = require('electron');

const desktopDir = path.resolve(__dirname, '..');
const reportFile = path.join(os.tmpdir(), `brickwright-smoke-${process.pid}.json`);
const reopenReportFile = path.join(os.tmpdir(), `brickwright-smoke-reopen-${process.pid}.json`);
const userDataDir = path.join(os.tmpdir(), `brickwright-smoke-profile-${process.pid}`);
const smokeFileRoot = path.join(os.tmpdir(), `brickwright-smoke-files-${process.pid}`);
const packagedExecutable = process.env.BRICKWRIGHT_SMOKE_EXECUTABLE;
const electronBinary = packagedExecutable || electron;
fs.rmSync(smokeFileRoot, {recursive: true, force: true});
const child = spawn(electronBinary, packagedExecutable ? [] : ['.'], {
    cwd: desktopDir,
    env: {
        ...process.env,
        BRICKWRIGHT_DESKTOP_SMOKE: '1',
        BRICKWRIGHT_SMOKE_REPORT: reportFile,
        BRICKWRIGHT_SMOKE_USER_DATA: userDataDir,
        BRICKWRIGHT_SMOKE_FILE_ROOT: smokeFileRoot
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
});
let stdout = '';
let stderr = '';
let timedOut = false;
const markFailed = () => {
    process.exitCode = 1;
};
const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
}, 150000);

child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
});
child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
});
child.on('error', error => {
    clearTimeout(timer);
    console.error(error);
    process.exitCode = 1;
});
child.on('exit', async code => {
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
        if (result.bluetoothChooserEventCount === 0) {
            assert.equal(result.devicePickerSmoke.bluetooth.errorName, 'NotFoundError',
                'without a Bluetooth adapter or discoverable device, Web Bluetooth must report no available candidate');
        }
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
        assert.ok(result.paletteDragSmoke.scratch.created.some(block => !block.opcode.startsWith('spikeprime_')),
            'a Scratch block must be dragged from the real toolbox into the editor workspace');
        assert.ok(result.paletteDragSmoke.spike.created.some(block => block.opcode.startsWith('spikeprime_')),
            'a SPIKE block must be dragged from the real toolbox into the editor workspace');
        assert.equal(result.spikeLoaded, true, 'SPIKE must be registered in the real Scratch VM');
        assert.equal(result.spikeRouterRegistered, true,
            'SPIKE control center must share the registered VM HubRouter');
        assert.ok(result.spikeBlockCount > 0, 'SPIKE block metadata must be registered in the real Scratch VM');
        const responsiveMaximum = Math.max(210, result.blocksContainerWidth - 360 - 8);
        const expectedPaletteWidth = Math.max(210, Math.min(280, responsiveMaximum));
        assert.equal(result.paletteWidth, expectedPaletteWidth,
            'fresh desktop profiles use the requested palette width, clamped to preserve workspace space');
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
        assert.equal(result.fileOperations.actualFilePickerFlow, true,
            'the actual File menu and product File System Access save/open flow must write and reload an OS file');
        assert.equal(result.fileOperations.fileName, 'Brickwright_日本語 project with spaces.sb3');
        assert.equal(result.fileOperations.failedReplacementPreservedFile, true,
            'a failed replacement must preserve the prior on-disk project');
        assert.equal(result.fileOperations.deniedWritePreservedFile, true,
            'a denied save must preserve the prior on-disk project');
        assert.equal(result.fileOperations.saveCancelPreservedFile, true,
            'cancelling a save picker must preserve the prior on-disk project');
        assert.equal(result.fileOperations.openCancelPreservedProject, true,
            'cancelling an open picker must preserve the current editor project');
        assert.equal(result.fileOperations.projectReloaded, true,
            'the product open flow must reload the edited SB3 from its real OS file');
        assert.equal(result.fileOperations.savedScratchAndSpikeBlocks, true,
            'the real project file must retain blocks dragged from both Scratch and SPIKE toolboxes');
        assert.notEqual(result.fileOperations.updatedFile.digest, result.fileOperations.initialFile.digest,
            'editing the actual Scratch project must change the SB3 written by overwrite save');
        assert.equal(result.fileOperations.costumeCount > 0, true,
            'the saved and reloaded Scratch project must retain costume assets');
        assert.equal(result.fileOperations.soundCount > 0, true,
            'the saved and reloaded Scratch project must retain sound assets');
        assert.equal(result.codeTabSmoke.pseudocodeGenerated, true,
            'the Code tab must generate pseudocode from real Scratch blocks');
        assert.equal(result.codeTabSmoke.pythonGenerated, true,
            'the Code tab must generate Python from real Scratch blocks');
        assert.equal(result.codeTabSmoke.spikeCodeGenerated, true,
            'the Code tab must emit the runtime call for a real SPIKE block');
        assert.equal(result.codeTabSmoke.containsSpikeBlockInProject, true,
            'the code conversion scenario must retain SPIKE blocks in the same Scratch project');
        assert.ok(result.circuitTabSmoke.partsPlaced >= 2,
            'the Circuit tab must place and render real parts on its board');
        assert.equal(result.circuitTabSmoke.powerToggled, true);
        assert.equal(result.circuitTabSmoke.simulationStarted, true);
        assert.equal(result.circuitTabSmoke.returnedToBuildMode, true);
        assert.ok(result.fileOperations.fileByteLength > 0);
        const savedProjectPath = path.join(smokeFileRoot, 'Brickwright_日本語 project with spaces.sb3');
        const savedProject = fs.readFileSync(savedProjectPath);
        assert.ok(savedProject.length > 0 && savedProject[0] === 0x50 && savedProject[1] === 0x4b,
            'the OS file must contain the actual SB3 zip archive');
        assert.equal(savedProject.length, result.fileOperations.fileByteLength);
        const reopenChild = spawn(electronBinary, packagedExecutable ? [] : ['.'], {
            cwd: desktopDir,
            env: {
                ...process.env,
                BRICKWRIGHT_DESKTOP_SMOKE: '1',
                BRICKWRIGHT_SMOKE_REOPEN: '1',
                BRICKWRIGHT_SMOKE_REPORT: reopenReportFile,
                BRICKWRIGHT_SMOKE_USER_DATA: userDataDir,
                BRICKWRIGHT_SMOKE_FILE_ROOT: smokeFileRoot
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let reopenStderr = '';
        let reopenTimedOut = false;
        const reopenTimer = setTimeout(() => {
            reopenTimedOut = true;
            reopenChild.kill();
        }, 60000);
        reopenChild.stdout.on('data', chunk => {
            process.stdout.write(chunk);
        });
        reopenChild.stderr.on('data', chunk => {
            reopenStderr += chunk.toString();
            process.stderr.write(chunk);
        });
        const reopenCode = await new Promise((resolve, reject) => {
            reopenChild.once('error', reject);
            reopenChild.once('exit', resolve);
        });
        clearTimeout(reopenTimer);
        assert.equal(reopenTimedOut, false, `Electron reopen smoke timed out: ${reopenStderr}`);
        assert.equal(reopenCode, 0, `Electron reopen smoke exited with ${reopenCode}: ${reopenStderr}`);
        const reopened = JSON.parse(fs.readFileSync(reopenReportFile, 'utf8'));
        assert.equal(reopened.actualFilePickerFlow, true);
        assert.equal(reopened.loadResolved, true, 'the product open flow must finish after relaunch');
        assert.equal(reopened.loadInputMatchesSavedFile, true,
            'the relaunched app must open bytes read from the actual OS file');
        assert.equal(reopened.scratchBlockRestored, true);
        assert.equal(reopened.spikeBlockRestored, true);
        assert.ok(reopened.costumeCount > 0);
        assert.ok(reopened.soundCount > 0);
        assert.equal(result.bluetoothSelectionSimulation.repeatedDiscoveryEvents, 10);
        assert.equal(result.bluetoothSelectionSimulation.uniqueRequestSessions, 1);
        assert.equal(result.bluetoothSelectionSimulation.callbacksSettled, 10);
        assert.equal(result.bluetoothSelectionSimulation.cancelSettlements, 1);
        assert.equal(result.bluetoothSelectionSimulation.explicitCancelValue, '');
        assert.equal(result.bluetoothSelectionSimulation.addedAndRemovedDeviceListObserved, true);
        assert.equal(result.bluetoothSelectionSimulation.pickerWindowSelection, true);
        assert.match(result.bluetoothSelectionSimulation.selectedDeviceId, /-essential$/);
        const spikeSourcePattern = /^app:\/\/brickwright\/extensions\/CrispStrobe\/legospike_turbowarp_transpile\.js\?/;
        assert.match(result.spikeSourceURL, spikeSourcePattern);
        console.log(`Electron app shell smoke passed: ${JSON.stringify(result)}`);
        console.log(`Electron relaunch/open smoke passed: ${JSON.stringify(reopened)}`);
    } catch (error) {
        console.error(error.message);
        console.error(stdout);
        console.error(stderr);
        markFailed();
    } finally {
        try {
            fs.unlinkSync(reportFile);
        } catch (error) { /* best effort */ }
        try {
            fs.unlinkSync(reopenReportFile);
        } catch (error) { /* best effort */ }
        try {
            fs.rmSync(userDataDir, {recursive: true, force: true});
        } catch (error) { /* best effort */ }
        try {
            fs.rmSync(smokeFileRoot, {recursive: true, force: true});
        } catch (error) { /* best effort */ }
    }
});
