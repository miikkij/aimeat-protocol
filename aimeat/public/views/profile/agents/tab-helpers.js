/**
 * @file public/views/profile/agents/tab-helpers.js
 * @description Per-browser (localStorage) helpers for the agents tab: agent ordering,
 *   custom-group collapse state, per-tab "last seen" change tracking, effective ordering,
 *   and pop-out. Extracted from ../agents-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tab.js (max-file-lines)
 */

// ── Per-browser agent ordering (localStorage) ──
// The agent bar order is not stored server-side; it is a per-browser
// preference keyed by owner. Stored as a plain array of agent names.
const ORDER_KEY_PREFIX = 'aimeat-agent-order:';
export function loadAgentOrder(owner) {
  if (!owner) return [];
  try { return JSON.parse(localStorage.getItem(ORDER_KEY_PREFIX + owner) || '[]') || []; }
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  catch { return []; }
}
export function saveAgentOrder(owner, names) {
  if (!owner) return;
  try { localStorage.setItem(ORDER_KEY_PREFIX + owner, JSON.stringify(names)); }
  // eslint-disable-next-line aimeat/no-silent-catch -- ignore quota/availability errors
  catch { /* ignore quota/availability errors */ }
}

// ── Custom agent groups (server-side) + per-browser collapse state ──
// The group DEFINITIONS (which groups exist, which agent is in which) live in the
// owner's AIMEAT memory so they follow the owner across devices — see
// getAgentGroups/saveAgentGroups. The collapsed/expanded toggle is purely a
// per-device view preference, so (like the agent ordering above) it lives in
// localStorage, keyed by owner. Stored as an array of collapsed group ids; the
// special id below tracks the "Ungrouped" section.
export const UNGROUPED_ID = '__ungrouped__';
const COLLAPSE_KEY_PREFIX = 'aimeat-agent-groups-collapsed:';
export function loadCollapsedGroups(owner) {
  if (!owner) return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY_PREFIX + owner) || '[]') || []); }
  catch { return new Set(); }
}
export function saveCollapsedGroups(owner, set) {
  if (!owner) return;
  try { localStorage.setItem(COLLAPSE_KEY_PREFIX + owner, JSON.stringify([...set])); }
  // eslint-disable-next-line aimeat/no-silent-catch -- ignore quota/availability errors
  catch { /* ignore quota/availability errors */ }
}

// ── Per-browser "last seen per tab" state (localStorage) ──
// Drives the per-agent change badges: how many tasks / messages / memory
// entries have updated since the owner last opened that tab. Per-browser, keyed
// by owner — same rationale as the agent ordering above (no server round-trip;
// "what's new since I looked HERE" is inherently a per-device affordance).
// Shape: { [agentName]: { tasks: iso, messages: iso, memory: iso } }
// The three keys map to the Tasks, Messages and Memory (data-access) tabs.
const SEEN_KEY_PREFIX = 'aimeat-agent-seen:';
export function loadSeen(owner) {
  if (!owner) return {};
  try { return JSON.parse(localStorage.getItem(SEEN_KEY_PREFIX + owner) || '{}') || {}; }
  // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  catch { return {}; }
}
export function saveSeen(owner, data) {
  if (!owner) return;
  try { localStorage.setItem(SEEN_KEY_PREFIX + owner, JSON.stringify(data)); }
  // eslint-disable-next-line aimeat/no-silent-catch -- ignore quota/availability errors
  catch { /* ignore quota/availability errors */ }
}
// Stamp the given agent+tab as seen-now and persist. Read-modify-write against
// the freshest localStorage so a concurrent loadData() seed doesn't clobber it.
export function markTabSeen(owner, agentName, tab) {
  if (!owner || !agentName || !tab) return;
  const seen = loadSeen(owner);
  (seen[agentName] ||= {})[tab] = new Date().toISOString();
  saveSeen(owner, seen);
}
// Effective ordering: agents named in the saved order first (in that order),
// then any agents not yet ordered (e.g. newly connected) in their API order.
export function effectiveOrderedNames(agents, order) {
  const existing = new Set(agents.map(a => a.name));
  const head = order.filter(n => existing.has(n));
  const headSet = new Set(head);
  const tail = agents.map(a => a.name).filter(n => !headSet.has(n));
  return [...head, ...tail];
}

// Open one agent in its own window. One window per agent name so re-clicking
// focuses the existing window instead of spawning duplicates.
export function popOutAgent(agent) {
  const url = '/v1/profile?solo=' + encodeURIComponent(agent.name);
  // ~900px so the agent card gets the same usable width as in the list view
  // (≈762px) and the full tab bar fits without horizontal scrolling.
  window.open(url, 'aimeat-agent-' + agent.name, 'width=900,height=950');
}
