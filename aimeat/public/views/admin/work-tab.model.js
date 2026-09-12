/**
 * @file work-tab.model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Work page: which items are still waiting, how many
 *   morsels they hold, which have outlived the deadline they were given, and the filters. No DOM, no
 *   i18n, no fetch, so the unit suite can hold every number on the screen.
 *
 *   THE MORSELS ARE HELD, NOT SPENT. A work item takes its full cost out of the requester's balance
 *   when it is asked and gives it back only on delivery or on expiry (services/morsel.ts). So the sum
 *   over the OPEN items is money somebody is currently short of, and it is the figure this page
 *   exists to print.
 *
 *   AN OVERDUE ITEM IS A FACT ABOUT THE SWEEP, NOT ABOUT THE JOB. runWorkTimeoutJob expires anything
 *   open past its ttl and returns the escrow, hourly. An open item older than its deadline therefore
 *   means that job has not run, and the morsels it holds are stuck with it.
 * @structure STATUS_GROUPS · decorate · summarise · counts · search · FILTERS · PAGE
 * @usage imported by work-tab.js; tested by test/unit/work-tab-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Work page in the poster face).
 */

/** The statuses where somebody is still waiting on somebody. The escrow is held in exactly these. */
export const OPEN_STATUSES = ['pending', 'accepted', 'in_progress'];

/** The filter chips, in the order the page draws them. */
export const FILTERS = ['all', 'open', 'delivered', 'failed', 'expired'];

/** How many rows the list shows before "Show the rest". */
export const PAGE = 25;

const isOpen = (status) => OPEN_STATUSES.includes(status);

/** The cost the row prints. The route sends the whole object; a bare number is read as the total. */
function costOf(raw) {
  if (typeof raw === 'number') return { total: raw, held: raw };
  if (!raw || typeof raw !== 'object') return { total: 0, held: 0 };
  const total = Number(raw.total ?? 0);
  // `in_escrow` over the wire, `inEscrow` from the record: read both rather than print a wrong zero.
  const held = Number(raw.in_escrow ?? raw.inEscrow ?? total);
  return { total: Number.isFinite(total) ? total : 0, held: Number.isFinite(held) ? held : 0 };
}

/** "claude#alice@aimeat-finland-001-genesis" reads as "claude#alice" unless the node is elsewhere. */
function shortGaii(gaii, nodeId) {
  const s = String(gaii || '');
  const at = s.lastIndexOf('@');
  if (at < 0) return { name: s, foreign: false };
  const node = s.slice(at + 1);
  return { name: s.slice(0, at), foreign: !!nodeId && node !== nodeId };
}

/**
 * One row per work item, with what the page draws and what it counts.
 *
 * @param {Array<object>|undefined} items as GET /v1/admin/work serves them
 * @param {{ now?: number, nodeId?: string }} [opts] the clock and this node's id, both testable
 * @returns {Array<object>} rows, the overdue ones first, then the open ones, then newest first
 */
export function decorate(items, opts = {}) {
  const now = opts.now ?? Date.now();
  const list = Array.isArray(items) ? items : [];

  return list
    .map((w) => {
      const status = String(w.status || '');
      const open = isOpen(status);
      const cost = costOf(w.cost);
      const deadline = w.ttl_expires_at ? Date.parse(w.ttl_expires_at) : NaN;
      const hasDeadline = Number.isFinite(deadline);
      return {
        trackingCode: String(w.tracking_code || ''),
        status,
        open,
        action: String(w.action_id || ''),
        requester: shortGaii(w.requester_gaii, opts.nodeId),
        provider: shortGaii(w.provider_gaii, opts.nodeId),
        total: cost.total,
        // Only an open item holds anything; a closed one's escrow was paid out or returned.
        held: open ? cost.held : 0,
        createdAt: w.created_at || null,
        updatedAt: w.updated_at || null,
        deadline: hasDeadline ? deadline : null,
        // Open, and the deadline has passed: the sweep that should have ended this did not run.
        overdue: open && hasDeadline && deadline < now,
        msLeft: open && hasDeadline ? deadline - now : null,
      };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.open !== b.open) return a.open ? -1 : 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

/** The four figures under the first section. */
export function summarise(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const open = list.filter(r => r.open);
  return {
    total: list.length,
    open: open.length,
    held: open.reduce((n, r) => n + r.held, 0),
    overdue: list.filter(r => r.overdue).length,
    openRows: open,
    overdueRows: list.filter(r => r.overdue),
  };
}

/** The number behind each filter chip. */
export function counts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    all: list.length,
    open: list.filter(r => r.open).length,
    delivered: list.filter(r => r.status === 'delivered').length,
    failed: list.filter(r => r.status === 'failed').length,
    expired: list.filter(r => r.status === 'expired').length,
  };
}

/**
 * The rows one filter and one search term leave. The term matches the tracking code, the action and
 * either agent's name, because an operator arriving here has one of those three.
 */
export function search(rows, filter, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query || '').trim().toLowerCase();
  const byFilter = list.filter((r) => {
    if (filter === 'open') return r.open;
    if (filter === 'delivered' || filter === 'failed' || filter === 'expired') return r.status === filter;
    return true;
  });
  if (!q) return byFilter;
  return byFilter.filter(r =>
    r.trackingCode.toLowerCase().includes(q)
    || r.action.toLowerCase().includes(q)
    || r.requester.name.toLowerCase().includes(q)
    || r.provider.name.toLowerCase().includes(q));
}
