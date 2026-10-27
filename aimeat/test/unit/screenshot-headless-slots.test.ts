/**
 * @file test/unit/screenshot-headless-slots.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On-demand app screenshots (POST /v1/apps/:owner/:filename/screenshot/capture and the
 *   MCP app_manage screenshot action) launched one headless browser per call with no node-wide count,
 *   and the render had no overall deadline (secaudit2026oct26,
 *   screenshot-capture:on-demand-render-no-node-slot-or-deadline). Now at most
 *   ON_DEMAND_HEADLESS_AT_ONCE run at once on the node, a call past that is answered 503
 *   HEADLESS_BUSY with a sentence an agent acts on, and a render that does not finish is closed by the
 *   deadline. The usage half: a single capture still stores a thumbnail, and the busy answer takes
 *   none of the owner's hourly allowance.
 * @usage cd aimeat && pnpm exec vitest run test/unit/screenshot-headless-slots.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { captureAppScreenshot, type HeadlessBrowser } from '../../src/services/screenshot-capture.js';

const config = {
  baseUrl: 'http://127.0.0.1:1', port: 1, nodeId: 'n', screenshotOnDemandPerHour: 20, screenshotSettleMs: 0,
} as unknown as AimeatConfig;

const stored: string[] = [];
const storage = {
  getAppByOwnerName: async (owner: string, filename: string) => ({
    ownerName: owner, ownerGaii: `${owner}@n`, filename, versionNumber: 1, data: Buffer.from('<h1>x</h1>'), mimeType: 'text/html', manifest: {},
  }),
  createStorageFile: async (f: { key: string }) => { stored.push(f.key); return f; },
} as unknown as Storage;

/** A browser whose context never comes until `release` is called, then fails. */
function hangingLauncher() {
  const state = { launches: 0, closes: 0, release: [] as Array<() => void> };
  const launch = async (): Promise<HeadlessBrowser> => {
    state.launches++;
    return {
      newContext: () => new Promise((_, reject) => state.release.push(() => reject(new Error('released')))),
      close: async () => { state.closes++; },
    };
  };
  return { state, launch };
}

/** A browser that renders: its page answers every call the renderer makes. */
function workingLauncher(): () => Promise<HeadlessBrowser> {
  const page = {
    route: async () => undefined, unroute: async () => undefined, goto: async () => undefined,
    waitForTimeout: async () => undefined, screenshot: async () => Buffer.from('jpeg-bytes'), close: async () => undefined,
  };
  const ctx = { newPage: async () => page, route: async () => undefined, close: async () => undefined };
  return async () => ({ newContext: async () => ctx, close: async () => undefined });
}

const settle = () => new Promise(r => setTimeout(r, 50));

describe('on-demand screenshots share a node-wide headless slot and a deadline', () => {
  it('six captures at once launch at most the node\'s slot count; the rest are told the node is busy', async () => {
    const { state, launch } = hangingLauncher();
    const runs = Array.from({ length: 6 }, (_, i) =>
      captureAppScreenshot(config, storage, { ownerName: `slot${i}`, filename: 'a.html' }, { launch }));
    await settle();
    expect(state.launches).toBeLessThanOrEqual(4);
    state.release.forEach(f => f());
    const out = await Promise.all(runs);
    const busy = out.filter(r => !r.ok && r.code === 'HEADLESS_BUSY');
    expect(busy.length).toBe(6 - state.launches);
    expect(busy.every(r => !r.ok && r.status === 503 && /try again/i.test(r.message))).toBe(true);
  });

  it('a render that never finishes is closed by the deadline and answered', async () => {
    const { state, launch } = hangingLauncher();
    const t0 = Date.now();
    const r = await captureAppScreenshot(config, storage, { ownerName: 'deadline1', filename: 'a.html' }, { launch, deadlineMs: 100 });
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(state.closes).toBe(1);
    state.release.forEach(f => f());
  }, 10_000);

  it('a single capture still stores the thumbnail', async () => {
    const r = await captureAppScreenshot(config, storage, { ownerName: 'single1', filename: 'shot.html' }, { launch: workingLauncher() });
    expect(r).toMatchObject({ ok: true });
    expect(stored).toContain('apps/screenshots/shot.html');
  });
});
