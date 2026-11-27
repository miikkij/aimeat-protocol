/**
 * @file public/views/profile/extensions/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Extensions page's views share: the words (x), dates, the kind an extension
 *   is (used by apps, a background job on a clock, or nothing visible), a schedule's cron in plain
 *   words, the app behind an "owner/filename" reference and its address, the crumb and the
 *   cross-page rail links, what of the person's own needs them (attentionOf), and a refusal in the
 *   page's words (refusalText).
 * @structure x · day · kindOf · attentionOf · refusalText · cronWords · appName · appUrlOf · crumb · pageLinks · goTab
 * @usage import { x, day, kindOf, cronWords, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.2.0 — 2026-11-27 — attentionOf: an own extension that is stopped while a published app calls it,
 *     or whose last scheduled run failed, from the list and the scheduler's jobs the page already
 *     reads. refusalText: a refusal said by its code in the page's words; a code the page has no words
 *     for, or a manifest check that names the field, keeps the server's sentence.
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Laajennukset-sivu", third round, plus
 *     the dependency map and kept versions; brief doc-mtkr34qa1dg1).
 *   v1.1.0 — 2026-09-26 — The crumb and the rail's page links are data for SettingsPage (Crumb, Rail);
 *     openTab is the Rail's (component plan C9, page group G6).
 */
import { t } from '/js/i18n.js';
import { openTab } from '/components/Rail.js';
import { date as fmtDate, dateTime as fmtDateTime } from '/js/format.js';

export const x = (key, vars) => t('extpage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const when = (iso) => (iso ? fmtDateTime(iso, { dateStyle: 'short', timeStyle: 'short' }) : '');

/**
 * The three kinds a server extension is, from the list row alone: apps (or cortexes) call it; it
 * runs on a clock with nobody calling it; or nothing visible uses it (an agent still may, but
 * calls are not recorded, so the page cannot say more).
 */
export function kindOf(ext) {
  const used = ext.used_by || {};
  if ((used.apps || 0) > 0 || (used.cortexes || 0) > 0) return 'apps';
  if ((ext.schedules || []).length > 0) return 'background';
  return 'unseen';
}

/**
 * Why an extension of the person's own needs them, or null: 'stoppedInUse' when it is stopped while a
 * published app or a cortex calls it (the app fails), 'runFailed' when it is active and the last run
 * of one of its schedules failed. `jobs` is GET /v1/schedules `extensions`; while it has not answered
 * it is empty, so nothing is flagged by mistake.
 */
export function attentionOf(ext, jobs) {
  if (ext.status !== 'active') return kindOf(ext) === 'apps' ? 'stoppedInUse' : null;
  const failed = (jobs || []).some((j) => j.extensionName === ext.name && j.lastRunResult && j.lastRunResult !== 'success');
  return failed ? 'runFailed' : null;
}

/** The refusals the page says in its own words; any other code shows the server's sentence. */
const REFUSALS = new Set(['NOT_FOUND', 'FORBIDDEN', 'ALREADY_EXISTS', 'ENCRYPTION_NOT_CONFIGURED', 'EXTENSION_INACTIVE', 'NETWORK_ERROR']);

/**
 * A refusal in the reader's words, chosen by its code. INSUFFICIENT_ROLE keeps the server's sentence
 * when it says why (the install role on this server) and gets the page's words for a bare
 * "Not authorized"; a manifest check (VALIDATION_ERROR, INVALID_INPUT, NAME_MISMATCH, CODE_TOO_LARGE)
 * keeps the server's sentence, which names the field to fix.
 */
export function refusalText(e, fallback) {
  const err = e?.error || e?.response?.error || e || {};
  const code = err.code || e?.code || '';
  const message = err.message || e?.message || '';
  if (REFUSALS.has(code)) return x('refusal.' + code);
  if (code === 'INSUFFICIENT_ROLE' && (!message || message === 'Not authorized')) return x('refusal.INSUFFICIENT_ROLE');
  return message || fallback || t('profile.error');
}

/** A cron line in the reader's words; anything unusual stays as written. */
export function cronWords(cron) {
  if (!cron) return '';
  if (cron === '@activate') return x('cron.activate');
  const m = String(cron).trim().split(/\s+/);
  if (m.length !== 5) return cron;
  const [min, hour, dom, , dow] = m;
  const two = (n) => String(n).padStart(2, '0');
  if (min === '0' && hour === '*' && dom === '*' && dow === '*') return x('cron.hourly');
  if (/^\*\/\d+$/.test(min) && hour === '*') return x('cron.everyMinutes', { n: min.slice(2) });
  if (min === '0' && /^\*\/\d+$/.test(hour)) return x('cron.everyHours', { n: hour.slice(2) });
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow === '*') return x('cron.daily', { time: `${two(hour)}:${two(min)}` });
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && /^\d$/.test(dow)) return x('cron.weekly', { day: x('cron.day' + dow), time: `${two(hour)}:${two(min)}` });
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom)) return x('cron.monthly', { dom, time: `${two(hour)}:${two(min)}` });
  return cron;
}

/** The app's name from an "owner/filename.html" reference: the filename without its extension. */
export const appName = (ref) => String(ref || '').split('/').pop().replace(/\.html?$/i, '');
export const appUrlOf = (ref) => { const [owner, ...rest] = String(ref || '').split('/'); return rest.length ? `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(rest.join('/'))}?mode=inline` : null; };

/** The crumb's steps (components/Crumb.js): the last is the page you are on. */
export function crumb() {
  return [t('nav.profile'), t('profile.landing.menuBuildShare'), t('profile.tabs.extensions')];
}

export const goTab = openTab;
/** The sibling pages in the rail, as data (components/Rail.js): each is → … →. */
export function pageLinks() {
  return [
    { tab: 'apps', label: t('profile.tabs.apps') },
    { tab: 'scheduler', label: t('profile.tabs.scheduler') },
    { tab: 'libraries', label: t('librariesTab.tabLabel') },
    { tab: 'appdev', label: t('profile.tabs.appDev') },
  ];
}
