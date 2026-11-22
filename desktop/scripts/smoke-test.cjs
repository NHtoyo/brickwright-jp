'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const desktopDir = path.resolve(__dirname, '..');
const reportFile = path.join(os.tmpdir(), `brickwright-smoke-${process.pid}.json`);
const electronBinary = require('electron');
const child = spawn(electronBinary, ['.'], {
    cwd: desktopDir,
    env: {...process.env, BRICKWRIGHT_DESKTOP_SMOKE: '1', BRICKWRIGHT_SMOKE_REPORT: reportFile},
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

child.stdout.on('data', chunk => { stdout += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
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
        assert.equal(result.bluetooth, true, 'Chromium must expose navigator.bluetooth in the app:// secure context');
        assert.equal(result.extensionStatus, 200, 'bundled SPIKE extension must be served from app://');
        assert.equal(result.editorReady, true, 'editor root must be mounted');
        console.log(`Electron app shell smoke passed: ${JSON.stringify(result)}`);
    } catch (error) {
        console.error(error.message);
        console.error(stdout);
        console.error(stderr);
        process.exitCode = 1;
    } finally {
        try { fs.unlinkSync(reportFile); } catch (error) { /* best effort */ }
    }
});
