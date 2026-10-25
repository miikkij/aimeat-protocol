/**
 * @file test/unit/app-playtest-bounds.test.ts
 * @description A lent headless browser is closed by a deadline whatever the page does, and the
 *   playtest is bounded: two at once on a node, thirty an hour per account, each refusal a sentence
 *   in ran:false (the playtest's contract). The playtest itself is e2e-app-playtest.ts.
 * @version-history
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: the deadline covers the launch; a late browser is closed;
 *     a hanging close does not hold the answer (stand-in launcher, no real browser).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, playtest browser hold).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import * as capture from '../../src/services/screenshot-capture.js';
import * as playtest from '../../src/services/app-playtest.js';

describe('withHeadlessContext closes the browser at its deadline', () => {
  it('a callback that never settles is answered by the deadline (or null with no browser)', async () => {
    const config = { port: 1, baseUrl: 'http://127.0.0.1:1' } as unknown as AimeatConfig;
    const started = Date.now();
    const run = capture.withHeadlessContext(config, { width: 100, height: 100 }, () => new Promise<never>(() => { /* never */ }), { deadlineMs: 1_500 });
    const outcome = await Promise.race([
      run.then((v) => ({ v }), (e: unknown) => ({ e })),
      new Promise((r) => setTimeout(() => r({ hung: true }), 30_000)),
    ]) as { v?: unknown; e?: unknown; hung?: boolean };
    expect(outcome.hung).toBeUndefined();
    if ('e' in outcome) {
      expect(outcome.e).toBeInstanceOf(capture.HeadlessDeadlineError);
      expect(Date.now() - started).toBeLessThan(30_000);
    } else {
      expect(outcome.v).toBeNull(); // no browser on this machine
    }
  }, 40_000);

  /** A stand-in browser: counts its closes; its close can be made to hang. */
  function fakeBrowser(opts: { closeHangs?: boolean } = {}) {
    const b = {
      closed: 0,
      close: () => { b.closed++; return opts.closeHangs ? new Promise<void>(() => { /* never */ }) : Promise.resolve(); },
      newContext: () => Promise.resolve({ route: () => Promise.resolve(), newPage: () => Promise.resolve({}) }),
    };
    return b;
  }
  const config = { port: 1, baseUrl: 'http://127.0.0.1:1' } as unknown as AimeatConfig;

  it('the deadline covers the launch: a launch slower than the deadline is answered by it, and the late browser is closed', async () => {
    const late = fakeBrowser();
    const started = Date.now();
    const run = capture.withHeadlessContext(config, { width: 100, height: 100 }, async () => 'done', {
      deadlineMs: 300,
      launch: () => new Promise((r) => setTimeout(() => r(late), 1_500)),
    });
    await expect(run).rejects.toBeInstanceOf(capture.HeadlessDeadlineError);
    expect(Date.now() - started).toBeLessThan(1_200);
    await new Promise((r) => setTimeout(r, 1_600));
    expect(late.closed).toBe(1);
  }, 10_000);

  it('a close that hangs does not hold the answer past the deadline', async () => {
    const b = fakeBrowser({ closeHangs: true });
    const started = Date.now();
    const out = await capture.withHeadlessContext(config, { width: 100, height: 100 }, async () => 'done', {
      deadlineMs: 400, launch: async () => b,
    });
    expect(out).toBe('done');
    expect(b.closed).toBe(1);
    expect(Date.now() - started).toBeLessThan(400 + capture.HEADLESS_CLOSE_GRACE_MS + 500);
  }, 10_000);

  it('designed use: a launch and work inside the deadline answer the work, and the browser is closed once', async () => {
    const b = fakeBrowser();
    const out = await capture.withHeadlessContext(config, { width: 100, height: 100 }, async () => 42, {
      deadlineMs: 5_000, launch: async () => b,
    });
    expect(out).toBe(42);
    expect(b.closed).toBe(1);
    expect(await capture.withHeadlessContext(config, { width: 1, height: 1 }, async () => 1, { launch: async () => null })).toBeNull();
  }, 10_000);
});

describe('takePlaytestSlot', () => {
  it('two at once; the third is told to wait, and a slot frees when one ends', () => {
    const a = playtest.takePlaytestSlot('slot-a');
    const b = playtest.takePlaytestSlot('slot-b');
    const c = playtest.takePlaytestSlot('slot-c');
    expect('release' in a && 'release' in b).toBe(true);
    expect('reason' in c && c.reason).toMatch(/other playtests/);
    if ('release' in a) a.release();
    const d = playtest.takePlaytestSlot('slot-c');
    expect('release' in d).toBe(true);
    if ('release' in b) b.release();
    if ('release' in d) d.release();
  });

  it('thirty an hour per account, then a sentence with the wait', () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const s = playtest.takePlaytestSlot('hourly', now + i);
      expect('release' in s).toBe(true);
      if ('release' in s) s.release();
    }
    const over = playtest.takePlaytestSlot('hourly', now + 31);
    expect('reason' in over && over.reason).toMatch(/30 playtests in the last hour/);
    const later = playtest.takePlaytestSlot('hourly', now + 3_600_001);
    expect('release' in later).toBe(true);
    if ('release' in later) later.release();
  });
});
