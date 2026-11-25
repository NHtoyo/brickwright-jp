const {URL} = require('node:url');

const SAFE_AUTOMATIC_PERMISSIONS = new Set([
    'bluetooth', 'bluetooth-scanning', 'clipboard-sanitized-write', 'usb'
]);
const USER_CONSENT_PERMISSIONS = new Set(['media', 'clipboard-read']);

const isTrustedEditorRequest = ({contents, mainContents, requestingURL, details = {}}) => {
    if (!contents || contents !== mainContents || contents.isDestroyed()) return false;
    if (details.isMainFrame === false) return false;
    try {
        const parsed = new URL(requestingURL || details.securityOrigin || '');
        const editor = new URL(contents.getURL());
        return parsed.protocol === 'app:' && parsed.hostname === 'brickwright' &&
            !parsed.username && !parsed.password && !parsed.port &&
            (!parsed.pathname || parsed.pathname === '/editor.html') &&
            editor.protocol === 'app:' && editor.hostname === 'brickwright' && editor.pathname === '/editor.html';
    } catch (error) {
        return false;
    }
};

const createPermissionPolicy = ({getMainContents, confirm, requestOSMediaAccess, approved = new Set()}) => {
    const approvals = approved;
    const permissionKey = (contents, permission) => `${contents.id}:${permission}`;
    const permissionCheck = (contents, permission, requestingURL, details = {}) => {
        if (!isTrustedEditorRequest({contents, mainContents: getMainContents(), requestingURL, details})) return false;
        if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) return true;
        return USER_CONSENT_PERMISSIONS.has(permission) && approvals.has(permissionKey(contents, permission));
    };
    const permissionRequest = async (contents, permission, requestingURL, details = {}) => {
        if (!isTrustedEditorRequest({contents, mainContents: getMainContents(), requestingURL, details})) return false;
        if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) return true;
        if (!USER_CONSENT_PERMISSIONS.has(permission)) return false;
        const mediaTypes = permission === 'media' && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
        const invalidMediaTypes = mediaTypes.some(type => !['audio', 'video'].includes(type));
        if (permission === 'media' && (!mediaTypes.length || invalidMediaTypes)) {
            return false;
        }
        if (!await confirm({permission, mediaTypes})) return false;
        if (permission === 'media') {
            for (const mediaType of mediaTypes) {
                if (!await requestOSMediaAccess(mediaType)) return false;
            }
        }
        approvals.add(permissionKey(contents, permission));
        return true;
    };
    return {permissionCheck, permissionRequest};
};

module.exports = {createPermissionPolicy, isTrustedEditorRequest};
