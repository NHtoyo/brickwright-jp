const packageJson = require('./package.json');

module.exports = {
    ...packageJson.jest,
    testEnvironment: 'jsdom',
    testEnvironmentOptions: {
        customExportConditions: ['node', 'node-addons']
    }
};
