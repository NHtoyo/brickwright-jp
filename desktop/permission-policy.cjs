const {URL} = require('node:url');

const SAFE_AUTOMATIC_PERMISSIONS = new Set([
    'bluetooth', 'bluetooth-scanning', 'clipboard-sanitized-write', 'usb'
]);
const USER_CONSENT_PERMISSIONS = new Set(['media', 'clipboard-read']);
const MEDIA_TYPES = new Set(['audio', 'video']);

const getMediaTypes = details => {
    if (!Array.isArray(details.mediaTypes) || !details.mediaTypes.length) return null;
    const mediaTypes = [...new Set(details.mediaTypes)];
    return mediaTypes.every(type => MEDIA_TYPES.has(type)) ? mediaTypes : null;
};

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
    const permissionKey = (contents, permission, mediaType = '') =>
        `${contents.id}:${permission}${mediaType ? `:${mediaType}` : ''}`;
    const permissionCheck = (contents, permission, requestingURL, details = {}) => {
        if (!isTrustedEditorRequest({contents, mainContents: getMainContents(), requestingURL, details})) return false;
        if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) return true;
        if (permission === 'media') {
            const mediaTypes = getMediaTypes(details);
            return Boolean(mediaTypes && mediaTypes.every(mediaType =>
                approvals.has(permissionKey(contents, permission, mediaType))
            ));
        }
        return USER_CONSENT_PERMISSIONS.has(permission) && approvals.has(permissionKey(contents, permission));
    };
    const permissionRequest = async (contents, permission, requestingURL, details = {}) => {
        if (!isTrustedEditorRequest({contents, mainContents: getMainContents(), requestingURL, details})) return false;
        if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) return true;
        if (!USER_CONSENT_PERMISSIONS.has(permission)) return false;
        if (permission === 'media') {
            const mediaTypes = getMediaTypes(details);
            if (!mediaTypes) return false;
            for (const mediaType of mediaTypes) {
                const key = permissionKey(contents, permission, mediaType);
                if (approvals.has(key)) continue;
                if (!await confirm({permission, mediaTypes: [mediaType], mediaType})) return false;
                if (!await requestOSMediaAccess(mediaType)) return false;
                approvals.add(key);
            }
            return true;
        }
        if (!await confirm({permission, mediaTypes: []})) return false;
        approvals.add(permissionKey(contents, permission));
        return true;
    };
    return {permissionCheck, permissionRequest};
};

module.exports = {createPermissionPolicy, isTrustedEditorRequest};
