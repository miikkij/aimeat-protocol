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
 *   2026-09-22 -- The crumb is the shared trail's entries and the rail links are shared Actions; no own CSS.
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AppDev: tieto ja kiihdytys", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { Stack, Action, Text } from '/components/poster-parts.js';

export const a = (key, vars) => t('appdevpage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');

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

/** The trail to this page, as Masthead crumbs. */
export function crumb() {
  return [{ label: t('nav.profile') }, { label: t('profile.landing.menuBuildShare') }, { label: t('profile.tabs.appDev') }];
}

const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export const goTab = openTab;
export function pageLinks() {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${a('pages')}<//>
    <${Action} kind="text" onClick=${() => openTab('apps')}>${t('profile.tabs.apps')} →<//>
    <${Action} kind="text" onClick=${() => openTab('skills')}>${t('skills.tabLabel')} →<//>
    <${Action} kind="text" href=${catalogUrl()} target="_blank">${t('profile.apps.launcherTitle')} →<//>
    <${Action} kind="text" onClick=${() => openTab('work')}>${t('profile.tabs.work')} →<//>
  <//>`;
}
