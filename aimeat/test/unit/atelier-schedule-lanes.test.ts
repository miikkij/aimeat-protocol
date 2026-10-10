/**
 * @file test/unit/atelier-schedule-lanes.test.ts
 * @description The week schedule shows every booking, also the ones that overlap. Until atelier
 *   0.66.1 each booking was drawn at the full width of its day, so three programmes that started
 *   at 21:00 lay on top of each other and a person saw one of the three. The lane arithmetic is
 *   asserted on its own (planner-lanes.js) and on the MOUNTED schedule, because the defect was in
 *   what the screen showed and not in a number.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-schedule-lanes.test.ts
 * @version-history
 *   v1.0.0 - 2026-10-10 - Initial (atelier 0.66.1, overlapping bookings side by side).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let lanes: (events: Array<{ fromMin: number; toMin: number }>) => Array<{ lane: number; lanes: number }>;
let schedule: (spec: any) => any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  ({ scheduleLanes: lanes } = await import('../../src/static/sdk-libs/atelier/planner-lanes.js'));
  ({ schedule } = await import('../../src/static/sdk-libs/atelier/planner.js'));
});
afterEach(() => { doc.body.innerHTML = ''; });
afterAll(() => restore());

const at = (h: number, m = 0) => h * 60 + m;

describe('scheduleLanes', () => {
  it('gives a booking that overlaps nothing the whole width', () => {
    expect(lanes([{ fromMin: at(9), toMin: at(10) }, { fromMin: at(10), toMin: at(11) }]))
      .toEqual([{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
  });

  it('puts three bookings that start together in three lanes', () => {
    const out = lanes([
      { fromMin: at(21), toMin: at(23, 30) },
      { fromMin: at(21), toMin: at(22, 35) },
      { fromMin: at(21, 5), toMin: at(23, 15) },
    ]);
    expect(out.map((o) => o.lanes)).toEqual([3, 3, 3]);
    expect(out.map((o) => o.lane).sort()).toEqual([0, 1, 2]);
  });

  it('reuses a lane that has become free inside one group', () => {
    // A runs long; B and C follow each other beside it, so two lanes are enough.
    const out = lanes([
      { fromMin: at(9), toMin: at(12) },
      { fromMin: at(9), toMin: at(10) },
      { fromMin: at(10), toMin: at(11) },
    ]);
    expect(out.map((o) => o.lanes)).toEqual([2, 2, 2]);
    expect(out[1].lane).toBe(out[2].lane);
    expect(out[0].lane).not.toBe(out[1].lane);
  });

  it('keeps separate groups apart: an overlap in the morning does not narrow the evening', () => {
    const out = lanes([
      { fromMin: at(9), toMin: at(10) },
      { fromMin: at(9, 30), toMin: at(10, 30) },
      { fromMin: at(20), toMin: at(21) },
    ]);
    expect(out[0].lanes).toBe(2);
    expect(out[1].lanes).toBe(2);
    expect(out[2]).toEqual({ lane: 0, lanes: 1 });
  });

  it('answers in the order it was asked, whatever the order of the hours', () => {
    const out = lanes([
      { fromMin: at(21), toMin: at(22) },
      { fromMin: at(8), toMin: at(9) },
      { fromMin: at(21, 30), toMin: at(22, 30) },
    ]);
    expect(out[1]).toEqual({ lane: 0, lanes: 1 });
    expect(out[0].lanes).toBe(2);
    expect(out[2].lanes).toBe(2);
  });
});

describe('the mounted schedule', () => {
  function mount(events: any[]): any[] {
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    schedule({ target: host, data: { days: ['Sat', 'Sun'], events } });
    return Array.from(host.querySelectorAll('.ak-schedule__event'));
  }

  it('draws three programmes at 21:00 beside each other, each at a third of the day', () => {
    const blocks = mount([
      { day: 0, from: '21:00', to: '23:30', label: 'Die Hard 2' },
      { day: 0, from: '21:00', to: '22:35', label: 'Petolliset' },
      { day: 0, from: '21:05', to: '23:15', label: 'Vain elämää' },
    ]);
    expect(blocks.length).toBe(3);
    const starts = blocks.map((b: any) => b.style.insetInlineStart);
    expect(new Set(starts).size).toBe(3);
    for (const b of blocks) {
      expect(b.style.width).toContain('/ 3');
      expect(b.classList.contains('ak-schedule__event--shared')).toBe(true);
    }
  });

  it('leaves a booking alone on its hours exactly as it was: no inline width, no shared class', () => {
    const blocks = mount([
      { day: 0, from: '09:00', to: '10:00', label: 'Alone' },
      { day: 1, from: '09:00', to: '10:00', label: 'Another day' },
    ]);
    expect(blocks.length).toBe(2);
    for (const b of blocks) {
      expect(b.style.width || '').toBe('');
      expect(b.style.insetInlineStart || '').toBe('');
      expect(b.classList.contains('ak-schedule__event--shared')).toBe(false);
    }
  });
});
