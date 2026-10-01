/**
 * @file public/views/appcat/sections/legal-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The legal pages and the audit log of the open app, read once and shared by the three
 *   places that show them: the "Legal pages" section, the "Audit log" section, and the masthead's hot
 *   chip "■ {n} legal pages still to write" (features F61, F330–F332, routes F216–F217). The old page
 *   loaded both when the detail opened and re-read both after a legal page was saved; this module does
 *   the same, keyed by the app ("owner/filename"), so the chip is right whichever of the three draws
 *   first. Nothing is blocked by a missing page; the chip is meant to be noticed.
 *
 *   For the shell (detail builder A): draw `<LegalChip d=${d} />` among the masthead's chips. It loads
 *   the state itself for the person's own published app, draws nothing until the state has answered
 *   or when nothing is missing, and a press scrolls to the Legal pages section (d.scrollTo('legal')).
 *   Import it relatively ('./sections/legal-state.js'), as the sections import it, so there is one copy.
 * @structure useLegal(d) · reloadLegal(owner, filename) · LegalChip({ d }) · KINDS
 * @usage import { LegalChip } from './sections/legal-state.js'; html`<${LegalChip} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-10-01 — The audit read keeps the archived years and the limit in force.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's legalOnOpen, loadAudit and legalChipHtml
 *     (js/legal.js) as one shared state (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Mark } from '/components/Mark.js';
import { apiGet } from '/js/api.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** The seven kinds of page, in the order the section lists them. */
export const KINDS = ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'cookies', 'support'];

/**
 * By "owner/filename": { legal: { state, data }, audit: { state, entries, total } }; state is
 * 'loading' | 'ready' | 'error'.
 */
const byRef = new Map();
/** How many places show each app's state now. */
const users = new Map();
const listeners = new Set();
function emit() { for (const fn of listeners) fn(); }

function path(owner, filename) { return '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename); }

/** Read (or read again) the legal state and the audit log of one app. */
export function reloadLegal(owner, filename) {
  const ref = owner + '/' + filename;
  // A new slot per read: an answer that comes after the app was closed or read again lands nowhere.
  const slot = { legal: { state: 'loading', data: null }, audit: { state: 'loading', entries: [], total: 0, archives: [], keep: null } };
  byRef.set(ref, slot);
  emit();
  const land = () => { if (byRef.get(ref) === slot) emit(); };
  apiGet(path(owner, filename) + '/legal')
    .then((res) => { slot.legal = { state: 'ready', data: (res && res.data) || null }; })
    // eslint-disable-next-line aimeat/no-silent-catch -- the 'error' state is said in words ("Could not read the legal pages")
    .catch(() => { slot.legal = { state: 'error', data: null }; })
    .then(land);
  apiGet(path(owner, filename) + '/audit')
    .then((res) => {
      const data = (res && res.data) || {};
      const entries = data.entries || [];
      slot.audit = {
        state: 'ready', entries, total: data.total || entries.length,
        // The archived years and the limit in force (services/app-audit-archive.ts).
        archives: data.archives || [], keep: data.keep || null,
      };
    })
    // eslint-disable-next-line aimeat/no-silent-catch -- the 'error' state is said in words ("Could not read the audit log")
    .catch(() => { slot.audit = { state: 'error', entries: [], total: 0, archives: [], keep: null }; })
    .then(land);
}

/**
 * The legal state and the audit log of the open app, read the first time a place asks for them.
 * Only the person's own published app has them; for any other app it answers null.
 */
export function useLegal(d) {
  const [, tick] = useState(0);
  useEffect(() => { const fn = () => tick((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  const owner = d ? d.owner : '';
  const filename = d ? d.filename : '';
  const own = !!(d && d.isOwnPublished && owner && filename);
  const ref = own ? owner + '/' + filename : '';
  useEffect(() => {
    if (!own) return undefined;
    if (!byRef.has(ref)) reloadLegal(owner, filename);
    users.set(ref, (users.get(ref) || 0) + 1);
    // When the last place showing this app goes (the detail closed), the state goes with it, so the
    // next opening reads it again, as the old page did on every opening.
    return () => {
      const left = (users.get(ref) || 1) - 1;
      if (left > 0) { users.set(ref, left); return; }
      users.delete(ref);
      byRef.delete(ref);
    };
  }, [own, ref, owner, filename]);
  return own ? (byRef.get(ref) || null) : null;
}

/** The masthead's hot chip: how many pages the app ought to have are still missing. */
export function LegalChip({ d }) {
  const st = useLegal(d);
  const r = st && st.legal.state === 'ready' && st.legal.data && st.legal.data.readiness;
  const n = r ? (r.missing || []).length : 0;
  if (!n) return null;
  return html`<${Mark} tone="coral" onClick=${() => d.scrollTo && d.scrollTo('legal')}>■ ${x('legal.chip', { n })}<//>`;
}
