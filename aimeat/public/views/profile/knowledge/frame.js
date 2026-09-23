/**
 * @file public/views/profile/knowledge/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Knowledge cover, the package page and the public library share: the words a
 *   package is described in (kind, maturity, synthesis, visibility, a relation), what a manifest
 *   adds up to (entries, public entries, references and how many are verified), which group a
 *   package belongs to (drafts, published, datasets), the rows of packages, the crumb and the page
 *   frame with its rail, all composed from the shared set (components/poster-parts.js).
 * @structure c · words · pkgId · statsOf · groupOf · lines · packageRows · crumb · pageLinks · renderPage · entryText
 * @usage import { renderPage, packageRows, statsOf } from './frame.js';
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: a package is a ListRow, the
 *     crumb is the Masthead trail, the page frame is Page with an index Rail, so the page follows
 *     the one theme and has no sheet of its own. The rail's arrows are the allowed → and ↩.
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
import { Page, Rail, Stack, ListRow, Action, Text } from '/components/poster-parts.js';

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

/** Text that keeps its line breaks: a paragraph per blank line, a line break per newline. */
export function lines(text) {
  return String(text || '').split('\n').flatMap((line, i) => (i ? [html`<br key=${'b' + i} />`, line] : [line]));
}

/**
 * Rows of packages: name and its line, the entries at the right, a door; the references, the
 * sharing state and when it changed on the line under. (A Table crushed the name column on a phone.)
 */
export function packageRows(ctx, list) {
  return html`<div>${list.map(pkg => { const m = manifestOf(pkg); const s = statsOf(m); const id = pkgId(pkg); const open = () => ctx.pickView({ kind: 'package', id }); return html`
    <${ListRow} key=${id} density="compact" detailKind="text" name=${m.name || c('untitled')} onOpen=${open} detail=${subOf(m)}
      value=${`${s.entries} ${c('entriesWord', { n: s.entries })}`}
      actions=${html`<${Action} onClick=${open}>${c('open')}<//>`}>
      <${Text} kind="mono" tone="muted">${[s.refs ? c('refsVerified', { v: s.verified, n: s.refs }) : '', sharingWords(m, !!ctx.fedConsents?.[id]).join(' · '), rel(m.updated || pkg.updated_at || pkg.updatedAt)].filter(Boolean).join(' · ')}<//>
    <//>`; })}</div>`;
}

/* ── The crumb and the page frame ──────────────────────────────────────────────────────────── */
/** The trail as Masthead crumbs: Settings & Controls, Knowledge, then the parts. */
export function crumb(ctx, parts) {
  return [
    { label: t('nav.profile') },
    { label: t('knowledge.tabLabel'), onClick: parts.length ? () => ctx.pickView({ kind: 'cover' }) : undefined },
    ...parts.map(p => ({ label: p })),
  ];
}

export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${c('pages')}<//>
    <${Action} onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank', 'noopener')}>${c('library')} →<//>
    <${Action} onClick=${() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'discover' } }))}>${t('discover.title')} →<//>
  <//>`;
}

/** A package's page: the Page frame, its index rail with the door back, and the pages. */
export function renderPage(ctx, { crumbs, title, chips = null, doors = null, strip = null, railTitle, entries = [], rail = null, children }) {
  return html`<${Page} title=${title} crumbs=${crumb(ctx, crumbs)} identity=${chips} actions=${doors}
    rail=${html`<${Rail} kind="index" title=${railTitle} label=${c('railTitle')} entries=${entries}><${Stack}>
      <${Text} kind="label">${t('knowledge.tabLabel')}<//>
      <${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'cover' })}>↩ ${c('backTo')}<//>
      ${rail}${pageLinks()}
    <//><//>`}>
    ${strip}<${Stack}>${children}<//>
  <//>`;
}
