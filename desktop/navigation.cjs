const {URL} = require('node:url');

const PACKAGER_ORIGIN = 'https://packager.turbowarp.org';
const APP_ORIGIN = 'app://brickwright';

const isPackagerImportURL = value => {
    try {
        const parsed = new URL(value);
        const entries = [...parsed.searchParams.entries()];
        return parsed.protocol === 'https:' &&
            parsed.hostname === 'packager.turbowarp.org' &&
            !parsed.username &&
            !parsed.password &&
            !parsed.port &&
            parsed.pathname === '/' &&
            !parsed.hash &&
            entries.length === 1 &&
            entries[0][0] === 'import_from' &&
            entries[0][1] === APP_ORIGIN;
    } catch (error) {
        return false;
    }
};

const isPackagerURL = value => {
    try {
        const parsed = new URL(value);
        return parsed.origin === PACKAGER_ORIGIN &&
            parsed.protocol === 'https:' &&
            parsed.hostname === 'packager.turbowarp.org' &&
            !parsed.username &&
            !parsed.password &&
            !parsed.port;
    } catch (error) {
        return false;
    }
};

module.exports = {isPackagerImportURL, isPackagerURL};
