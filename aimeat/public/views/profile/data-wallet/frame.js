/**
 * @file public/views/profile/data-wallet/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Data Wallet page's views share: the words (x), where a permission points
 *   (a workspace, an organism or a key area, said with its name), who a recipient or an accessor is
 *   (a person, an organism's members, a company, this server's users, everyone, a shared link, an
 *   agent), what a grant lets them do (read, write, sign in), the permissions grouped by what they
 *   open, the trail's groups in words, the grant and revoke events read off the permissions' own
 *   timestamps, dates, the crumb and the rail links.
 * @structure x · targetOf · targetWords · whoOf · accessorWords · roleOf · grantWords · targetRows ·
 *   groupWords · consentEvents · dateWord · timeWord · spanWord · crumb · pageLinks · openTab
 * @usage import { x, targetRows, groupWords } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Tietolompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('dwpage.' + key, vars);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WS_KEY = new RegExp(`^organism\\.(${UUID})\\.w\\.([A-Za-z0-9_-]+)(?:\\.(.*))?$`);
const ORG_KEY = new RegExp(`^organism\\.(${UUID})(?:\\.(.*))?$`);

const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB');

export function dateWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'numeric', year: 'numeric' });
}
export function timeWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
}
/** "20.7.–30.8.2026", or one date when first and last fall on the same day. */
export function spanWord(first, last) {
  const a = dateWord(first), b = dateWord(last);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a}–${b}`;
}
export const n = (v) => (Number(v) || 0).toLocaleString(localeTag());

/* ── Where a permission or a key points ───────────────────────────────────────────────────────── */

/** { kind: 'ws' | 'org' | 'key', organism_id, workspace_id, rest, key } */
export function targetOf(pattern) {
  const k = String(pattern || '');
  const ws = WS_KEY.exec(k);
  if (ws) return { kind: 'ws', organism_id: ws[1], workspace_id: ws[2], rest: ws[3] || '' };
  const org = ORG_KEY.exec(k);
  if (org) return { kind: 'org', organism_id: org[1], rest: org[2] || '' };
  return { kind: 'key', key: k };
}

const shortId = (id) => String(id || '').slice(0, 8);
export const orgName = (names, id) => names?.organisms?.[id] || shortId(id);
export const wsName = (names, orgId, wsId) => names?.workspaces?.[orgId]?.[wsId] || wsId;

/** A well-known key area in words; anything else is its own name. */
const KEY_WORDS = { _identity: 'key.identity', 'portfolio/contact*': 'key.portfolioContact', 'newspaper.admin.hidden': null };
export function keyWords(key) {
  const k = KEY_WORDS[key];
  return k ? x(k) : key;
}

/** { title, sub } for the target of one pattern, with names. */
export function targetWords(pattern, names) {
  const tg = targetOf(pattern);
  if (tg.kind === 'ws') return { title: orgName(names, tg.organism_id), sub: wsName(names, tg.organism_id, tg.workspace_id) };
  if (tg.kind === 'org') return { title: orgName(names, tg.organism_id), sub: tg.rest && tg.rest !== '**' ? tg.rest : x('wholeOrganism') };
  const title = keyWords(tg.key);
  return { title, sub: title === tg.key ? x('keyAreaShort') : x('keyArea', { key: tg.key }) };
}

/* ── Who ──────────────────────────────────────────────────────────────────────────────────────── */

const local = (s) => { const i = String(s || '').indexOf('@'); return i > 0 ? s.slice(0, i) : String(s || ''); };

/** A recipient of a permission: { kind, name } where name is what the page prints. */
export function whoOf(recipient, names) {
  const r = String(recipient || '');
  if (r === '*') return { kind: 'all', name: x('who.all') };
  if (r.startsWith('ghii:')) return { kind: 'person', name: local(r.slice(5)) };
  if (r.startsWith('organism.')) return { kind: 'orgMembers', name: x('who.orgMembers', { org: orgName(names, r.slice(9)) }) };
  if (r.startsWith('node:')) return { kind: 'node', name: x('who.nodeUsers') };
  if (r.startsWith('domain:')) return { kind: 'domain', name: x('who.domain', { domain: r.slice(7) }) };
  if (r.startsWith('org:')) return { kind: 'company', name: x('who.company', { name: local(r.slice(4)) }) };
  const hash = r.indexOf('#');
  if (hash > 0) return { kind: 'agent', name: x('who.agentOf', { name: r.slice(0, hash), owner: local(r.slice(hash + 1)) }) };
  return { kind: 'person', name: local(r) };
}

/** An accessor in the trail: a person, an agent, a shared link or nobody signed in. */
export function accessorWords(gaii) {
  const g = String(gaii || '');
  if (!g || g === 'anonymous') return { name: x('who.anonymous'), sub: '' };
  if (g.startsWith('shared#')) return { name: x('who.sharedLink'), sub: x('who.anonymous') };
  const s = g.startsWith('ghii:') ? g.slice(5) : g;
  const hash = s.indexOf('#');
  if (hash > 0) return { name: local(s.slice(hash + 1)), sub: x('who.viaAgent', { name: s.slice(0, hash) }) };
  return { name: local(s), sub: '' };
}

/* ── What a grant lets them do ────────────────────────────────────────────────────────────────── */

/** 'contributor' | 'viewer' | 'access' | 'login' | 'read' */
export function roleOf(c) {
  const p = String(c?.purpose || '');
  if (p === 'workspace-contributor' || p === 'workspace-contribution') return 'contributor';
  if (p === 'workspace-viewer') return 'viewer';
  if (p === 'workspace-access') return 'access';
  if (p === 'federation_login_all' || c?.scope === 'auth') return 'login';
  return 'read';
}
export const roleWord = (role) => x('role.' + role);

/** Recipient kinds that name many people, so the verb agrees in the plural. */
const PLURAL_WHO = new Set(['all', 'orgMembers', 'node', 'domain']);

/** One grant as a sentence: who, and what they may do. */
export function grantWords(c, names) {
  const who = whoOf(c.recipient, names);
  const role = roleOf(c);
  return { who, role, text: x((PLURAL_WHO.has(who.kind) ? 'grantPl.' : 'grant.') + role, { who: who.name }) };
}

/* ── The permissions grouped by what they open ────────────────────────────────────────────────── */

/** The names of the recipients, unique, at most `max` and "+n". */
function namesOf(grants, names, max = 4) {
  const seen = [];
  for (const g of grants) { const w = whoOf(g.recipient, names).name; if (!seen.includes(w)) seen.push(w); }
  if (seen.length <= max) return seen.join(', ');
  return `${seen.slice(0, max).join(', ')} +${seen.length - max}`;
}

/** How many of each role, said as "2 writers · reader". */
function rolesOf(grants) {
  const counts = {};
  for (const g of grants) { const r = roleOf(g); counts[r] = (counts[r] || 0) + 1; }
  return Object.entries(counts).map(([r, k]) => (k === 1 ? roleWord(r) : x('roleN.' + r, { n: k }))).join(' · ');
}

/** "1 permission" / "{n} permissions", count-safe in every language. */
export const grantsWord = (k) => (k === 1 ? x('grantOne') : x('grantsN', { n: k }));

/**
 * One row per target: an organism with its workspaces, or one key area. Active grants only in
 * `grants`; the revoked ones of the same target in `revoked`.
 * @returns {Array<{ id, kind, title, sub, words, since, grants, revoked, organism_id, workspaces }>}
 */
export function targetRows(consents, names) {
  const rows = new Map();
  const slot = (id, make) => { let r = rows.get(id); if (!r) { r = make(); rows.set(id, r); } return r; };
  for (const c of consents || []) {
    const tg = targetOf(c.data_pattern);
    const active = c.status === 'active';
    let r;
    if (tg.kind === 'key') {
      r = slot(`k|${c.data_pattern}`, () => ({ id: `k|${c.data_pattern}`, kind: 'key', pattern: c.data_pattern, ...targetWords(c.data_pattern, names), grants: [], revoked: [], since: null, workspaces: new Map() }));
    } else {
      r = slot(`o|${tg.organism_id}`, () => ({ id: `o|${tg.organism_id}`, kind: 'org', organism_id: tg.organism_id, title: orgName(names, tg.organism_id), sub: '', grants: [], revoked: [], since: null, workspaces: new Map() }));
      const wsId = tg.kind === 'ws' ? tg.workspace_id : '';
      const ws = r.workspaces.get(wsId) || { id: wsId, name: wsId ? wsName(names, tg.organism_id, wsId) : x('wholeOrganism'), grants: [], revoked: [] };
      (active ? ws.grants : ws.revoked).push(c);
      r.workspaces.set(wsId, ws);
    }
    (active ? r.grants : r.revoked).push(c);
    if (active && (!r.since || c.granted_at < r.since)) r.since = c.granted_at;
  }
  const out = [...rows.values()].map((r) => {
    if (r.kind === 'org') {
      const wsList = [...r.workspaces.values()].filter((w) => w.grants.length);
      const named = wsList.filter((w) => w.id);
      r.sub = named.length === 1 ? x('wsOne', { names: named[0].name }) : named.length ? x('wsCount', { n: named.length, names: named.map((w) => w.name).join(', ') }) : x('wholeOrganism');
      r.workspaces = wsList;
    } else {
      r.workspaces = [];
    }
    r.words = r.grants.length ? `${namesOf(r.grants, names)} · ${rolesOf(r.grants)}` : x('row.onlyRevoked', { n: r.revoked.length });
    return r;
  });
  return out.sort((a, b) => b.grants.length - a.grants.length || (a.since || '') < (b.since || '') ? 1 : -1);
}

/* ── The trail's groups in words ──────────────────────────────────────────────────────────────── */

const REST_WORDS = { 'meta.manifest': 'rest.manifest', 'meta.readme': 'rest.readme', 'meta.workspaces': 'rest.workspaces' };
export const restWords = (rest) => (REST_WORDS[rest] ? x(REST_WORDS[rest]) : rest);

/** One group of the trail as words: who tried, what, and the outcome. */
export function groupWords(g, names) {
  const who = accessorWords(g.accessor_gaii);
  const tg = g.target || {};
  let what, sub = '';
  if (tg.kind === 'ws') {
    what = `${orgName(names, tg.organism_id)}: ${restWords(tg.rest)}`;
    sub = x('wsN', { n: g.key_count });
  } else if (tg.kind === 'org') {
    what = `${orgName(names, tg.organism_id)}: ${tg.rest ? restWords(tg.rest) : x('wholeOrganism')}`;
  } else {
    what = keyWords(tg.key);
    if (what === tg.key) sub = x('keyArea', { key: '' }).trim();
  }
  const outcome = g.action === 'grant' ? 'granted' : g.action === 'revoke' ? 'revoked' : g.allowed ? 'allowed' : 'denied';
  return { who, what, sub, outcome };
}

/** The grants and revocations in the window, read off the permissions' own timestamps, newest first. */
export function consentEvents(consents, days, names) {
  const since = Date.now() - days * 86400000;
  const events = [];
  for (const c of consents || []) {
    const g = new Date(c.granted_at).getTime();
    if (g >= since) events.push({ kind: 'granted', at: c.granted_at, consent: c });
    const r = c.revoked_at ? new Date(c.revoked_at).getTime() : 0;
    if (r && r >= since) events.push({ kind: 'revoked', at: c.revoked_at, consent: c });
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map((e) => {
    const tw = targetWords(e.consent.data_pattern, names);
    const who = whoOf(e.consent.recipient, names);
    const by = e.consent.metadata?.grantedBy;
    return { ...e, who, target: tw, role: roleOf(e.consent), by: e.kind === 'granted' ? by || '' : '' };
  });
}

/* ── The crumb and the rail ───────────────────────────────────────────────────────────────────── */

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuAccount')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.dataWallet')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('organisms')}><i>→</i>${t('profile.tabs.organisms')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('memory')}><i>→</i>${t('profile.tabs.memory')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('contacts')}><i>→</i>${t('contacts.tabLabel')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>`;
}
