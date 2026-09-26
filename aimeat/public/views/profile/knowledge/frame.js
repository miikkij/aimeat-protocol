/**
 * @file public/views/profile/knowledge/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Knowledge cover, the package page and the public library share: the words a
 *   package is described in (kind, maturity, synthesis, visibility, a relation), what a manifest
 *   adds up to (entries, public entries, references and how many are verified), which group a
 *   package belongs to (drafts, published, datasets), a row of a packages table and its heads, the
 *   crumb's steps, the rail's sibling pages and a package's page frame (SettingsPage).
 * @structure c · words · pkgId · statsOf · groupOf · packageHead · packageRow · crumb · pageLinks · renderPage · entryText
 * @usage import { renderPage, packageRow, packageHead, statsOf } from './frame.js';
 * @version-history
 *   v1.10.0 -- 2026-09-26 -- On the component kit (page group G7): a packages row is the List's Row
 *     (Name that opens the package, Desc, When, Doors with the Action); the crumb returns its steps
 *     and pageLinks its items as data; a package's page is the SettingsPage (page, the rail as data:
 *     Knowledge with the way back, the page's groups, the sibling pages). No class is written here.
 *   v1.9.0 -- 2026-09-26 -- The packages table is the Listing (listing, listing-row and its head row, name, words and doors cells; a group's heading inside it; listing--cols keeps the narrow-screen columns), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-26 -- The line under a package's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Action, Actions } from '/components/Action.js';
import { Row, Name, Desc, When, Doors } from '/components/List.js';

export const c = (key, vars) => t('knowledge.cover.' + key, vars);
// The loc() helper here derived the FORMAT from the LANGUAGE. /js/format.js reads the
// reader's own, from their profile, falling back to their browser.
export const num = (n) => fmtNum(Number(n || 0));
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

export const ctWord = (ct) => (ct ? (t('knowledge.contentTypes.' + ct) || ct) : '');
export const maturityWord = (m) => t('knowledge.maturity.' + (m || 'draft')) || m;
export const synthWord = (s) => t('knowledge.synthesis.' + (s || 'original')) || s;
export const visWord = (v) => t('knowledge.visibility.' + (v === 'shared' ? 'owner' : (v || 'private'))) || v;
export const relWord = (r) => c('relation.' + r) || r;
/** "happydude500001" out of "happydude500001@aimeat-finland-001-genesis". */
export const authorName = (a) => String(a || '').split('@')[0] || '';

export const pkgId = (pkg) => pkg?.value?.id || String(pkg?.key || '').split('/')[1] || pkg?.key;
export const manifestOf = (pkg) => pkg?.value || pkg?.manifest || pkg || {};

/** What a manifest adds up to. */
export function statsOf(m) {
  const entries = m?.entries || [];
  let refs = 0, verified = 0;
  for (const e of entries) for (const r of e.references || []) { refs++; if (r.verified) verified++; }
  for (const r of m?.references || []) { refs++; if (r.verified) verified++; }
  return { entries: entries.length, publicN: entries.filter(e => e.visibility === 'public').length, refs, verified };
}

/** Drafts and reviews, datasets that update themselves, and the published rest. */
export function groupOf(m) {
  if (m?.content_type === 'dataset' || (m?.tags || []).includes('data-package')) return 'dataset';
  if (!m?.maturity || m.maturity === 'draft' || m.maturity === 'review') return 'draft';
  return 'published';
}
export const GROUP_ORDER = ['draft', 'published', 'dataset'];

/** The sharing state in words: listed, clonable, federated. */
export function sharingWords(m, federated) {
  const out = [];
  out.push(m?.sharing?.catalog_listed ? c('listed') : c('notListed'));
  if (m?.sharing?.allow_clone) out.push(c('clonable'));
  if (federated) out.push(t('knowledge.federated'));
  return out;
}

/** One line under a package name: kind · maturity · synthesis · language. */
export const subOf = (m) => [ctWord(m?.content_type || 'document'), maturityWord(m?.maturity), synthWord(m?.synthesis?.level), m?.language ? String(m.language).toLowerCase() : ''].filter(Boolean).join(' · ');

/** An entry's value as readable text: summary and body first, then the named lists, else the JSON. */
export function entryText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const parts = [];
  if (data.summary) parts.push(data.summary);
  if (data.body) parts.push(data.body);
  if (data.description) parts.push(data.description);
  if (data.findings?.length) parts.push(data.findings.map(f => '· ' + f).join('\n'));
  if (data.steps?.length) parts.push(data.steps.map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`).join('\n'));
  if (data.items?.length) parts.push(data.items.map(it => '· ' + (it.title || JSON.stringify(it))).join('\n'));
  if (data.open_questions?.length) parts.push(data.open_questions.map(q => '? ' + q).join('\n'));
  if (parts.length) return parts.join('\n\n');
  return JSON.stringify(data, null, 2);
}

/** The column heads of a packages table: the package, its entries, its sharing, when it changed, the door. */
export const packageHead = () => [c('colPackage'), c('colEntries'), c('colSharing'), c('colChanged'), ''];

/** One row of a packages table (a List with cols="name-count-words-when-doors"): name and its line, entries, sharing, changed, a door. */
export function packageRow(ctx, pkg) {
  const m = manifestOf(pkg); const s = statsOf(m); const id = pkgId(pkg);
  const open = () => ctx.pickView({ kind: 'package', id });
  return html`
    <${Row} key=${id}>
      <${Name} onOpen=${open} meta=${subOf(m)}>${m.name || c('untitled')}<//>
      <${Desc}><b>${s.entries}</b> ${c('entriesWord', { n: s.entries })}${s.refs ? html`<br />${c('refsVerified', { v: s.verified, n: s.refs })}` : null}<//>
      <${Desc}>${sharingWords(m, !!ctx.fedConsents?.[id]).join(' · ')}<//>
      <${When}>${rel(m.updated || pkg.updated_at || pkg.updatedAt)}<//>
      <${Doors}><${Action} small row onClick=${open}>${c('open')}<//><//>
    <//>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The crumb's steps: Settings / Knowledge / the parts (each in ink: the page you are on). */
export function crumb(ctx, parts) {
  const name = t('knowledge.tabLabel');
  return [t('nav.profile'), parts.length ? { label: name, onClick: () => ctx.pickView({ kind: 'cover' }) } : name,
    ...parts.map((p) => ({ label: p, here: true }))];
}

/** The rail's sibling pages, as data: the public library (a new window, ↗) and Discover. */
export function pageLinks() {
  return [
    { onClick: () => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener'), label: c('library'), count: '↗' },
    { tab: 'discover', label: t('discover.title') },
  ];
}

/**
 * A package's page: the crumb, the head (`marks` as Mark data, `doors`), the strip, the sections,
 * and the rail: Knowledge with the way back, the page's own groups (`railGroups`), the sibling pages.
 */
export function renderPage(ctx, { crumbs, title, marks = null, doors = null, strip = null, railGroups = [], children }) {
  return html`<${SettingsPage} name="kp" page crumb=${crumb(ctx, crumbs)} title=${title} marks=${marks || undefined}
    actions=${doors ? html`<${Actions}>${doors}<//>` : null} strip=${strip}
    rail=${{ title: c('railTitle'), groups: [
      { label: t('knowledge.tabLabel'), items: [{ back: true, key: 'back', label: c('backTo'), onClick: () => ctx.pickView({ kind: 'cover' }) }] },
      ...railGroups,
      { label: c('pages'), items: pageLinks().map((p) => ({ mark: '→', count: '→', ...p })) },
    ] }}>${children}<//>`;
}
