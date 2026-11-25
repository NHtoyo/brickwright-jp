const assert = require('node:assert/strict');
const test = require('node:test');

const notices = import('../scripts/generate-notices.mjs');

test('web license inventory is tied to the exact lockfile, built web files, and source commit', async () => {
    const {verifyWebRuntimeProvenance} = await notices;
    const manifest = {
        schemaVersion: 1,
        rootLockSha256: 'root-lock-sha',
        webBuildSha256: 'web-build-sha',
        sourceCommit: 'a'.repeat(40)
    };
    assert.doesNotThrow(() => verifyWebRuntimeProvenance({
        manifest,
        lockSha256: 'root-lock-sha',
        buildSha256: 'web-build-sha',
        commit: 'a'.repeat(40)
    }));
    assert.throws(() => verifyWebRuntimeProvenance({
        manifest,
        lockSha256: 'wrong-lock-sha',
        buildSha256: 'web-build-sha',
        commit: 'a'.repeat(40)
    }), /lockfile SHA-256/);
    assert.throws(() => verifyWebRuntimeProvenance({
        manifest,
        lockSha256: 'root-lock-sha',
        buildSha256: 'wrong-web-sha',
        commit: 'a'.repeat(40)
    }), /build SHA-256/);
    assert.throws(() => verifyWebRuntimeProvenance({
        manifest,
        lockSha256: 'root-lock-sha',
        buildSha256: 'web-build-sha',
        commit: 'b'.repeat(40)
    }), /source commit/);
});

test('web license inventory rejects unsupported and incomplete metadata', async () => {
    const {verifyWebRuntimeProvenance} = await notices;
    assert.throws(() => verifyWebRuntimeProvenance({
        manifest: {schemaVersion: 2},
        lockSha256: 'lock',
        buildSha256: 'build',
        commit: 'unknown'
    }), /manifest version/);
});

test('webpack runtime modules map to the most-specific locked package roots', async () => {
    const {matchRuntimePackagesToLock} = await notices;
    const lockPackages = {
        'node_modules/alpha': {},
        'node_modules/alpha/node_modules/beta': {},
        'node_modules/@scope/package': {}
    };
    assert.deepEqual(matchRuntimePackagesToLock([
        'node_modules/alpha/index.js',
        'node_modules/alpha/node_modules/beta/lib/index.js',
        'node_modules/@scope/package/dist/runtime.js',
        'node_modules/not-in-lock/index.js'
    ], lockPackages), {
        packagePaths: [
            'node_modules/@scope/package',
            'node_modules/alpha',
            'node_modules/alpha/node_modules/beta'
        ],
        unmappedModules: ['node_modules/not-in-lock/index.js']
    });
});

test('desktop and web package inventories merge only matching package identities', async () => {
    const {mergePackageInventories} = await notices;
    const merged = mergePackageInventories([
        {name: 'same',
            version: '1.0.0',
            integrity: 'sha512:a',
            license: 'MIT',
            homepage: 'https://same',
            source: 'web',
            packagePath: 'same',
            licenseTextFiles: ['web/LICENSE']},
        {name: 'same',
            version: '1.0.0',
            integrity: 'sha512:a',
            license: 'MIT',
            homepage: 'https://same',
            source: 'desktop',
            packagePath: 'same',
            licenseTextFiles: ['desktop/LICENSE']},
        {name: 'same',
            version: '2.0.0',
            integrity: 'sha512:b',
            license: 'MIT',
            homepage: 'https://same',
            source: 'desktop',
            packagePath: 'same-v2',
            licenseTextFiles: []}
    ]);
    assert.equal(merged.packages.length, 2);
    assert.deepEqual(merged.conflicts, []);
    assert.deepEqual(merged.packages[0].sources, ['desktop', 'web']);
    assert.deepEqual(merged.packages[0].licenseTextFiles, ['desktop/LICENSE', 'web/LICENSE']);
    assert.equal(merged.packages[1].version, '2.0.0', 'different versions remain distinct');
});
