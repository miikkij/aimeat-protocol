/**
 * @file test/unit/atelier-ops-input-shape.test.ts
 * @description The Atelier health wall and work queue name a misplaced input: rows passed as
 *   `items` (the list's and the grid's shape) instead of `data.items` give one console warning per
 *   block, on creation or on set(), and the block still reads only `data.items`. The right shape
 *   warns about nothing.
 * @version-history
 *   v1.0.0 - 2026-11-19 - Initial (a shared app showed the empty state for four versions).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let ops: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ops = await import('../../src/static/sdk-libs/atelier/ops.js');
});
afterAll(() => restore());
afterEach(() => vi.restoreAllMocks());

const ROWS = [{ id: 'a', label: 'A', title: 'A', tone: 'ok', state: 'done' }];

describe.each(['health', 'queue'])('%s input shape', (block) => {
  it('warns once when the rows come as `items`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = ops[block]({ target: document.createElement('div'), items: ROWS });
    b.set({ items: ROWS });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(block + ' takes its rows as { data: { items } }');
  });

  it('warns on set() with `items` when the spec was right', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = ops[block]({ target: document.createElement('div'), data: { items: ROWS } });
    b.set({ items: ROWS });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('set({ data: { items } })');
  });

  it('says nothing for `data.items`, and an empty or missing input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = ops[block]({ target: document.createElement('div'), data: { items: ROWS } });
    b.set({ data: { items: [] } });
    ops[block]({ target: document.createElement('div') });
    expect(warn).not.toHaveBeenCalled();
  });
});
