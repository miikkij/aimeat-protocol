/**
 * @file public/views/profile/landing-page.helpers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Time, tab-navigation, and number/byte format helpers. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/landing-page.js (max-file-lines)
 */
import { date as fmtDate, time as fmtTime, dateTime as fmtDateTime, sameDay, ago } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';

/* ───── Small time helpers (reuse the organisms rel-time keys) ───── */

export function fmtDateLocal(s) {
  return fmtDate(s);
}
/**
 * Relative time for a Home card. This was a byte-for-byte copy of the organisms list's helper,
 * down to the same keys and the same week-long horizon, kept in step by hand. One of them is it now.
 */
export function relTime(s) {
  return ago(s, { horizonDays: 7 });
}
export function fmtClock(s) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return sameDay(d, new Date())
    ? fmtTime(d, { hour: '2-digit', minute: '2-digit' })
    : fmtDateTime(d, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ───── Home-card navigation: prime the organisms tab's sessionStorage, then open it ───── */

export function openProfileTab(tabId) {
  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
}
export function gotoWorkspace(orgId, wsId, wsTab) {
  try {
    sessionStorage.setItem('aimeat.ws.openId', orgId);
    sessionStorage.setItem('aimeat.ws.openWs', wsId);
    if (wsTab) sessionStorage.setItem(`aimeat.ws.${orgId}.${wsId}.tab`, wsTab);
  // eslint-disable-next-line aimeat/no-silent-catch -- noop
  } catch { /* noop */ }
  openProfileTab('organisms');
}
export function gotoOrganism(orgId, homeTab) {
  try {
    sessionStorage.setItem('aimeat.ws.openId', orgId);
    sessionStorage.removeItem('aimeat.ws.openWs');
    if (homeTab) sessionStorage.setItem('aimeat.org.tab', homeTab);
  // eslint-disable-next-line aimeat/no-silent-catch -- noop
  } catch { /* noop */ }
  openProfileTab('organisms');
}
export function gotoOrganismsList() {
  try { sessionStorage.removeItem('aimeat.ws.openId'); sessionStorage.removeItem('aimeat.ws.openWs'); } catch { /* noop */ }   // eslint-disable-line aimeat/no-silent-catch -- noop
  openProfileTab('organisms');
}

/* Keep the URL + browser history in step with the open profile tab, so the browser
 * Back button moves between tabs (and Home) INSIDE the profile instead of leaving
 * /v1/profile entirely. Tab navigation is internal (no SPA route change), so without
 * this a Back press popped straight out of the profile. `replace` is used on mount to
 * reflect a restored tab without adding a spurious entry. */
export function syncTabHistory(tabId, replace) {
  try {
    const path = tabId ? `/v1/profile?tab=${encodeURIComponent(tabId)}` : '/v1/profile';
    const state = { aimeatTab: tabId || null };
    if (replace) history.replaceState(state, '', path);
    else history.pushState(state, '', path);
  } catch (err) { swallowed('landing-page.helpers: syncTabHistory', err); }
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function fmtUsd(n) {
  const v = Number(n) || 0;
  return '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2));
}
export function fmtCompact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}
