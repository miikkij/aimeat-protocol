/**
 * @file public/views/profile/wallet/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the wallet page's views share: the words (x), a ledger row said in words (who
 *   did what, from its kind, its tracking code, its counterparty and the agent that made the call),
 *   the sources the morsels came from and went to, money in the reader's own currency format, a
 *   morsel amount with its sign and its unit, dates, the crumb and the rail links.
 * @structure x · money · morsels · dateWord · timeWord · shortName · rowWords · rowKind · sourcesOf ·
 *   crumb · pageLinks · openTab
 * @usage import { x, rowWords, sourcesOf } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Lompakko-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('walpage.' + key, vars);

/** Row kinds that are the pace or a gift, not something earned from somebody. */
export const GRANTED = new Set(['allowance', 'daily_allowance', 'welcome_bonus', 'mint']);

const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB');

/** Money micro-units (6 decimals) in the reader's format: "1,37 €"; a share with no currency is morsels. */
export function money(micros, currency) {
  const v = (Number(micros) || 0) / 1_000_000;
  if (!currency) return morsels(Number(micros) || 0);
  const digits = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat(getLocale() === 'en' ? 'en-US' : localeTag(), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    // An unknown currency code prints as a plain number, which is the answer.
    return `${v.toFixed(digits)} ${currency}`;
  }
}

/** "1 murunen", "27 murusta". */
export const morsels = (n) => x(Math.abs(Number(n) || 0) === 1 ? 'morselOne' : 'morselMany', { n: Math.abs(Number(n) || 0) });

/** "+190", "−82", with the proper minus sign. */
export const signed = (n) => `${Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : ''}${Math.abs(Number(n) || 0)}`;

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

/** "exchange-composer#jounidude@node" → "exchange-composer (jounidude)"; "alice@node" → "alice". */
export function shortName(gaii) {
  const s = String(gaii || '');
  if (!s) return '';
  const at = s.indexOf('@');
  const local = at > 0 ? s.slice(0, at) : s;
  const hash = local.indexOf('#');
  return hash > 0 ? `${local.slice(0, hash)} (${local.slice(hash + 1)})` : local;
}

/** The owner half of a GAII: "exchange-composer#jounidude@node" → "jounidude". */
const ownerOf = (gaii) => { const s = shortName(gaii); const i = s.indexOf(' ('); return i > 0 ? s.slice(i + 2, -1) : s; };

/** 'in' | 'out' | 'granted'. */
export function rowKind(tx) {
  if (GRANTED.has(tx.type)) return 'granted';
  return Number(tx.amount) > 0 ? 'in' : 'out';
}

/**
 * One row in words. The kind, the tracking code, the counterparty and the initiator each say a
 * part; what none of them says, the row says is missing.
 * @returns {{ title: string, sub: string, who: string }}
 */
export function rowWords(tx, self, agents) {
  const code = String(tx.tracking_code || '');
  const parts = code.split(':');
  const amount = Number(tx.amount) || 0;
  const cp = tx.counterparty_gaii || '';
  const cpSelf = !!cp && !!self && (cp === self || ownerOf(cp) === ownerOf(self));
  const cpName = cp ? shortName(cp) : '';
  const kind = rowKind(tx);
  let title;
  if (kind === 'granted') {
    title = x('kind.' + (tx.type === 'daily_allowance' ? 'allowance' : tx.type));
  } else if (parts[0] === 'exchange' && (parts[1] === 'apptool' || parts[1] === 'agentwork') && parts[2]) {
    const slash = parts[2].indexOf('/');
    const owner = slash > 0 ? parts[2].slice(0, slash) : '';
    const name = slash > 0 ? parts[2].slice(slash + 1) : parts[2];
    const tool = parts[1] === 'apptool';
    if (amount > 0) title = cpSelf ? x(tool ? 'row.toolSelf' : 'row.agentSelf', { name }) : x(tool ? 'row.toolUsed' : 'row.agentUsed', { name });
    else title = cpSelf || owner === ownerOf(self) ? x(tool ? 'row.toolSelf' : 'row.agentSelf', { name }) : x(tool ? 'row.toolPaid' : 'row.agentPaid', { name, owner });
  } else if (parts[0] === 'ext' && parts[1]) {
    title = amount > 0 ? x('row.extEarned', { ext: parts[1], action: parts[2] || '' }) : x('row.extPaid', { ext: parts[1], action: parts[2] || '' });
  } else if (parts[0] === 'exchange' && parts[1]) {
    const what = [parts[1], parts[2]].filter(Boolean).join(' · ');
    title = amount > 0 ? x('row.dataSold', { what }) : x('row.dataBought', { what });
  } else if (parts[0] === 'beneficiary') title = x('row.share');
  else if (tx.type === 'commerce_earn') title = x('row.saleEarned');
  else if (tx.type === 'commerce_spend') title = x('row.purchase');
  else if (tx.type === 'marketplace_fee') title = x('row.listingFee');
  else if (tx.type === 'org_offer_earn') title = x('row.offerEarned');
  else if (tx.type === 'org_offer_spend') title = x('row.offerPaid');
  else title = amount > 0 ? x('row.earned') : x('row.spent');

  const agent = tx.initiator_gaii ? (agents || []).find((a) => a.gaii === tx.initiator_gaii) : null;
  const who = tx.initiator_gaii ? x('row.byAgent', { name: agent?.name || shortName(tx.initiator_gaii) }) : '';
  const sub = [who, cpName && !cpSelf ? x('row.with', { name: cpName }) : '', code || x('row.noCode')].filter(Boolean).join(' · ');
  return { title, sub, who };
}

/**
 * Where the morsels came from and went to: rows grouped by their words, the biggest first, the
 * tail folded into one line. Returns { in: [...], out: [...] } with { title, count, sum }.
 */
export function sourcesOf(rows, self, agents, top = 4) {
  const group = (list) => {
    const by = new Map();
    for (const tx of list) {
      const w = rowWords(tx, self, agents);
      const slot = by.get(w.title) || { title: w.title, count: 0, sum: 0 };
      slot.count += 1;
      slot.sum += Math.abs(Number(tx.amount) || 0);
      by.set(w.title, slot);
    }
    const all = [...by.values()].sort((a, b) => b.sum - a.sum);
    if (all.length <= top + 1) return all;
    const head = all.slice(0, top);
    const rest = all.slice(top);
    head.push({ title: x('sourcesRest', { n: rest.length }), count: rest.reduce((s, r) => s + r.count, 0), sum: rest.reduce((s, r) => s + r.sum, 0), rest: true });
    return head;
  };
  const real = rows.filter((tx) => !GRANTED.has(tx.type));
  return { in: group(real.filter((tx) => Number(tx.amount) > 0)), out: group(real.filter((tx) => Number(tx.amount) < 0)) };
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuAccount')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.wallet')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('usage')}><i>→</i>${t('profile.tabs.usage')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('pnl')}><i>→</i>${t('profile.tabs.pnl')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('offers')}><i>→</i>${t('profile.tabs.offers')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>`;
}
