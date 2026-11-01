/**
 * @file public/views/profile/offers/data-model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words and facts the Offers page says about a data product, with no markup: its
 *   freshness as a word and a Status tone, who may use it, its schedule in words (and a schedule from
 *   the wizard's choices back to a cron), the number of a version, and the filter that finds the
 *   products that need a look. Pure functions over what GET /v1/dataproducts and the package reads
 *   answer, so the list, the product page and the wizard say the same thing the same way.
 * @structure d · FRESH_TONE · freshWord · freshTone · needsLook · audienceWord · scheduleWords ·
 *   cronFor · scheduleOf · versionNumber · productTitle · shortHash · bytesWord
 * @usage import { d, freshWord, scheduleWords } from './data-model.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a: the data products of the Offers page).
 */
import { t, tn } from '/js/i18n.js';
import { time as fmtTime, date as fmtDate, num } from '/js/format.js';

/** The data products' words: dataout.<key>; with `n` in the values, in the language's plural form
 *  (`<key>_one` beside `<key>`). */
export const d = (key, vars) => (vars && 'n' in vars ? tn('dataout.' + key, String(vars.n).replace(/\s/g, ''), vars) : t('dataout.' + key, vars));

/** A freshness state as a Status tone (components/Mark.js kind="status"). */
export const FRESH_TONE = { fresh: 'fine', late: 'attention', stale: 'danger', unscheduled: 'off' };
/** The state of a product: its package's freshness, or "not published yet" before the first run. */
export const stateOf = (p) => (p?.freshness?.state) || (p?.package ? 'unscheduled' : 'unpublished');
export const freshWord = (state) => d('fresh.' + state);
export const freshTone = (state) => FRESH_TONE[state] || 'off';
/** Late or out of date: the products whose readers no longer get what was promised. */
export const needsLook = (p) => ['late', 'stale'].includes(stateOf(p));

/** Who may use it, in words: the audience the package carries (or the definition's before a run). */
export function audienceWord(visibility, orgNames = {}) {
  const v = String(visibility || 'private');
  if (v.startsWith('organism:')) {
    const id = v.slice('organism:'.length);
    return d('audience.organismOf', { name: orgNames[id] || id });
  }
  return d('audience.' + (['private', 'members', 'public'].includes(v) ? v : 'private'));
}

const pad = (n) => String(n).padStart(2, '0');
/** "06:00" in the reader's clock for the hour and minute a cron names. */
const clockOf = (h, m) => fmtTime(new Date(2026, 0, 5, Number(h), Number(m)), { hour: '2-digit', minute: '2-digit' });

/**
 * The schedule a cron names, as the wizard makes it: daily "M H * * *", weekly "M H * * D" (D 0-6,
 * Sunday 0), monthly "M H D * *". Anything else is said as the cron itself.
 */
export function scheduleOf(cron) {
  const m = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|\d)$/.exec(String(cron || '').trim());
  if (!m) return null;
  const [, min, hour, dom, dow] = m;
  if (dom === '*' && dow === '*') return { freq: 'daily', time: `${pad(hour)}:${pad(min)}` };
  if (dom === '*') return { freq: 'weekly', day: Number(dow) % 7, time: `${pad(hour)}:${pad(min)}` };
  if (dow === '*') return { freq: 'monthly', day: Number(dom), time: `${pad(hour)}:${pad(min)}` };
  return null;
}

/** A schedule in words: "on Mondays at 06:00", "every day at 06:00", "on day 1 of each month". */
export function scheduleWords(schedule) {
  if (!schedule?.cron) return d('schedule.none');
  const s = scheduleOf(schedule.cron);
  if (!s) return d('schedule.cron', { cron: schedule.cron });
  const [h, m] = s.time.split(':');
  const at = clockOf(h, m);
  if (s.freq === 'daily') return d('schedule.daily', { at });
  if (s.freq === 'weekly') return d('schedule.weekly.' + s.day, { at });
  return d('schedule.monthly', { day: s.day, at });
}

/** The wizard's choice as a cron: null for "once". */
export function cronFor({ freq, day, time }) {
  if (!freq || freq === 'once') return null;
  const [h, m] = String(time || '06:00').split(/[:.]/).map((x) => Math.min(59, Math.max(0, parseInt(x, 10) || 0)));
  const hour = Math.min(23, h);
  if (freq === 'daily') return `${m} ${hour} * * *`;
  if (freq === 'weekly') return `${m} ${hour} * * ${Number(day ?? 1) % 7}`;
  return `${m} ${hour} ${Math.min(28, Math.max(1, Number(day) || 1))} * *`;
}

/** The next run in the reader's format: "Mon 2.11. 06:00". */
export const nextRunWords = (iso) => (iso ? fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ' + fmtTime(iso, { hour: '2-digit', minute: '2-digit' }) : '');

/** The number of a version: the oldest kept is 1. */
export function versionNumber(versions, hash) {
  const list = versions || [];
  const i = list.findIndex((v) => v.contentHash === hash);
  return i < 0 ? list.length : list.length - i;
}

export const productTitle = (p) => p?.title || p?.definition?.title || p?.name || '';
export const shortHash = (h) => String(h || '').replace(/^sha256:/, '').slice(0, 12);
export const bytesWord = (b) => (b >= 1024 * 1024 ? `${num(Math.round(b / 104857.6) / 10)} MB` : b >= 1024 ? `${num(Math.round(b / 102.4) / 10)} kB` : `${num(b || 0)} B`);
