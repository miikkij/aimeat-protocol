/**
 * @file public/views/appcat/sections/needs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Needs" (features F319): the cortexes this app loads and the
 *   extensions it calls, read from its published source, one tag each ("name" or "name@pinned"),
 *   from the listing row's `requires`. Shown for any published app. The shell draws the chapter line
 *   and the headline from `meta`; this is the body.
 * @structure meta · NeedsSection({ d })
 * @usage const mod = await import('./sections/needs.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity (sections-a): the chapter's lead, the chips as the old Needs chips
 *     (Mark tone "need" in Marks spread), the small quiet line when there is nothing.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's requiresHtml (js/detail.js) on components
 *     (appcat detail builder B).
 */
import { h } from 'preact';
import htm from 'htm';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

export const meta = { id: 'needs', title: 'detail.requires', show: (d) => !!(d && d.app) };

/** "name" or "name@pinned" for every cortex and extension the app declares. */
function needsOf(app) {
  const req = (app && app.requires) || null;
  if (!req) return [];
  return [...(req.cortex || []), ...(req.extensions || [])].map((n) => (n.pinned ? `${n.name}@${n.pinned}` : n.name));
}

export default function NeedsSection({ d }) {
  const names = needsOf(d.app);
  return html`
    <${Note} kind="lead" chapter>${x('detail.requiresHint')}<//>
    ${names.length
      ? html`<${Marks} spread>${names.map((n) => html`<${Mark} key=${n} tone="need">${n}<//>`)}<//>`
      : html`<${Note} kind="quiet" size="small" inline>${x('detail.requiresNone')}<//>`}`;
}
