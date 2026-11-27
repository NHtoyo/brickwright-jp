const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readDesktopFile = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('macOS entitlement plist includes media devices and Bluetooth', () => {
    const plist = readDesktopFile('assets/entitlements.mac.plist');
    for (const entitlement of [
        'com.apple.security.device.camera',
        'com.apple.security.device.audio-input',
        'com.apple.security.device.bluetooth'
    ]) {
        assert.match(plist, new RegExp(`<key>${entitlement}<\\/key>\\s*<true\\/>`));
    }
});

test('macOS bundle declares distinct camera and microphone usage descriptions', () => {
    const builder = readDesktopFile('electron-builder.yml');
    assert.match(builder, /NSCameraUsageDescription:\s*[^\n]*カメラ/);
    assert.match(builder, /NSMicrophoneUsageDescription:\s*[^\n]*マイク/);
});
