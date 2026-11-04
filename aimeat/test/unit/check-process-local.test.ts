/**
 * @file test/unit/check-process-local.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The process-local ratchet (scripts/check-process-local.ts) finds module-level Maps,
 *   Sets and lets and every setInterval, skips constant lookup tables, sees the marker, refuses a count
 *   above the baseline and a baseline above the code. A standby or second process sees none of a
 *   process's memory, and the codebase analysis of 2026-11-03 found nine pieces of per-process state
 *   that no list named.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1).
 */
import { describe, it, expect } from 'vitest';
import { itemsOf, counts, compare, type Baseline } from '../../scripts/check-process-local.js';

const SOURCE = `
const TABLE = new Set(['a', 'b']);
const PAIRS = new Map([['a', 1], ['b', 2]]);
const cache = new Map<string, number>();
// process-local: each process counts its own
let hits = 0;
export function start() { setInterval(() => { hits++; }, 1000); }
`;

describe('check-process-local', () => {
  const items = itemsOf('src/services/x.ts', SOURCE);

  it('finds runtime state and timers and skips constant tables', () => {
    expect(items.map((i) => `${i.kind}:${i.name}`).sort()).toEqual(['interval:start', 'let:hits', 'map:cache']);
    expect(items.find((i) => i.name === 'hits')?.marked).toBe(true);
    expect(items.find((i) => i.name === 'cache')?.marked).toBe(false);
  });

  it('refuses a new item and a baseline above the code, and passes a matching baseline', () => {
    const found = counts(items);
    const empty: Baseline = { note: '', entries: {} };
    expect(compare(found, empty).added).toHaveLength(3);
    const exact: Baseline = { note: '', entries: Object.fromEntries([...found].map(([k, v]) => [k, { count: v.length, reason: 'DEBT' }])) };
    expect(compare(found, exact)).toEqual({ added: [], fallen: [] });
    const stale: Baseline = { note: '', entries: { ...exact.entries, 'src/services/gone.ts :: map :: old': { count: 1, reason: 'DEBT' } } };
    expect(compare(found, stale).fallen).toHaveLength(1);
  });
});
