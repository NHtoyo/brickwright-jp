'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const APP_SCHEME = 'app:';
const APP_HOST = 'brickwright';
const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.cjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.ico', 'image/x-icon'],
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.ogg', 'audio/ogg'],
    ['.wasm', 'application/wasm'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.ttf', 'font/ttf'],
    ['.otf', 'font/otf'],
    ['.xml', 'application/xml; charset=utf-8'],
    ['.txt', 'text/plain; charset=utf-8']
]);

const isInside = (root, candidate) => {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const resolveAppAsset = async (assetRoot, requestUrl) => {
    let parsed;
    try {
        parsed = new URL(requestUrl);
    } catch (error) {
        return null;
    }
    if (parsed.protocol !== APP_SCHEME || parsed.hostname !== APP_HOST || parsed.username || parsed.password || parsed.port) {
        return null;
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(parsed.pathname);
    } catch (error) {
        return null;
    }
    if (decodedPath.includes('\0') || decodedPath.includes('\\')) return null;

    const root = path.resolve(assetRoot);
    const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
    const candidate = path.resolve(root, relativePath);
    if (!isInside(root, candidate)) return null;

    try {
        const [realRoot, realCandidate, stat] = await Promise.all([
            fs.realpath(root),
            fs.realpath(candidate),
            fs.stat(candidate)
        ]);
        if (!isInside(realRoot, realCandidate) || !stat.isFile()) return null;
        return {
            filePath: realCandidate,
            mimeType: MIME_TYPES.get(path.extname(realCandidate).toLowerCase()) || 'application/octet-stream'
        };
    } catch (error) {
        return null;
    }
};

const createAppProtocolHandler = ({assetRoot, net, ResponseClass = Response}) => async request => {
    const asset = await resolveAppAsset(assetRoot, request.url);
    if (!asset) return new ResponseClass('Not found', {status: 404});
    try {
        const response = await net.fetch(pathToFileURL(asset.filePath).toString());
        if (!response.ok) return new ResponseClass('Not found', {status: 404});
        const headers = new Headers(response.headers);
        headers.set('Content-Type', asset.mimeType);
        headers.set('X-Content-Type-Options', 'nosniff');
        return new ResponseClass(response.body, {status: response.status, headers});
    } catch (error) {
        return new ResponseClass('Not found', {status: 404});
    }
};

module.exports = {APP_HOST, APP_SCHEME, createAppProtocolHandler, resolveAppAsset};
