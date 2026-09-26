/**
 * @file public/views/profile/discover/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Discover cover and its pages share: the words (a kind's name and what it
 *   is, a scope's name), the search desk (one field, the scope beside it with its counts), the row
 *   of one entry (when, title and a plain description with the query words marked, kind and place,
 *   a door), the crumb, the page frame with its rail, and opening an entry at its real home.
 * @structure c · kindName · kindSub · HUMAN_TYPES · desk · entryCells · entryRows · crumb · renderPage · openEntry
 * @usage import { renderPage, desk, entryRows, openEntry } from './frame.js';
 * @version-history
 *   v1.12.0 -- 2026-09-26 -- Every part is a kit component (QuestionDesk, List with its Row, Cell, Name, Desc and Doors, Figure, Found, SettingsPage with its crumb and rail as data): the page passes data and writes no class (page group G8).
 *   v1.11.0 -- 2026-09-26 -- The rows of entries are the Listing (listing, listing-row and its head row, name, words and doors cells; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-26 -- The line under an entry's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.3.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 -- 2026-09-13 -- V2: use the shared ink rule on the search row.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { QuestionDesk } from '/components/QuestionDesk.js';
import { List, Row, Name, Desc, Cell, Doors, Found } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';

export const c = (key, vars) => t('discover.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
export const num = (n) => fmtNum(Number(n || 0));
const two = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayLabel = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? dayLabel(d) : formatRelativeTime(iso); };

/** The kinds a person reads; `memory` is the raw store and is shown on its own terms. */
export const HUMAN_TYPES = ['document', 'knowledge', 'decision', 'skill', 'app', 'offering', 'workflow', 'company', 'template', 'designbook', 'material', 'capability', 'research', 'organism'];
export const kindName = (type) => t('discover.type.' + type) || type;
export const kindSub = (type) => c('kindSub.' + type);
export const SCOPES = ['own', 'public', 'shared'];

/** Split a text at the query words and mark them (the List's Found); plain strings when there is no query. */
export function hl(text, words) {
  const s = String(text || '');
  if (!words.length || !s) return s;
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  const parts = s.split(re);
  return parts.map((p, i) => (i % 2 ? html`<${Found} key=${i}>${p}<//>` : p));
}

export const placeOf = (e) => (e.place ? `${e.place.organism} › ${e.place.workspace}${e.segment && e.type === 'document' ? ` › ${e.segment}` : ''}` : (e.segment && e.type !== 'memory' ? e.segment : ''));

/** The search desk: the field, the scope beside it with a count per scope, one hint. */
export function desk(ctx) {
  const count = (s) => { const f = ctx.facets[s]; if (!f) return ''; return (s === 'public' && f.types.some(x => x.count >= 50)) ? `${num(f.total)}+` : num(f.total); };
  const hint = !ctx.facets[ctx.scope] ? html`<${Note} kind="loading" inline>${c('loading')}<//>` : ctx.query ? c('hintResults') : c('hint');
  return html`<${QuestionDesk}
    value=${ctx.q}
    placeholder=${ctx.scope === 'public' ? c('askPublic') : c('ask')}
    onInput=${(v) => ctx.setQ(v)}
    onEnter=${() => ctx.submit()}
    scopes=${SCOPES.map(s => ({ value: s, key: s, label: t('discover.scope.' + s), count: count(s) || (s === ctx.scope ? '…' : '') }))}
    scope=${ctx.scope}
    onScope=${(s) => ctx.setScope(s)}
    hint=${hint} />`;
}

/** The rows of entries (List rows): when, what (with the words marked), kind and place, a door. */
export function entryCells(ctx, list, { words = [], time = true } = {}) {
  return list.map((e, i) => {
    const open = () => openEntry(ctx, e);
    const at = new Date(e.updatedAt);
    return html`
    <${Row} key=${'e' + i}>
      ${time ? html`<${Cell}><${Figure} small n=${hhmm(at)} sub=${dayLabel(at)} /><//>` : null}
      <${Name} onOpen=${open} clip=${time ? true : 2} meta=${e.description ? hl(e.description, words) : null}>${hl(e.title || e.id, words)}<//>
      <${Desc}><b>${kindName(e.type)}</b>${placeOf(e) ? ` · ${placeOf(e)}` : ''}${!time ? ` · ${rel(e.updatedAt)}` : ''}<//>
      <${Doors}><${Action} small row onClick=${open}>${c('open')}<//><//>
    <//>`;
  });
}
/** The List of entries; with `time: false` the hits' cut (no when column), with `head` its heading row. */
export function entryRows(ctx, list, opts = {}) {
  const hits = opts.time === false;
  return html`<${List} keepCols cols=${hits ? 'name-where-doors' : 'when-name-where-doors'}
    head=${opts.head ? [c('colWhen'), c('colWhat'), c('colKindPlace'), ''] : null}>${entryCells(ctx, list, opts)}<//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The crumb's steps: Discover opens the cover once a page stands after it; every part after it is ink. */
export function crumb(ctx, parts) {
  return [
    t('nav.profile'),
    parts.length ? { label: t('discover.title'), onClick: () => ctx.pickView({ kind: 'cover' }) } : t('discover.title'),
    ...parts.map((p) => ({ label: p, here: true })),
  ];
}

/**
 * A page of Discover (results, a kind, a place): the crumb, the head with its tags and doors, the
 * desk, and the rail that leads back to the cover and then `railGroup` (a labelled group of items).
 */
export function renderPage(ctx, { crumbs, title, marks = [], doors = null, railGroup = null, children }) {
  return html`
    <${SettingsPage} name="dv" page
      crumb=${crumb(ctx, crumbs)}
      title=${title}
      marks=${marks}
      actions=${doors ? html`<${Actions}>${doors}<//>` : null}
      strip=${desk(ctx)}
      rail=${{ title: c('railTitle'), groups: [
        { label: t('discover.title'), items: [{ back: true, key: 'back', label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
        railGroup,
      ].filter(Boolean) }}>
      ${children}
    <//>`;
}

/**
 * Open a result at its real home. The backend `href` is the API fetch URL (for agents); a browser
 * tab there has no Bearer header, so clicks are routed by what the entry is.
 */
export function openEntry(ctx, entry) {
  const id = String(entry.id || '');
  const ws = id.match(/^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)\.([^.]+)/);
  if (ws) {
    const [, org, wsId, space, docId] = ws;
    if (ctx.scope === 'public') {
      window.open(`/v1/publicworkspaceviewer?org=${encodeURIComponent(org)}&ws=${encodeURIComponent(wsId)}&type=${encodeURIComponent(space)}&id=${encodeURIComponent(docId)}`, '_blank', 'noopener');
      return;
    }
    try {
      sessionStorage.setItem('aimeat.ws.openId', org);
      sessionStorage.setItem('aimeat.ws.openWs', wsId);
      sessionStorage.setItem(`aimeat.ws.${org}.${wsId}.openDoc`, JSON.stringify({ namespace: space, id: docId }));
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    } catch { /* noop */ }
    ctx.openTab('organisms');
    return;
  }
  const pkg = id.match(/^packages\/([^/]+)\//);
  if (pkg) { window.open(`/v1/publicknowledgeviewer?id=${encodeURIComponent(pkg[1])}`, '_blank', 'noopener'); return; }
  if (entry.type === 'app' && entry.href) { window.open(entry.href, '_blank', 'noopener'); return; }
  const HOME_TAB = { capability: 'capabilities', workflow: 'workflows', organism: 'organisms', knowledge: 'knowledge', skill: 'skills', offering: 'offers', material: 'offers', designbook: 'apps', template: 'apps', company: 'companies' };
  ctx.openTab(HOME_TAB[entry.type] || 'memory');
}
