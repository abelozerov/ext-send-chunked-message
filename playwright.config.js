const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'test/e2e',
    testMatch: '*.test.js',
    globalSetup: './test/e2e/global-setup.js'
});
