/**
 * @file work-tab-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Work page, held to the numbers the page prints: which
 *   items are still waiting, how many morsels they hold, and which have outlived the deadline they
 *   were given. The escrow total is the one that matters — it is money somebody is currently short
 *   of — and the overdue count is a statement about the hourly sweep rather than about any job.
 *
 *   The cost shape is asserted on purpose: the route sends an OBJECT, and the page this replaces
 *   printed it with a number formatter.
 * @usage cd aimeat && pnpm exec vitest run test/unit/work-tab-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Work page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import {
  decorate, summarise, counts, search, FILTERS, PAGE, OPEN_STATUSES,
} from '../../public/views/admin/work-tab.model.js';

const NODE = 'aimeat-finland-001-genesis';
const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const HOURS = (n: number) => new Date(NOW + n * 3600_000).toISOString();
const DAYS = (n: number) => new Date(NOW - n * 86400_000).toISOString();

const cost = (total: number, held = total) => ({ base_price: total - 2, network_fee: 2, total, in_escrow: held });

const ITEMS = [
  // open, and two days past the deadline it was given
  { tracking_code: 'tc-1-aaaa', status: 'pending', action_id: 'summarise-inbox', requester_gaii: `claude#alice@${NODE}`, provider_gaii: `gpt#bob@${NODE}`, cost: cost(12), created_at: DAYS(3), updated_at: DAYS(3), ttl_expires_at: HOURS(-48) },
  // open, in time
  { tracking_code: 'tc-2-bbbb', status: 'pending', action_id: 'translate-page', requester_gaii: `claude#alice@${NODE}`, provider_gaii: `helper#carol@${NODE}`, cost: cost(8), created_at: DAYS(1), updated_at: DAYS(1), ttl_expires_at: HOURS(20) },
  // open, accepted, on another node
  { tracking_code: 'tc-3-cccc', status: 'in_progress', action_id: 'price-check', requester_gaii: `scout#dave@${NODE}`, provider_gaii: 'oracle#erin@aimeat-other-002', cost: cost(28), created_at: DAYS(0.5), updated_at: DAYS(0.2), ttl_expires_at: HOURS(2) },
  { tracking_code: 'tc-4-dddd', status: 'delivered', action_id: 'summarise-inbox', requester_gaii: `claude#alice@${NODE}`, provider_gaii: `gpt#bob@${NODE}`, cost: cost(12, 0), created_at: DAYS(2), updated_at: DAYS(2), ttl_expires_at: HOURS(-24) },
  { tracking_code: 'tc-5-eeee', status: 'failed', action_id: 'fetch-weather', requester_gaii: `bot#sandbox@${NODE}`, provider_gaii: `weather#frank@${NODE}`, cost: cost(4, 0), created_at: DAYS(6), updated_at: DAYS(6), ttl_expires_at: HOURS(-120) },
  { tracking_code: 'tc-6-ffff', status: 'expired', action_id: 'summarise-inbox', requester_gaii: `claude#alice@${NODE}`, provider_gaii: `gpt#bob@${NODE}`, cost: cost(12, 0), created_at: DAYS(7), updated_at: DAYS(7), ttl_expires_at: HOURS(-144) },
];

describe('what is still waiting', () => {
  const rows = decorate(ITEMS, { now: NOW, nodeId: NODE });
  const row = (tc: string) => rows.find(r => r.trackingCode === tc)!;

  it('counts the three open statuses as waiting and nothing else', () => {
    expect(OPEN_STATUSES).toEqual(['pending', 'accepted', 'in_progress']);
    // In reading order, which puts the overdue one first and then the newest of the rest.
    expect(rows.filter(r => r.open).map(r => r.trackingCode)).toEqual(['tc-1-aaaa', 'tc-3-cccc', 'tc-2-bbbb']);
  });

  it('calls an open item past its deadline overdue, and leaves a closed one alone', () => {
    expect(row('tc-1-aaaa')).toMatchObject({ open: true, overdue: true });
    expect(row('tc-2-bbbb')).toMatchObject({ open: true, overdue: false });
    // Every closed row here has a deadline in the past; none of them is the sweep's business.
    expect(rows.filter(r => !r.open).every(r => r.overdue === false)).toBe(true);
  });

  it('reads the escrow off an open row and zero off a closed one, whatever the record says', () => {
    expect(row('tc-1-aaaa').held).toBe(12);
    expect(row('tc-4-dddd').held).toBe(0);
    // A delivered row whose record still carried escrow must not be counted as holding it.
    const stale = decorate([{ ...ITEMS[3], cost: cost(12, 12) }], { now: NOW })[0];
    expect(stale.held).toBe(0);
  });

  it('reads a cost object, and survives a bare number or nothing at all', () => {
    expect(row('tc-3-cccc').total).toBe(28);
    expect(decorate([{ status: 'pending', cost: 7 }], { now: NOW })[0]).toMatchObject({ total: 7, held: 7 });
    expect(decorate([{ status: 'pending' }], { now: NOW })[0]).toMatchObject({ total: 0, held: 0 });
  });

  it('shortens an agent name, and marks the one that is not on this node', () => {
    expect(row('tc-3-cccc').requester).toEqual({ name: 'scout#dave', foreign: false });
    expect(row('tc-3-cccc').provider).toEqual({ name: 'oracle#erin', foreign: true });
  });

  it('puts the overdue first, then the rest of the open, then the newest', () => {
    expect(rows.map(r => r.trackingCode))
      .toEqual(['tc-1-aaaa', 'tc-3-cccc', 'tc-2-bbbb', 'tc-4-dddd', 'tc-5-eeee', 'tc-6-ffff']);
  });

  it('is empty rather than throwing when nothing has been read', () => {
    expect(decorate(undefined)).toEqual([]);
    expect(summarise(undefined)).toMatchObject({ total: 0, open: 0, held: 0, overdue: 0 });
  });
});

describe('the figures and the filters', () => {
  const rows = decorate(ITEMS, { now: NOW, nodeId: NODE });

  it('counts what the strip prints, and the held total is the open rows only', () => {
    const s = summarise(rows);
    expect(s).toMatchObject({ total: 6, open: 3, held: 48, overdue: 1 });
    expect(s.overdueRows.map(r => r.trackingCode)).toEqual(['tc-1-aaaa']);
  });

  it('counts every chip in the order the page draws them', () => {
    expect(counts(rows)).toEqual({ all: 6, open: 3, delivered: 1, failed: 1, expired: 1 });
    expect(FILTERS).toEqual(['all', 'open', 'delivered', 'failed', 'expired']);
    expect(PAGE).toBe(25);
  });

  it('leaves the rows each chip names', () => {
    expect(search(rows, 'open', '').length).toBe(3);
    expect(search(rows, 'expired', '').map(r => r.trackingCode)).toEqual(['tc-6-ffff']);
    expect(search(rows, 'all', '').length).toBe(6);
  });

  it('finds an item by its code, its action, and either agent', () => {
    expect(search(rows, 'all', 'tc-5').map(r => r.trackingCode)).toEqual(['tc-5-eeee']);
    expect(search(rows, 'all', 'weather').map(r => r.trackingCode)).toEqual(['tc-5-eeee']);
    expect(search(rows, 'all', 'oracle').map(r => r.trackingCode)).toEqual(['tc-3-cccc']);
    expect(search(rows, 'all', 'alice').length).toBe(4);
    expect(search(rows, 'all', 'nobody')).toEqual([]);
  });

  it('applies the chip before the term', () => {
    // alice asked for four of the six; two of those four are still open.
    expect(search(rows, 'all', 'alice').length).toBe(4);
    expect(search(rows, 'open', 'alice').map(r => r.trackingCode)).toEqual(['tc-1-aaaa', 'tc-2-bbbb']);
    expect(search(rows, 'expired', 'alice').map(r => r.trackingCode)).toEqual(['tc-6-ffff']);
  });
});
