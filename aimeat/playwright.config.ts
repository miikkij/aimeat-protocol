import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/playwright',
    timeout: 30_000,
    retries: 0,
    workers: 1, // serial — tests share server state
    use: {
        baseURL: 'http://localhost:40251',
        headless: true,
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
});
