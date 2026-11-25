const assert = require('node:assert/strict');
const test = require('node:test');
const {isPackagerImportURL, isPackagerURL} = require('../navigation.cjs');

test('allows only the trusted Packager import URL from the Brickwright editor', () => {
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org/?import_from=app%3A%2F%2Fbrickwright'), true);
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org/?import_from=https%3A%2F%2Fbrickwright.example'), false);
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org.evil.example/?import_from=app%3A%2F%2Fbrickwright'), false);
    assert.equal(isPackagerImportURL('https://user@packager.turbowarp.org/?import_from=app%3A%2F%2Fbrickwright'), false);
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org:444/?import_from=app%3A%2F%2Fbrickwright'), false);
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org/path?import_from=app%3A%2F%2Fbrickwright'), false);
    assert.equal(isPackagerImportURL('https://packager.turbowarp.org/?import_from=app%3A%2F%2Fbrickwright&other=1'), false);
});

test('limits Packager child navigation to HTTPS Packager origin without credentials or custom ports', () => {
    assert.equal(isPackagerURL('https://packager.turbowarp.org/'), true);
    assert.equal(isPackagerURL('https://packager.turbowarp.org/packager'), true);
    assert.equal(isPackagerURL('http://packager.turbowarp.org/'), false);
    assert.equal(isPackagerURL('https://packager.turbowarp.org.evil.example/'), false);
    assert.equal(isPackagerURL('https://user@packager.turbowarp.org/'), false);
    assert.equal(isPackagerURL('https://packager.turbowarp.org:444/'), false);
});
