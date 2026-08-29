/**
 * @file public/views/profile/scheduler/cron-words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A cron expression said in words, in the reader's language: "every day at 07:00",
 *   "Mondays at 05:00", "day 1 of every month at 05:00", "2 Jan, 2 Apr, 2 Jul, 2 Oct at 09:00". The
 *   cron string stays beside it as evidence; this is what a person reads. A shape the function does
 *   not recognise comes back as the cron itself, so nothing is ever mistranslated into a wrong time.
 * @structure cronWords(cron) · timeOfCron(cron) · withTime(cron, hhmm)
 * @usage import { cronWords } from './cron-words.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial, for the scheduler in the poster face.
 */
import { t, getLocale } from '/js/i18n.js';

const w = (key, vars) => t('profile.scheduler.words.' + key, vars);
const loc = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-CO' : 'en-GB');
const two = (n) => String(n).padStart(2, '0');
const step = (f) => { const m = /^\*\/(\d+)$/.exec(f); return m ? Number(m[1]) : null; };
const list = (f) => (/^\d+(,\d+)*$/.test(f) ? f.split(',').map(Number) : null);

/** Short weekday names in the reader's language, Monday first; index 0 = Sunday to match cron. */
function weekdayName(d) {
  const sunday = new Date(2024, 0, 7); // a Sunday
  const date = new Date(sunday); date.setDate(sunday.getDate() + (d % 7));
  return date.toLocaleDateString(loc(), { weekday: 'short' });
}
function dowLabel(f) {
  const range = /^(\d)-(\d)$/.exec(f);
  const days = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i) : list(f);
  if (!days || days.some(d => d < 0 || d > 7)) return null;
  return days.map(weekdayName).join(', ');
}
function dateLabel(d, m) {
  return new Date(2024, m - 1, d).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
}

/** @param {string} cron @returns {string} the cadence in words, or the cron itself when it has no plain reading */
export function cronWords(cron) {
  if (!cron) return '';
  if (cron === '@activate') return w('onActivate');
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [mi, ho, dom, mon, dow] = p;
  const restStar = dom === '*' && mon === '*' && dow === '*';
  if (mi === '*' && ho === '*' && restStar) return w('everyMinute');
  if (step(mi) && ho === '*' && restStar) return w('everyNMin', { n: step(mi) });
  const mins = list(mi);
  if (mins && mins.length === 1 && ho === '*' && restStar) return w('hourly');
  if (mins && mins.length === 1 && step(ho) && restStar) return w('everyNHours', { n: step(ho) });
  const hours = list(ho);
  if (!mins || mins.length !== 1 || !hours) return cron;
  const at = hours.map(h => `${two(h)}:${two(mins[0])}`).join(', ');
  if (dom === '*' && mon === '*') {
    if (dow === '*') return w('dailyAt', { t: at });
    if (dow === '1-5') return w('weekdaysAt', { t: at });
    const d = dowLabel(dow);
    return d ? w('onDaysAt', { d, t: at }) : cron;
  }
  const doms = list(dom);
  if (doms && mon === '*' && dow === '*') return w('monthlyOn', { d: doms.join(', '), t: at });
  const mons = list(mon);
  if (doms && mons && dow === '*') {
    const dates = mons.flatMap(m => doms.map(d => dateLabel(d, m))).join(', ');
    return w('onDatesAt', { d: dates, t: at });
  }
  return cron;
}

/** "HH:MM" when the cron names one minute and one hour, else ''. Feeds the time field of the form. */
export function timeOfCron(cron) {
  const p = String(cron || '').trim().split(/\s+/);
  if (p.length !== 5) return '';
  const mins = list(p[0]); const hours = list(p[1]);
  if (!mins || mins.length !== 1 || !hours || hours.length !== 1) return '';
  return `${two(hours[0])}:${two(mins[0])}`;
}

/** The same cron with its minute and hour replaced by "HH:MM"; the cron unchanged when it has no single time. */
export function withTime(cron, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  const p = String(cron || '').trim().split(/\s+/);
  if (!m || p.length !== 5 || !timeOfCron(cron)) return cron;
  return [String(Number(m[2])), String(Number(m[1])), p[2], p[3], p[4]].join(' ');
}
