'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createAppProtocolHandler, resolveAppAsset} = require('../app-protocol.cjs');

test('serves a file only from the Brickwright app origin and returns MIME metadata', async t => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brickwright-app-protocol-'));
    t.after(() => fs.rm(tempRoot, {recursive: true, force: true}));
    await fs.writeFile(path.join(tempRoot, 'editor.html'), '<main>editor</main>');
    const resolved = await resolveAppAsset(tempRoot, 'app://brickwright/editor.html?build=test');
    assert.ok(resolved);
    assert.equal(resolved.mimeType, 'text/html; charset=utf-8');

    const handler = createAppProtocolHandler({
        assetRoot: tempRoot,
        net: {fetch: async () => new Response('<main>editor</main>', {status: 200})}
    });
    const response = await handler({url: 'app://brickwright/editor.html'});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), '<main>editor</main>');
});

test('rejects an external origin, malformed encoding, traversal, missing files, and non-files', async t => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brickwright-app-protocol-'));
    t.after(() => fs.rm(tempRoot, {recursive: true, force: true}));
    await fs.mkdir(path.join(tempRoot, 'folder'));
    await fs.writeFile(path.join(tempRoot, 'folder', 'asset.js'), 'export {};');
    assert.equal(await resolveAppAsset(tempRoot, 'https://brickwright/secret'), null);
    assert.equal(await resolveAppAsset(tempRoot, 'app://evil/secret'), null);
    assert.equal(await resolveAppAsset(tempRoot, 'app://brickwright/%E0%A4%A'), null);
    assert.equal(await resolveAppAsset(tempRoot, 'app://brickwright/%2e%2e%2fsecret.txt'), null);
    assert.equal(await resolveAppAsset(tempRoot, 'app://brickwright/missing.js'), null);
    assert.equal(await resolveAppAsset(tempRoot, 'app://brickwright/folder'), null);
    assert.equal((await resolveAppAsset(tempRoot, 'app://brickwright/folder/asset.js')).mimeType, 'text/javascript; charset=utf-8');
});

test('rejects symlinks that resolve outside the packaged asset directory', async t => {
    const tempParent = await fs.mkdtemp(path.join(os.tmpdir(), 'brickwright-app-protocol-link-'));
    t.after(() => fs.rm(tempParent, {recursive: true, force: true}));
    const root = path.join(tempParent, 'app');
    const outside = path.join(tempParent, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
        await fs.symlink(outside, path.join(root, 'escape'), 'junction');
    } catch (error) {
        t.skip(`symlink creation is unavailable on this Windows host: ${error.code || error.message}`);
        return;
    }
    assert.equal(await resolveAppAsset(root, 'app://brickwright/escape/secret.txt'), null);
});
