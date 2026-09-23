/**
 * @file public/views/profile/memory-tab/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Memory cover and its pages share: the words, the store split into four
 *   parts (own key spaces, organisms', the machine's bookkeeping, and the rest), the visibility
 *   chip, the trail, the page frame with its rail (the page's own panel above the "In your memory"
 *   index), and the box a form opens in. Every shape is a part of the shared component set.
 * @structure c · num · day · agentOf · isStale · byUpdated · SYSTEM_SPACES · classify · visChip ·
 *   crumbList · PAGES · pageDoors · renderPage · formBox
 * @usage import { renderPage, classify, visChip } from './frame.js';
 * @version-history
 *   v1.0.0 -- 2026-09-22 -- Extracted from cover.js when the Memory page moved onto the shared
 *     component set, so the cover, the key space and the record share one frame.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import { Page, Rail, Chip, Action, Surface, Text, Stack } from '/components/poster-parts.js';
import { shortTok, groupOfKey } from './helpers.js';

/* Key spaces the node and the agents write for their own use. Theirs to own, rarely theirs to read. */
export const SYSTEM_SPACES = new Set(['notif', 'ai-usage', 'commerce', 'agents', 'generator', 'org', 'gate', 'usage']);

const STALE_DAYS = 90;
const tr = (key, fb) => t(key) || fb;
export const c = (key, fb) => tr('profile.memory.cover.' + key, fb);
export const num = (n) => fmtNum(Number(n || 0));
export const day = (iso) => fmtDate(iso);
export const agentOf = (gaii) => { const s = String(gaii || ''); return s.includes('#') ? s.split('#')[0] : ''; };
export const isStale = (m) => { const at = m.updated_at || m.created_at; return !!at && (Date.now() - new Date(at).getTime()) > STALE_DAYS * 864e5; };
export const byUpdated = (a, b) => +new Date(b.updated_at || b.created_at || 0) - +new Date(a.updated_at || a.created_at || 0);

/* ── The store in four parts ───────────────────────────────────────────────────────────────── */
export function classify(memories, orgNames) {
  const spaces = new Map();
  for (const m of memories || []) {
    const g = groupOfKey(m.key);
    let s = spaces.get(g.id);
    if (!s) {
      const bucket = g.kind === 'organism' ? 'org' : (SYSTEM_SPACES.has(g.id) ? 'sys' : 'own');
      const label = g.kind === 'organism' ? (orgNames[g.uuid] || shortTok(g.uuid)) : g.kind === 'other' ? (t('profile.memory.groupOther') || 'other') : g.id;
      s = { id: g.id, g, bucket, label, items: [], bytes: 0, publicN: 0, membersN: 0 };
      spaces.set(g.id, s);
    }
    s.items.push(m);
    s.bytes += Number(m.bytes) || 0;
    if (m.visibility === 'public') s.publicN++;
    if (m.visibility === 'members') s.membersN++;
  }
  const all = [...spaces.values()];
  for (const s of all) { s.items.sort(byUpdated); s.latest = s.items[0] || null; }
  all.sort((a, b) => (a.latest && b.latest ? byUpdated(a.latest, b.latest) : b.items.length - a.items.length));
  return { spaces, own: all.filter(s => s.bucket === 'own'), org: all.filter(s => s.bucket === 'org'), sys: all.filter(s => s.bucket === 'sys') };
}

/** A record's visibility as a chip: public on the sun (the one to see), private quiet. */
export const visChip = (v) => html`<${Chip} tone=${v === 'public' ? 'sun' : v === 'private' ? 'muted' : 'plain'}>${t('knowledge.visibility.' + (v || 'private')) || v}<//>`;

/** The trail: Settings, Memory, then the parts; every step but the last goes somewhere. */
export function crumbList(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  return [
    { label: tr('nav.profile', 'Settings') },
    { label: t('profile.memory.title') || 'Memory', onClick: parts.length ? home : undefined },
    ...parts.map((p) => ({ label: p.label, onClick: p.go })),
  ];
}

export const PAGES = [
  ['all', 'allKeys', 'All as keys'], ['discover', 'discover', 'Public'], ['remote', 'remote', 'Remote nodes'],
  ['archived', 'archived', 'Archived'], ['cart', 'cart', 'Collection'], ['tools', 'tools', 'Export and import'],
];

/** The pages under the cover, as choices in the ink rail; the one open sits on the sun. */
export function pageDoors(ctx, current) {
  return PAGES.map(([id, key, fb]) => html`
    <${Action} key=${id} kind=${current === id ? 'tab' : 'text'} selected=${current === id} onClick=${() => ctx.pickView({ kind: 'page', id })}>
      ${c(key, fb)}${id === 'cart' && ctx.cart.length ? ' ' + ctx.cart.length : ''}<//>`);
}

/** A page under the cover: its trail, title, facts and actions, its own panel, then the memory index. */
export function renderPage(ctx, { id, crumbs, title, sub = null, doors = null, rail = null, children }) {
  return html`<${Page} title=${title} crumbs=${crumbList(ctx, crumbs)} identity=${sub} actions=${doors}
    rail=${html`<${Stack}>
      ${rail}
      <${Rail} kind="index" title=${c('railTitle', 'In your memory')}>
        <${Stack} density="compact">
          <${Action} kind="text" onClick=${() => ctx.pickView({ kind: 'cover' })}>↩ ${c('backToMemory', 'Back to memory')}<//>
          ${pageDoors(ctx, id)}
        <//>
      <//>
    <//>`}>
    <${Stack}>${children}<//>
  <//>`;
}

/**
 * The area a form opens in: the panel on the sun edge, its label, the form. Not a box, because the
 * upload form holds the drop zone, which is the dashed aside, and a box never sits in a box.
 */
export const formBox = (label, form) => html`<${Surface} kind="panel"><${Stack}>
  <${Text} kind="label">${label}<//>${form}<//><//>`;
