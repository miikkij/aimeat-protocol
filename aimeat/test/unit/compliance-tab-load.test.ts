/**
 * @file compliance-tab-load.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The compliance page reads its report one at a time.
 *
 *   The report of a large node takes longer than the events that ask for it are apart. Each event
 *   started a read beside the one still running, so the server built two reports at a time for as
 *   long as the page was open (measured 2026-11-26). The rule: a read that is running is not started
 *   again, and whatever was asked meanwhile is one more read with the newest arguments.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-tab-load.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { oneAtATime, SLOW_READ } from '../../public/views/admin/compliance-tab.load.js';

/** A run the test ends by hand, so "still running" is a state the test holds. */
function manualRun() {
  const started: number[] = [];
  const ends: Array<() => void> = [];
  let going = 0;
  let most = 0;
  const run = (days: number) => new Promise<void>((resolve) => {
    started.push(days);
    going++;
    most = Math.max(most, going);
    ends.push(() => { going--; resolve(); });
  });
  return { run, started, endNext: () => ends.shift()!(), most: () => most };
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('oneAtATime', () => {
  it('starts nothing while a run is going, then runs once more with the newest arguments', async () => {
    const m = manualRun();
    const load = oneAtATime(m.run);

    const first = load(30);
    // Five events and a period change arrive while the first read is still running.
    for (let i = 0; i < 5; i++) void load(30);
    const last = load(90);
    await tick();
    expect(m.started).toEqual([30]);

    m.endNext();
    await tick();
    expect(m.started, 'one more read, with the newest period').toEqual([30, 90]);

    m.endNext();
    await Promise.all([first, last]);
    expect(m.started).toEqual([30, 90]);
    expect(m.most(), 'never two at a time').toBe(1);
  });

  it('a call made while a run is going settles only after its own arguments ran', async () => {
    const m = manualRun();
    const load = oneAtATime(m.run);
    void load(30);
    let settled = false;
    const queued = load(7).then(() => { settled = true; });
    m.endNext();
    await tick();
    expect(settled, 'the 30-day read ended, the 7-day read is running').toBe(false);
    m.endNext();
    await queued;
    expect(m.started).toEqual([30, 7]);
  });

  it('runs again after it has gone idle, and after a run that threw', async () => {
    let n = 0;
    const load = oneAtATime(async (fail: boolean) => { n++; if (fail) throw new Error('read failed'); });
    await expect(load(true)).rejects.toThrow('read failed');
    await load(false);
    await load(false);
    expect(n).toBe(3);
  });
});

describe('SLOW_READ', () => {
  it('gives the whole-node reads two minutes and no second request after a timeout', () => {
    expect(SLOW_READ).toEqual({ timeoutMs: 120_000, retries: 0 });
  });
});
