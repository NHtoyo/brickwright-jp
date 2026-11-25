const assert = require('node:assert/strict');
const test = require('node:test');
const {createPermissionPolicy} = require('../permission-policy.cjs');

const setup = ({confirm = () => true, requestOSMediaAccess = () => true} = {}) => {
    const contents = {id: 17, isDestroyed: () => false, getURL: () => 'app://brickwright/editor.html'};
    const approved = new Set();
    return {
        contents,
        approved,
        policy: createPermissionPolicy({getMainContents: () => contents, confirm, requestOSMediaAccess, approved})
    };
};

test('allows only safe editor permissions and requires user consent for camera and microphone', async () => {
    let confirmations = 0;
    const {contents, policy, approved} = setup({confirm: () => {
        confirmations++;
        return true;
    }});
    assert.equal(policy.permissionCheck(contents, 'bluetooth', 'app://brickwright'), true);
    assert.equal(policy.permissionCheck(contents, 'clipboard-sanitized-write', 'app://brickwright'), true);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright'), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {mediaTypes: ['video', 'audio']}), true);
    assert.equal(confirmations, 1);
    assert.equal(approved.size, 1);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright'), true);
});

test('denies untrusted frames, external pages, unsupported permission types, and declined prompts', async () => {
    const {contents, policy} = setup({confirm: () => false});
    assert.equal(await policy.permissionRequest(contents, 'media', 'https://example.com', {mediaTypes: ['video']}), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {isMainFrame: false, mediaTypes: ['video']}), false);
    assert.equal(await policy.permissionRequest(contents, 'geolocation', 'app://brickwright/editor.html'), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {mediaTypes: ['screen']}), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {mediaTypes: ['video']}), false);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright'), false);
});

test('does not confirm media permission until every requested OS permission is available', async () => {
    let osCalls = 0;
    const {contents, policy, approved} = setup({requestOSMediaAccess: () => {
        osCalls++;
        return osCalls === 1;
    }});
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {mediaTypes: ['video', 'audio']}), false);
    assert.equal(osCalls, 2);
    assert.equal(approved.size, 0);
});
