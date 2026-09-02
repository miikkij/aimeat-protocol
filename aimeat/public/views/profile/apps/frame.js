/**
 * @file public/views/profile/apps/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Apps page's views share: the words (a), dates, the app's name and address,
 *   the launcher address with the profile's language and a filter or a search, the seven condition
 *   keys the launcher and this page agree on, the condition flags of one app and the counts over
 *   all of them, the note a row wears, a line-level diff of a draft against the live version, the
 *   crumb and the cross-page rail links.
 * @structure a · day · rel · kb · nameOf · appRef · appUrl · catalogUrl · KUNTO_KEYS · flagsOf ·
 *   computeKunto · noteFor · lineDiff · initials · crumb · pageLinks · goTab
 * @usage import { a, computeKunto, catalogUrl, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (design canvas "AIMEAT Sovellukset-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const a = (key, vars) => t('appspage.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };
export const kb = (bytes) => Math.round((bytes || 0) / 1024);
export const nameOf = (app) => app?.manifest?.name || String(app?.filename || '').replace(/\.html?$/i, '');
export const appRef = (app) => `${app.owner}/${app.filename}`;

/** The served app, top-level on its origin; an own protected app carries its code, or the owner lands on the unlock page. */
export const appUrl = (app) => `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}?mode=inline${app.access_code ? `&code=${encodeURIComponent(app.access_code)}` : ''}`;

/**
 * The launcher, opened in the profile's language, on one filter (a state or a condition key) or
 * with an app's name already in the search. The launcher has Finnish and English; Spanish reads
 * English there until it has its own table.
 */
export function catalogUrl(params = {}) {
  const q = new URLSearchParams();
  q.set('lang', getLocale() === 'fi' ? 'fi' : 'en');
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
  return '/app-catalog.html?' + q.toString();
}

/**
 * The seven things an app can be missing, in the order the page lists them. The launcher's rail
 * counts the same seven under the same keys, which is what lets a number here open exactly those
 * rows there (?filter=<key>).
 */
export const KUNTO_KEYS = ['noMap', 'noAi', 'specOff', 'seoOff', 'stale60', 'noShot', 'noSkill'];

/** One app's flags. `bound` maps "owner/filename" to the skills bound to it. */
export function flagsOf(app, bound) {
  const posture = app.ai_posture || app.manifest?.aiPosture || null;
  const spec = app.spec_check?.status;
  const age = app.created_at ? Date.now() - Date.parse(app.created_at) : 0;
  return {
    noMap: !(app.data_map && app.data_map.missing === false),
    noAi: !posture,
    specMissing: spec === 'missing',
    specStale: spec === 'stale',
    specOff: spec === 'missing' || spec === 'stale',
    seoOff: app.seo_state === 'off',
    seoOn: app.seo_state === 'on',
    stale60: age > 60 * 864e5,
    noShot: !app.has_screenshot,
    noSkill: !(bound[appRef(app)] || []).length,
    usesAi: !!posture?.usesAi,
    discloses: !!posture?.discloses,
    parked: !!app.parked,
  };
}

/**
 * The condition rows over every app: per key, how many apps carry it, and the facts the row's
 * line under it quotes (the other side of each count). Also the flags per app, for the notes.
 */
export function computeKunto(apps, bound) {
  const flags = {};
  const n = Object.fromEntries(KUNTO_KEYS.map((k) => [k, 0]));
  const facts = { usesAi: 0, discloses: 0, specMissing: 0, specStale: 0, seoOn: 0, unlisted: 0, withSkill: 0, skills: 0 };
  for (const app of apps) {
    const f = flagsOf(app, bound);
    flags[appRef(app)] = f;
    for (const k of KUNTO_KEYS) if (f[k]) n[k]++;
    if (f.usesAi) facts.usesAi++;
    if (f.discloses) facts.discloses++;
    if (f.specMissing) facts.specMissing++;
    if (f.specStale) facts.specStale++;
    if (f.seoOn) facts.seoOn++;
    if (f.parked) facts.unlisted++;
    const skills = bound[appRef(app)] || [];
    if (skills.length) { facts.withSkill++; facts.skills += skills.length; }
  }
  const rows = KUNTO_KEYS.map((key) => ({ key, n: n[key], loud: key === 'noMap' || key === 'noAi' })).filter((r) => r.n > 0);
  return { rows, flags, facts, total: apps.length };
}

/**
 * The one note a row in "last changed" wears, from the same words the condition rows use. An app
 * acting in the owner's name comes first, because that is the one thing on this page that is not
 * a defect. Then the defects in the order a builder would fix them; then nothing.
 */
export function noteFor(app, flags, grantRefs, legalCount) {
  if (grantRefs.has(appRef(app))) return a('noteGrant');
  if (flags.specStale) return a('noteSpecStale');
  if (flags.specMissing) return a('noteSpecMissing');
  if (flags.noShot) return a('noteNoShot');
  if (flags.noMap) return a('noteNoMap');
  if (flags.noAi) return a('noteNoAi');
  if (flags.parked) return a('noteUnlisted');
  if (legalCount) return a('noteLegal', { n: legalCount });
  return a('noteOk');
}

/**
 * The lines a draft adds and removes against the live version. A multiset difference, not an
 * alignment: it says WHAT changed, which is the question before publishing, and costs nothing on
 * a 400 kB file. Duplicated lines (a blank, a closing brace) cancel out by count.
 */
export function lineDiff(liveText, draftText) {
  const count = (text) => {
    const m = new Map();
    for (const line of String(text || '').split('\n')) m.set(line, (m.get(line) || 0) + 1);
    return m;
  };
  const live = count(liveText);
  const draft = count(draftText);
  const added = [];
  const removed = [];
  let addedTotal = 0;
  let removedTotal = 0;
  for (const [line, c] of draft) { const d = c - (live.get(line) || 0); if (d > 0) { addedTotal += d; if (line.trim() && added.length < 40) added.push(line.trim()); } }
  for (const [line, c] of live) { const d = c - (draft.get(line) || 0); if (d > 0) { removedTotal += d; if (line.trim() && removed.length < 40) removed.push(line.trim()); } }
  return { added, removed, addedTotal, removedTotal };
}

/** The two-letter mark a row wears. */
export function initials(name) {
  const words = String(name || '').trim().split(/[\s-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.apps')}</span></div>`;
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export const goTab = openTab;
export function pageLinks() {
  return html`
    <a class="og-rail-link" href=${catalogUrl()} target="_blank" rel="noopener"><i>→</i>${t('profile.apps.launcherTitle')}<em>→</em></a>
    <button type="button" class="og-rail-link" onClick=${() => openTab('appdev')}><i>→</i>${t('profile.tabs.appDev')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('skills')}><i>→</i>${t('skills.tabLabel')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('portfolio')}><i>→</i>${t('portfolio.tabLabel')}<em>→</em></button>`;
}
