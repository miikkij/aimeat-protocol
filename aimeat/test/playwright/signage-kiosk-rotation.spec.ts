/**
 * @file signage-kiosk-rotation.spec.ts
 * @description The Signage Kiosk polls its screen document every 30 s. These tests pin that the poll
 *   leaves the rotation alone when nothing changed (every view gets its turn), and still re-renders
 *   when the document changes or a view's active window opens. The kiosk under test is the copy the
 *   digital-signage package installs; the screen document is served by a route handler and time runs
 *   on Playwright's fake clock, so no node and no real waiting is needed.
 * @usage cd aimeat && pnpm exec playwright test test/playwright/signage-kiosk-rotation.spec.ts
 * @version-history
 *   v1.0.0 — 2026-09-14 — The poll no longer restarts the rotation (wish-signage-kiosk-pollaus-…).
 */

import { test, expect, type Page } from '@playwright/test';
import { digitalSignagePackage } from '../../src/data/digital-signage-package.js';

const ORIGIN = 'http://kiosk.test';
const KIOSK_HTML = digitalSignagePackage().components.find((c) => c.id === 'app-kiosk')!.content as string;

type View = { type: 'html'; content: string; activeFrom?: string };

function htmlView(n: number, extra: Partial<View> = {}): View {
    return { type: 'html', content: `<div data-view="${n}">View ${n}</div>`, ...extra };
}

/** Serve the kiosk page and a screen document whose payload `screen()` returns at request time. */
async function openKiosk(page: Page, screen: () => object): Promise<void> {
    await page.clock.install({ time: new Date('2026-09-14T12:00:00Z') });
    await page.route(`${ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes('/workspace/public/document')) {
            const markdown = '```json\n' + JSON.stringify(screen()) + '\n```';
            await route.fulfill({ json: { data: { document: { markdown } } } });
        } else {
            await route.fulfill({ contentType: 'text/html', body: KIOSK_HTML });
        }
    });
    await page.goto(`${ORIGIN}/?org=o&ws=w&screen=s`);
    await expect(page.locator('.view.on')).toHaveCount(1);
}

/** Advance the fake clock one second at a time and collect which views were on screen. */
async function watch(page: Page, seconds: number): Promise<Set<string>> {
    const seen = new Set<string>();
    for (let s = 0; s < seconds; s++) {
        const on = await page.locator('.view.on [data-view]').getAttribute('data-view');
        if (on) seen.add(on);
        await page.clock.runFor(1000);
        await page.waitForTimeout(5); // let a poll's fetch resolve before the next reading
    }
    return seen;
}

test('every view gets its turn although the poll (30 s) is shorter than a full round (60 s)', async ({ page }) => {
    const payload = { config: { rotationIntervalSec: 10 }, views: [1, 2, 3, 4, 5, 6].map((n) => htmlView(n)) };
    await openKiosk(page, () => payload);
    const seen = await watch(page, 90);
    expect([...seen].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
});

test('a changed screen document still reaches the stage at the next poll', async ({ page }) => {
    let payload = { config: { rotationIntervalSec: 10 }, views: [htmlView(1), htmlView(2)] };
    await openKiosk(page, () => payload);
    await expect(page.locator('[data-view="3"]')).toHaveCount(0);
    payload = { config: { rotationIntervalSec: 10 }, views: [htmlView(1), htmlView(2), htmlView(3)] };
    await page.clock.runFor(31_000);
    await expect(page.locator('[data-view="3"]')).toHaveCount(1);
});

test('a view whose active window opens appears at the next poll without a document change', async ({ page }) => {
    const payload = {
        config: { rotationIntervalSec: 10 },
        views: [htmlView(1), htmlView(2, { activeFrom: '2026-09-14T12:00:40Z' })],
    };
    await openKiosk(page, () => payload);
    await expect(page.locator('[data-view="2"]')).toHaveCount(0);
    await page.clock.runFor(61_000);
    await expect(page.locator('[data-view="2"]')).toHaveCount(1);
});
