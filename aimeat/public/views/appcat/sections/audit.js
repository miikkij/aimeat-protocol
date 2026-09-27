/**
 * @file public/views/appcat/sections/audit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Audit log" (features F332, route F217): every change to how this
 *   app is offered, newest first: the date, the act in words with its details (the page kind, the
 *   format, the size in kB, the first 8 of the checksum, yes or no, a name, a state, flags; an act this
 *   build has no words for is shown as the server wrote it), and by whom. Only the owner can read it.
 *   The first 12 show; "Show {n} more" adds 25. The log is read with the legal state (legal-state.js),
 *   so a saved legal page appears here at once. The shell draws the chapter line and the headline
 *   from `meta`; this is the body.
 * @structure meta · AuditSection({ d }) · actWords(entry)
 * @usage const mod = await import('./sections/audit.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (sections-c): the log as .mk-log (List tone log),
 *     the grey lines as .dtl-ai-status, "Show {n} more" as the old door word in its own row.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's audit half of js/legal.js on components (appcat
 *     detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
import { List, Row, Name, When, Who } from '/components/List.js';
import { x } from '/views/appcat/i18n.js';
import { dateText } from '/views/appcat/sections/app-write.js';
import { useLegal } from '/views/appcat/sections/legal-state.js';

const html = htm.bind(h);
const FIRST = 12;
const STEP = 25;

export const meta = { id: 'audit', title: 'audit.title', show: (d) => !!(d && d.isOwnPublished) };

/** The act in words, with its details after it. */
export function actWords(e) {
  const key = 'audit.action.' + e.action;
  let s = x(key);
  if (s === 'appcat.' + key || s === key) s = e.action;
  const dt = e.detail || {};
  const extra = [];
  if (dt.kind) extra.push(x('legal.kind.' + dt.kind));
  if (dt.format) extra.push(x('legal.format.' + dt.format));
  if (typeof dt.size === 'number') extra.push(Math.max(1, Math.round(dt.size / 1000)) + ' kB');
  if (dt.sha256) extra.push('#' + String(dt.sha256).slice(0, 8));
  if (typeof dt.on === 'boolean') extra.push(x(dt.on ? 'marks.yes' : 'marks.no'));
  if (dt.name) extra.push(String(dt.name));
  if (dt.state) extra.push(String(dt.state));
  if (dt.flags) extra.push(String(dt.flags));
  return s + (extra.length ? ' · ' + extra.join(' · ') : '');
}

export default function AuditSection({ d }) {
  const st = useLegal(d);
  const [shown, setShown] = useState(FIRST);
  useEffect(() => { setShown(FIRST); }, [d.ref]);

  const intro = html`<${Note} kind="hint" chapter>${x('audit.intro')}<//>`;
  if (!st || st.audit.state === 'loading') return html`<${Note} kind="hint" chapter>${x('audit.loading')}<//>`;
  if (st.audit.state === 'error') return html`<${Note} kind="hint" chapter>${x('audit.loadFailed')}<//>`;
  const entries = st.audit.entries;
  if (!entries.length) return html`${intro}<${Note} kind="hint" chapter>${x('audit.empty')}<//>`;
  const rest = entries.length - shown;
  // The old page's .mk-log, and "Show {n} more" as its own door word in a row under it (.dtl-btn-row).
  return html`${intro}
    <${List} tone="log" cols="when-name-who">${entries.slice().reverse().slice(0, shown).map((e, i) => html`<${Row} key=${i}>
      <${When}>${dateText(e.at)}<//>
      <${Name}>${actWords(e)}<//>
      <${Who}>${e.by}<//>
    <//>`)}<//>
    ${rest > 0 ? html`<${Actions} chapter><${Action} small onClick=${() => setShown((n) => n + STEP)}>${x('audit.more', { n: rest })}<//><//>` : null}`;
}
