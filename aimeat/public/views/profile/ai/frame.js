/**
 * @file public/views/profile/ai/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the AI page's views share: the words (x), the six model roles (which
 *   preference field each one is, which pool of the catalogue it picks from, what it does), the
 *   price and context words a person can read, the money and number formats, the 30-day rollup of
 *   the usage history per app, the crumb and the cross-page rail links.
 * @structure x · ROLES · poolFor · modelWords · priceWords · contextWords · money · compact ·
 *   rollup · dateWord · crumb · pageLinks · openTab
 * @usage import { x, ROLES, poolFor } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Tekoäly-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import {
  chatPriceLabel, audioPriceLabel, contextLabel, acceptsImages, answersInText, producesImages, priceVaries, isFree,
} from '/views/profile/openrouter/pricing.js';

export const x = (key, vars) => t('aipage.' + key, vars);

/**
 * The six roles a completion can ask for, in the order the page lists them. `field` is the key in
 * the owner's settings; `pool` names which slice of the catalogue the picker offers; `off` says
 * what an empty setting means (falls back to the default model, or the feature is off).
 */
export const ROLES = [
  { id: 'chat', field: 'model', pool: 'chat', off: 'default' },
  { id: 'reasoning', field: 'reasoningModel', pool: 'chat', off: 'default' },
  { id: 'execution', field: 'executionModel', pool: 'chat', off: 'default' },
  { id: 'vision', field: 'visionModel', pool: 'vision', off: 'off' },
  { id: 'stt', field: 'sttModel', pool: 'transcription', off: 'off' },
  { id: 'image', field: 'imageModel', pool: 'image', off: 'off' },
];

/** The models a role may pick from. */
export function poolFor(role, models, sttModels) {
  if (role.pool === 'transcription') return sttModels || [];
  const all = models || [];
  if (role.pool === 'image') return all.filter(producesImages);
  const text = all.filter(answersInText);
  return role.pool === 'vision' ? text.filter(acceptsImages) : text;
}

/** The catalogue's entry for a chosen id, or null when the list does not carry it. */
export const findModel = (id, list) => (id ? (list || []).find((m) => m.id === id) || null : null);

/** A model's display name without the maker prefix OpenRouter puts before a colon. */
export function modelWords(model, id) {
  if (!model) return id || '';
  const name = String(model.name || model.id);
  const i = name.indexOf(': ');
  return i > 0 ? name.slice(i + 2) : name;
}

/** The price in words, for a chat or an audio model. */
export function priceWords(model, role) {
  if (!model) return '';
  return (role.pool === 'transcription' ? audioPriceLabel(model, t) : chatPriceLabel(model, t)) || '';
}

/** "1 000 k context" as the catalogue says it, or ''. */
export function contextWords(model) {
  const c = contextLabel(model);
  return c ? t('profile.openrouter.price.context', { n: c }) : '';
}

export const modelTraits = (model) => ({
  free: isFree(model), varies: priceVaries(model), images: acceptsImages(model),
});

const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB');

/** "$0.71" in the page's own locale; small figures keep enough decimals to mean something. */
export function money(n) {
  const v = Number(n) || 0;
  const digits = v === 0 ? 2 : v < 0.01 ? 4 : v < 1 ? 3 : 2;
  // en-US rather than en-GB for the currency: the latter prints "US$", which no one reads as a price.
  return new Intl.NumberFormat(getLocale() === 'en' ? 'en-US' : localeTag(), { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** 73306 → "73.3k", 2310965 → "2.3M". */
export function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}

export function dateWord(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'numeric' });
}

/**
 * The 30-day history rolled up: totals, and one row per app with its cost, calls and tokens over
 * the window plus today's figures, sorted by what it cost. Apps that only have a cap and no spend
 * are kept, since the cap is why the row exists.
 */
export function rollup(history, usage, quotas) {
  const days = (history && Array.isArray(history.days)) ? history.days : [];
  const byApp = new Map();
  const add = (app, v) => {
    const row = byApp.get(app) || { app, cost: 0, calls: 0, tokens: 0, seconds: 0, today: 0, todayCalls: 0 };
    row.cost += Number(v?.cost_usd) || 0;
    row.calls += Number(v?.calls) || 0;
    row.tokens += Number(v?.tokens) || 0;
    row.seconds += Number(v?.audio_seconds) || 0;
    byApp.set(app, row);
  };
  let cost = 0, calls = 0, tokens = 0, maxDay = null;
  for (const d of days) {
    cost += Number(d.total_cost_usd) || 0;
    calls += Number(d.total_calls) || 0;
    tokens += Number(d.total_tokens) || 0;
    if (!maxDay || (Number(d.total_cost_usd) || 0) > maxDay.cost) maxDay = { date: d.date, cost: Number(d.total_cost_usd) || 0 };
    for (const [app, v] of Object.entries(d.per_app || {})) add(app, v);
  }
  for (const [app, v] of Object.entries(usage?.per_app || {})) {
    const row = byApp.get(app) || (add(app, {}), byApp.get(app));
    row.today = Number(v?.cost_usd) || 0;
    row.todayCalls = Number(v?.calls) || 0;
  }
  for (const app of Object.keys(quotas || {})) if (!byApp.has(app)) add(app, {});
  const apps = [...byApp.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  return { days: days.length, first: days[0]?.date || '', last: days[days.length - 1]?.date || '', cost, calls, tokens, maxDay, apps };
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('profile.generator.openrouter.title')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks(navigate) {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('usage')}><i>→</i>${t('profile.tabs.usage')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => navigate('/v1/chat')}><i>→</i>${t('nav.chat')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>`;
}
