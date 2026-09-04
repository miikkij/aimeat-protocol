/**
 * @file public/views/profile/access/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Access page's views share: the words (x), a key's rights said in the
 *   reader's language (a scope word becomes a phrase from this page's own vocabulary, then the
 *   consent screen's sentence, then the shared scope sentence tree; the eight-word base package is
 *   folded into one tag), a token's level in words, the rows of section 02 built from the grants and
 *   the tokens with the filters that turn them, dates, the crumb and the rail links.
 * @structure x · n · dateWord · timeWord · daysAgo · scopeSentence · rightsInWords · rightGroups ·
 *   levelWords · keyRows · crumb · pageLinks · openTab
 * @usage import { x, keyRows, rightsInWords } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('accesspage.' + key, vars);

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
export const n = (v) => (Number(v) || 0).toLocaleString(localeTag());
export const daysAgo = (iso, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : null);

/* ── A scope word in the reader's language ──────────────────────────────────────────────────── */

/** The sentence chain: this page's phrase, the consent screen's line, the shared scope tree, the word. */
export function scopeSentence(scope) {
  const i = scope.indexOf(':');
  const f = i > 0 ? scope.slice(0, i) : scope;
  const p = i > 0 ? scope.slice(i + 1) : '';
  for (const key of [`accesspage.scope.${f}.${p}`, `appGrant.scopeText.${f}.${p}`, `profile.agents.scopeUi.scopeText.${f}.${p}`]) {
    const s = t(key);
    if (s && s !== key) return s;
  }
  return scope;
}

/** "reads, writes and deletes" for a verb family: the verbs joined in the reader's language. */
function verbs(family, perms) {
  const words = perms.map((p) => x(`verb.${family}.${p}`)).filter((w) => w && !w.startsWith('accesspage.'));
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} ${x('and')} ${words[words.length - 1]}`;
}

/**
 * The rights a key holds, as phrases, with the base package folded into one tag.
 * @returns {{ phrases: string[], base: boolean, extra: string[] }} phrases in words (memory and
 *   files as one phrase each), whether the whole base package is present, and the scope words the
 *   phrases cover.
 */
export function rightsInWords(scopes, basePackage) {
  const held = Array.isArray(scopes) ? scopes : [];
  const base = basePackage.length > 0 && basePackage.every((s) => held.includes(s));
  const rest = base ? held.filter((s) => !basePackage.includes(s)) : held;
  const phrases = [];
  const covered = new Set();
  const order = ['read', 'write', 'delete'];
  for (const [family, object] of [['memory', 'memory'], ['storage', 'files']]) {
    const perms = order.filter((p) => rest.includes(`${family}:${p}`));
    if (perms.length) {
      const v = verbs(family, perms);
      if (v) { phrases.push(`${v} ${x('object.' + object)}`); perms.forEach((p) => covered.add(`${family}:${p}`)); }
    }
  }
  for (const s of rest) {
    if (covered.has(s)) continue;
    phrases.push(scopeSentence(s));
    covered.add(s);
  }
  return { phrases, base, extra: [...covered] };
}

/** The rights of one opened key, one group per line: label, phrase, the scope words the line takes away. */
export function rightGroups(scopes, basePackage) {
  const held = Array.isArray(scopes) ? scopes : [];
  const base = basePackage.length > 0 && basePackage.every((s) => held.includes(s));
  const rest = base ? held.filter((s) => !basePackage.includes(s)) : held;
  // One row per family ("your memory", "your automations"), never one per word: the label is the
  // thing the right is about, and the sentence says what the key may do with it. Memory and files
  // fold read/write/delete into one verb phrase; every other family lists its sentences.
  const byFamily = new Map();
  for (const s of rest) {
    const family = s.split(':')[0];
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push(s);
  }
  const groups = [];
  for (const [family, words] of byFamily) {
    const perms = words.map((w) => w.split(':')[1]);
    const object = family === 'memory' ? 'memory' : family === 'storage' ? 'files' : null;
    const folds = object && perms.every((p) => ['read', 'write', 'delete'].includes(p));
    const text = folds ? `${verbs(family, perms)} ${x('object.' + object)}` : words.map(scopeSentence).join(' · ');
    groups.push({ id: family, label: familyWord(family), text, scopes: words });
  }
  if (base) groups.push({ id: 'base', label: x('basePackage'), text: basePackage.map(scopeSentence).join(' · '), scopes: [...basePackage], base: true });
  return groups;
}

/** The thing a scope family is about, as a label ("your memory"); the bare family word when no
 *  language has named it yet, which is a missing key and not a crash. */
function familyWord(family) {
  const v = x('fam.' + family);
  return v === 'accesspage.fam.' + family ? family : v;
}

/** A token's level, in words and as a tag. */
export function levelWords(tok, basePackage) {
  if (tok.grant_operator) return { tag: x('level.operator'), text: x('level.operatorText'), low: true };
  if (tok.grant_owner) return { tag: x('level.owner'), text: x('level.ownerText'), low: true };
  const r = rightsInWords(tok.scopes, basePackage);
  return { tag: x('level.scoped'), text: r.phrases.join(', ') || x('level.nothing'), low: false };
}

/* ── The rows of section 02 ─────────────────────────────────────────────────────────────────── */

export const UNUSED_DAYS = 30;
/** "kansi.apps.aimeat.io" out of an origin; a value that is not a URL is shown as it is. */
const hostOf = (u) => String(u || '').replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');

/**
 * One row per key: the apps' grants and the tokens in one list, most recently used first.
 * @returns {Array<{ id, kind, name, sub, subLow, words, base, last, lastLow, expires, canSpend, grant, token }>}
 */
export function keyRows(ov, now = Date.now()) {
  const base = ov?.base_package || [];
  const rows = [];
  for (const g of ov?.appGrants?.grants || []) {
    const r = rightsInWords(g.scopes, base);
    const last = g.last_used_at || null;
    const idle = daysAgo(last || g.granted_at, now);
    const origin = hostOf(g.app_origin);
    rows.push({
      id: g.grant_id, kind: 'app', name: g.app_name || g.app, origin,
      sub: [x('kind.app'), origin, x('keyGranted', { date: dateWord(g.granted_at) })].filter(Boolean).join(' · '),
      subLow: false, words: r.phrases, base: r.base, last, idle,
      lastLow: idle != null && idle >= UNUSED_DAYS, expires: null, canSpend: !!g.can_spend, spendCap: g.spend_cap_morsels ?? null, spent: g.spent_morsels ?? 0,
      fixedAt: g.scopes_fixed_at || null, scopes: g.scopes || [], grant: g, token: null,
      usedAt: last || g.granted_at,
    });
  }
  for (const tk of ov?.accessTokens?.tokens || []) {
    const lv = levelWords(tk, base);
    const last = tk.last_used_at || null;
    const idle = daysAgo(last || tk.created_at, now);
    const expired = tk.expires_at ? new Date(tk.expires_at).getTime() < now : false;
    const expiry = tk.expires_at ? x(expired ? 'expired' : 'expires', { date: dateWord(tk.expires_at) }) : x('neverExpires');
    rows.push({
      id: tk.id, kind: 'token', name: tk.label, origin: '',
      sub: [x('kind.token'), lv.tag, x('tokenCreated', { date: dateWord(tk.created_at) }), expiry].join(' · '),
      subLow: lv.low || !tk.expires_at, words: [lv.text], base: false, last, idle,
      lastLow: idle != null && idle >= UNUSED_DAYS, expires: tk.expires_at || null, expired, canSpend: false,
      fixedAt: null, scopes: tk.scopes || [], grant: null, token: tk, level: lv,
      usedAt: last || tk.created_at,
    });
  }
  return rows.sort((a, b) => (a.usedAt < b.usedAt ? 1 : a.usedAt > b.usedAt ? -1 : 0));
}

export const FILTERS = ['all', 'apps', 'tokens', 'day', 'unused', 'spend'];
export function filterRows(rows, filter, now = Date.now()) {
  switch (filter) {
    case 'apps': return rows.filter((r) => r.kind === 'app');
    case 'tokens': return rows.filter((r) => r.kind === 'token');
    case 'day': return rows.filter((r) => r.last && now - new Date(r.last).getTime() < 86400000);
    case 'unused': return rows.filter((r) => r.lastLow);
    case 'spend': return rows.filter((r) => r.canSpend);
    default: return rows;
  }
}

/* ── The crumb and the rail ───────────────────────────────────────────────────────────────── */

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuAccount')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.access')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks(isOperator) {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('fleet')}><i>→</i>${t('profile.tabs.fleet')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('dataWallet')}><i>→</i>${t('profile.tabs.dataWallet')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('mcp')}><i>→</i>${t('profile.tabs.mcp')}<em>→</em></button>
    ${isOperator ? html`<button type="button" class="og-rail-link" onClick=${() => openTab('security')}><i>→</i>${t('profile.tabs.security')}<em>${x('operatorOnly')}</em></button>` : null}`;
}
