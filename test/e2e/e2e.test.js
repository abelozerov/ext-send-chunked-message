const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extPath = path.join(__dirname, 'build');

test('chunked message round-trip works in a real Chrome extension', async () => {
    const browser = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
            `--disable-extensions-except=${extPath}`,
            `--load-extension=${extPath}`,
            '--no-first-run',
            '--disable-gpu'
        ]
    });

    try {
        // Wait for the extension service worker
        let sw;
        if (browser.serviceWorkers().length > 0) {
            sw = browser.serviceWorkers()[0];
        } else {
            sw = await browser.waitForEvent('serviceworker');
        }

        const page = await browser.newPage();
        await page.goto('https://example.com');

        // Find the tab ID via the service worker
        const tabId = await sw.evaluate(async url => {
            const tabs = await chrome.tabs.query({ url });
            return tabs[0]?.id;
        }, page.url());

        // Inject content script
        await sw.evaluate(async tabId => {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
        }, tabId);

        // Wait for the content script to signal completion via document.title
        await page.waitForFunction(
            () => document.title.startsWith('E2E_'),
            {},
            { timeout: 30000 }
        );

        const title = await page.title();
        expect(title).toMatch(/^E2E_OK:/);

        // Parse: E2E_OK:<responseLength>:<chunkCount>:<requestMessageLength>
        const parts = title.split(':');
        const responseLength = parseInt(parts[1], 10);
        const chunkCount = parseInt(parts[2], 10);
        const requestMessageLength = parseInt(parts[3], 10);

        // Background sent 'y'.repeat(1024 * 3) = 3072 chars
        expect(responseLength).toBe(3072);
        // JSON.stringify('x'.repeat(10240)) = 10242 chars, ceil(10242/1024) = 11 chunks
        expect(chunkCount).toBe(11);
        // Content script sent 'x'.repeat(1024 * 10) = 10240 chars
        expect(requestMessageLength).toBe(10240);
    } finally {
        await browser.close();
    }
});
