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

test('camera and microphone require separate consent and retain separate grants', async () => {
    const confirmations = [];
    const osRequests = [];
    const {contents, policy, approved} = setup({
        confirm: request => {
            confirmations.push(request);
            return true;
        },
        requestOSMediaAccess: mediaType => {
            osRequests.push(mediaType);
            return true;
        }
    });

    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), true);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), true);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['audio']
    }), false);

    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['audio']
    }), true);
    assert.deepEqual(confirmations, [
        {permission: 'media', mediaTypes: ['video'], mediaType: 'video'},
        {permission: 'media', mediaTypes: ['audio'], mediaType: 'audio'}
    ]);
    assert.deepEqual(osRequests, ['video', 'audio']);
    assert.equal(approved.size, 2);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video', 'audio']
    }), true);
});

test('a combined media request asks separately and does not grant a denied media type', async () => {
    const confirmations = [];
    const osRequests = [];
    const {contents, policy} = setup({
        confirm: request => {
            confirmations.push(request.mediaType);
            return request.mediaType === 'video';
        },
        requestOSMediaAccess: mediaType => {
            osRequests.push(mediaType);
            return true;
        }
    });

    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video', 'audio']
    }), false);
    assert.deepEqual(confirmations, ['video', 'audio']);
    assert.deepEqual(osRequests, ['video']);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), true);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['audio']
    }), false);
});

test('allows only safe editor permissions and requires user consent for clipboard reads', async () => {
    let confirmations = 0;
    const {contents, policy} = setup({confirm: () => {
        confirmations++;
        return true;
    }});
    assert.equal(policy.permissionCheck(contents, 'bluetooth', 'app://brickwright'), true);
    assert.equal(policy.permissionCheck(contents, 'clipboard-sanitized-write', 'app://brickwright'), true);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), false);
    assert.equal(await policy.permissionRequest(contents, 'clipboard-read', 'app://brickwright/editor.html'), true);
    assert.equal(confirmations, 1);
    assert.equal(policy.permissionCheck(contents, 'clipboard-read', 'app://brickwright/editor.html'), true);
});

test('denies untrusted frames, external pages, unsupported permission types, and declined prompts', async () => {
    const {contents, policy} = setup({confirm: () => false});
    assert.equal(await policy.permissionRequest(contents, 'media', 'https://example.com', {mediaTypes: ['video']}), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        isMainFrame: false,
        mediaTypes: ['video']
    }), false);
    assert.equal(await policy.permissionRequest(contents, 'geolocation', 'app://brickwright/editor.html'), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['screen']
    }), false);
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html'), false);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html'), false);
});

test('does not cache a media grant when the matching OS permission is denied', async () => {
    const {contents, policy, approved} = setup({requestOSMediaAccess: () => false});
    assert.equal(await policy.permissionRequest(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), false);
    assert.equal(approved.size, 0);
    assert.equal(policy.permissionCheck(contents, 'media', 'app://brickwright/editor.html', {
        mediaTypes: ['video']
    }), false);
});
