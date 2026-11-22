'use strict';

module.exports = async context => {
    if (process.env.BRICKWRIGHT_BUILD_TYPE !== 'release') return;
    const required = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
    const missing = required.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`macOS release notarization is missing secrets: ${missing.join(', ')}`);
    const {notarize} = require('@electron/notarize');
    const path = require('node:path');
    const appName = `${context.packager.appInfo.productFilename}.app`;
    await notarize({
        appPath: path.join(context.appOutDir, appName),
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
    });
};
