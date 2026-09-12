/**
 * @file owners-tab.model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure arithmetic behind the admin Owners page: one decorated row per owner, the
 *   five figures the page prints, the filter counts behind the chips, and the search. No DOM, no
 *   i18n, no fetch, so the unit suite can hold every number on the screen.
 *
 *   EVERY VALUE COMES FROM THE LIST THE PAGE ALREADY FETCHES. GET /v1/admin/owners carries the
 *   name, the display name, the roles, the agents, the registration date, the deactivation stamp
 *   and the directory that manages the account. The figures, the filters and the doors are folds
 *   over that one read; the page asks the node for nothing else.
 *
 *   A DOOR IS DRAWN ONLY WHERE THE NODE WOULD ACCEPT THE ACT. The revoke route refuses a
 *   self-revoke and the last operator (src/routes/admin-monitoring.ts), and the deactivation
 *   service refuses deactivating yourself, so those doors are absent rather than refused after a
 *   press. Because the page is operator-only, the caller always holds the role: when one operator
 *   is left, that operator IS the caller, which is why the two refusals collapse into one visible
 *   rule — your own row carries no doors at all. The count is still read, because a session whose
 *   own name is unknown must not be offered the last revoke either.
 * @structure decorate · summarise · counts · search · FILTERS · PAGE
 * @usage imported by owners-tab.js; tested by test/unit/owners-tab-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Owners page in the poster face).
 */

/** The filter chips, in the order the page draws them. */
export const FILTERS = ['all', 'operators', 'agents', 'quiet', 'off'];

/** How many rows the list shows before "Show the rest". */
export const PAGE = 20;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const isOperator = (o) => Array.isArray(o.roles) && o.roles.includes('operator');
const agentCount = (o) => (Array.isArray(o.agents) ? o.agents.length : 0);

/**
 * One row per owner, with what the page draws and which doors it may draw.
 *
 * @param {Array<object>|undefined} owners the owners as GET /v1/admin/owners serves them
 * @param {string|null|undefined} me the signed-in owner's name, from the session
 * @returns {Array<object>} rows, oldest registration first
 */
export function decorate(owners, me) {
  const list = Array.isArray(owners) ? owners : [];
  const operators = list.filter(isOperator).length;

  return list
    .map((o) => {
      const operator = isOperator(o);
      const disabledAt = o.disabled_at || null;
      const you = !!me && o.name === me;
      const display = o.display_name && o.display_name !== o.name ? o.display_name : null;
      return {
        name: o.name,
        display,
        roles: Array.isArray(o.roles) ? o.roles : [],
        operator,
        you,
        agents: agentCount(o),
        createdAt: o.created_at || null,
        disabledAt,
        managedBy: o.managed_by || null,
        // The node refuses a self-revoke and the last operator; this draws neither.
        canRevoke: operator && !you && operators > 1,
        canGrant: !operator && !disabledAt,
        // The node refuses deactivating yourself.
        canDisable: !you && !disabledAt,
        canEnable: !you && !!disabledAt,
      };
    })
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/**
 * The five figures under the first section.
 *
 * @param {Array<object>} rows from decorate()
 * @param {number} [now] epoch ms, so the week window is testable
 */
export function summarise(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const withAgents = list.filter((r) => r.agents > 0).length;
  return {
    total: list.length,
    operators: list.filter((r) => r.operator).length,
    withAgents,
    quiet: list.length - withAgents,
    off: list.filter((r) => r.disabledAt).length,
    joinedWeek: list.filter((r) => {
      const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
      return Number.isFinite(t) && now - t <= WEEK_MS;
    }).length,
    // The operators, in the order the rows have, for the section that names them.
    operatorRows: list.filter((r) => r.operator),
  };
}

/** The number behind each filter chip. */
export function counts(rows) {
  const s = summarise(rows);
  return { all: s.total, operators: s.operators, agents: s.withAgents, quiet: s.quiet, off: s.off };
}

/**
 * The rows one filter and one search term leave.
 *
 * @param {Array<object>} rows from decorate()
 * @param {string} filter one of FILTERS; anything else is treated as 'all'
 * @param {string} query matched against the name and the display name, case-folded
 */
export function search(rows, filter, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query || '').trim().toLowerCase();
  const byFilter = list.filter((r) => {
    if (filter === 'operators') return r.operator;
    if (filter === 'agents') return r.agents > 0;
    if (filter === 'quiet') return r.agents === 0;
    if (filter === 'off') return !!r.disabledAt;
    return true;
  });
  if (!q) return byFilter;
  return byFilter.filter((r) =>
    r.name.toLowerCase().includes(q) || (r.display ? r.display.toLowerCase().includes(q) : false));
}
