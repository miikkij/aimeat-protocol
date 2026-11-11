/**
 * @file test/unit/build-atelier-finishing.test.ts
 * @description The Atelier build spec's "Finishing" section names two checks a builder skipped
 *   until an owner found the result: the console is read with the browser's own warnings while
 *   the app works, and an app that computes every frame is run with the browser's JavaScript
 *   compiler off. The checks that were there before stay word for word.
 * @usage cd aimeat && pnpm exec vitest run test/unit/build-atelier-finishing.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-test' } as unknown as AimeatConfig;
const body = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).body;
const finishing = body.slice(body.indexOf('## Finishing'));

describe('the Atelier build spec, Finishing', () => {
  it('keeps the checks it had', () => {
    expect(finishing).toContain('open the app at 390×844, 1280×900 and 1280×460 in BOTH themes');
    expect(finishing).toContain('`document.body.scrollWidth === document.documentElement.clientWidth` at every width');
    expect(finishing).toContain('no console errors');
  });

  it('has the console read with the browser\'s own warnings, while the app works', () => {
    expect(finishing).toContain('the browser\'s own warnings');
    expect(finishing).toContain('`Log.entryAdded`');
    expect(finishing).toMatch(/while the app does its work/);
  });

  it('has an app that computes every frame run with the JavaScript compiler off', () => {
    expect(finishing).toContain('`--js-flags=--jitless`');
    expect(finishing).toContain('no task over 50 ms');
    expect(finishing).toMatch(/graphics card/);
  });
});
