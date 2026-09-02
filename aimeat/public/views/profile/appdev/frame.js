/**
 * @file public/views/profile/appdev/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the AppDev page's views share: the words (a), dates, the labels an area, a
 *   severity and a start mode wear, the app behind an "owner/filename" reference and its address,
 *   the launcher address in the profile's language, the crumb and the cross-page rail links.
 * @structure a · locale · day · areaLabel · sevLabel · modeLabel · appName · appUrl · catalogUrl ·
 *   crumb · pageLinks · goTab
 * @usage import { a, day, areaLabel, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AppDev: tieto ja kiihdytys", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const a = (key, vars) => t('appdevpage.' + key, vars);
export const locale = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale()) : '');

/**
 * The areas agents file an entry under are free words (app, data, ext, publish, mobile, audio…).
 * The ones the platform names get a word in the reader's language; any other stays as written,
 * because it is the agent's own word and the filter still works on it.
 */
const AREAS = ['app', 'auth', 'ext', 'cortex', 'iam', 'realtime', 'ai', 'mobile', 'publish', 'data', 'design', 'audio', 'memory', 'i18n', 'workflow', 'outbound', 'boards', 'atelier', 'group-apps'];
export const areaLabel = (key) => (AREAS.includes(key) ? a('area.' + key) : key);
export const sevLabel = (sev) => a('sev.' + (sev === 'critical' || sev === 'info' ? sev : 'warn'));
export const modeLabel = (mode) => a('mode.' + (mode === 'fork' || mode === 'scaffold' ? mode : 'either'));

/** The app's name from an "owner/filename.html" reference: the filename without its extension. */
export const appName = (ref) => String(ref || '').split('/').pop().replace(/\.html?$/i, '');
export const appUrl = (owner, filename) => `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline`;
export const appUrlOf = (ref) => { const [owner, ...rest] = String(ref || '').split('/'); return rest.length ? appUrl(owner, rest.join('/')) : null; };

/** The launcher, in the profile's language (it has Finnish and English). */
export function catalogUrl(params = {}) {
  const q = new URLSearchParams();
  q.set('lang', getLocale() === 'fi' ? 'fi' : 'en');
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
  return '/app-catalog.html?' + q.toString();
}

/** The build prompt as a file, in the profile's language; a same-origin link, so no fetch. */
export const buildPromptFileUrl = () => `/v1/prompts/build-app?format=txt${getLocale() === 'fi' ? '&lang=fi' : ''}`;

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.appDev')}</span></div>`;
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export const goTab = openTab;
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('skills')}><i>→</i>${t('skills.tabLabel')}<em>→</em></button>
    <a class="og-rail-link" href=${catalogUrl()} target="_blank" rel="noopener"><i>→</i>${t('profile.apps.launcherTitle')}<em>→</em></a>
    <button type="button" class="og-rail-link" onClick=${() => openTab('work')}><i>→</i>${t('profile.tabs.work')}<em>→</em></button>`;
}
