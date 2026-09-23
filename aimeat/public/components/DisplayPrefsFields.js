/**
 * @file public/components/DisplayPrefsFields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two settings that are not the language: how this person writes a date and a
 *   number, and which clock they read.
 *
 *   THEY SIT BESIDE THE LANGUAGE AND ARE NOT IT. The pill at the top of the page decides which
 *   words appear. These decide how a date is written and which clock a time is in, and a person is
 *   free to mix all three — Finnish words, an American date format and a Tokyo clock is a
 *   legitimate combination, the same way an operating system lets you set display language,
 *   regional format and time zone independently.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   "FOLLOW MY BROWSER" IS THE DEFAULT AND IT IS A REAL CHOICE, not an empty one. It is the first
 *   option in both lists, it says what the browser currently answers, and choosing it clears the
 *   stored value. Nobody is pushed into a preference by opening this dialog.
 *
 *   THE ZONE IS PICKED BY CITY, with its offset in brackets. People orient themselves by place
 *   rather than by UTC offset, which is the standing advice in the time-zone design checklists;
 *   the offset rides along because it is what makes "Europe/Helsinki" mean something to somebody
 *   who has never seen an IANA name. The list comes from the browser's own ICU data, so it is
 *   always the zones this runtime can actually format with, and it needs no bundled table.
 * @structure DisplayPrefsFields({ region, timezone, onChange })
 * @usage
 *   import { DisplayPrefsFields } from '/components/DisplayPrefsFields.js';
 *   html`<${DisplayPrefsFields} region=${r} timezone=${z} onChange=${(k, v) => set(k, v)} />`
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the profile's region and timezone fields.
 */
import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback, vars) => { const v = t(key, vars); return v && v !== key ? v : fallback; };

/**
 * The formats offered by name. Deliberately a short, recognisable list rather than every tag ICU
 * knows: a person choosing how their dates look wants to recognise their own country, not to read
 * eight hundred rows. Anything else is reachable by leaving it on "follow my browser" and setting
 * it there, which is where a person who cares that much has already set it.
 */
const REGIONS = [
  ['fi-FI', 'Suomi'], ['sv-SE', 'Sverige'], ['en-GB', 'United Kingdom'], ['en-US', 'United States'],
  ['de-DE', 'Deutschland'], ['fr-FR', 'France'], ['es-ES', 'España'], ['it-IT', 'Italia'],
  ['nl-NL', 'Nederland'], ['pt-BR', 'Brasil'], ['pl-PL', 'Polska'], ['et-EE', 'Eesti'],
  ['da-DK', 'Danmark'], ['nb-NO', 'Norge'], ['is-IS', 'Ísland'], ['ja-JP', '日本'],
];

/**
 * What the list shows before anybody searches. Not a ranking and not a limit: the search reaches
 * every zone the runtime knows, and this is only what a person sees when they have typed nothing.
 */
const COMMON = [
  'Europe/Helsinki', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Tallinn',
  'Europe/Riga', 'Europe/Vilnius', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
  'Europe/Madrid', 'Europe/Paris', 'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin',
  'Europe/Zurich', 'Europe/Vienna', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Rome',
  'Europe/Athens', 'Europe/Bucharest', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Moscow',
  'Atlantic/Reykjavik', 'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Jerusalem',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
];

/** Every zone this runtime can format with, or a short fallback when the list is unavailable. */
function allZones() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(list) && list.length) return list;
  } catch (err) { swallowed('DisplayPrefsFields: supportedValuesOf', err); }
  return ['UTC', 'Europe/Helsinki', 'Europe/Stockholm', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
}

/** "GMT+3" for a zone, right now. The thing that makes an IANA name mean something to a reader. */
function offsetOf(zone) {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch (err) {
    swallowed('DisplayPrefsFields: offsetOf', err);
    return '';
  }
}

/** "Europe/Helsinki" → "Helsinki", so the search matches what a person would type. */
const cityOf = (zone) => String(zone).split('/').pop().replace(/_/g, ' ');

/**
 * How the chosen format and clock actually read.
 *
 * IT BUILDS ITS OWN CALL because it previews a choice NOT YET SAVED, and format.js reads the saved
 * one. So it has to repeat the app's option bags rather than invent its own: a bare
 * `toLocaleString()` here produced "12.9.2026 klo 18.36.46" beside a page reading "12.9.2026
 * 18.32", promising a shape the app never produces. These two bags are the ones the date and time
 * helpers across the profile pages pass, so the sample shows what the reader will actually get.
 * Found by driving the browser, twice.
 */
/** @type {Intl.DateTimeFormatOptions} */
const SAMPLE_DATE = { day: 'numeric', month: 'numeric', year: 'numeric' };
/** @type {Intl.DateTimeFormatOptions} */
const SAMPLE_TIME = { hour: '2-digit', minute: '2-digit' };

function sample(region, timezone) {
  try {
    const at = new Date();
    const tag = region || undefined;
    const zone = timezone ? { timeZone: timezone } : {};
    const day = at.toLocaleDateString(tag, { ...SAMPLE_DATE, ...zone });
    const clock = at.toLocaleTimeString(tag, { ...SAMPLE_TIME, ...zone });
    const n = (1234567.89).toLocaleString(tag);
    return `${day} ${clock} · ${n}`;
  } catch (err) {
    swallowed('DisplayPrefsFields: sample', err);
    return '';
  }
}

export function DisplayPrefsFields({ region, timezone, onChange }) {
  const [zoneQuery, setZoneQuery] = useState('');
  const zones = useMemo(allZones, []);

  const browserZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (err) { swallowed('DisplayPrefsFields: browser zone', err); return 'UTC'; }
  }, []);
  const browserRegion = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en'; }
    catch (err) { swallowed('DisplayPrefsFields: browser region', err); return 'en'; }
  }, []);

  /*
   * The list, and the two things it has to get right.
   *
   * THE CHOSEN ZONE IS ALWAYS IN IT. Slicing an alphabetical list at sixty stops at
   * `America/Argentina/Salta`, so a person on Europe/Helsinki opened this and saw an empty box:
   * their own setting was not among the options, so the select had nothing to select. They could
   * not see what they had chosen without typing it in again.
   *
   * AND AN UNSEARCHED LIST IS BROWSABLE. Four hundred-odd zones in one alphabetical run is a
   * search box with a decoration under it; a short list of the ones people actually pick is a
   * list somebody can use, with the search there for everything else.
   */
  const matches = useMemo(() => {
    const q = zoneQuery.trim().toLowerCase();
    const found = q
      ? zones.filter(z => z.toLowerCase().includes(q) || cityOf(z).toLowerCase().includes(q)).slice(0, 60)
      : COMMON.filter(z => zones.includes(z));
    // The reader's own choice is never missing from the list that is supposed to show it.
    return timezone && !found.includes(timezone) ? [timezone, ...found] : found;
  }, [zones, zoneQuery, timezone]);

  return html`
    <label class="pf-edit-label">
      ${tr('profile.prefs.region', 'How your dates and numbers are written')}
      <select class="pf-edit-select" value=${region || ''}
        onChange=${(e) => onChange('region', e.target.value)}>
        <option value="">${tr('profile.prefs.followBrowser', 'Follow my browser ({what})', { what: browserRegion })}</option>
        ${REGIONS.map(([tag, name]) => html`<option key=${tag} value=${tag}>${name} (${tag})</option>`)}
      </select>
      <div class="pf-edit-hint">${tr('profile.prefs.regionHint',
    'Separate from the language above. The language decides which words you read; this decides whether a date is 9/12/2026 or 12.9.2026.')}</div>
    </label>

    <label class="pf-edit-label">
      ${tr('profile.prefs.timezone', 'Your time zone')}
      <input type="search" class="pf-edit-input" value=${zoneQuery}
        placeholder=${tr('profile.prefs.zoneSearch', 'Search for a city: Helsinki, Madrid, Tokyo…')}
        onInput=${(e) => setZoneQuery(e.target.value)} />
      <select class="pf-edit-select" value=${timezone || ''} size="1"
        onChange=${(e) => onChange('timezone', e.target.value)}>
        <option value="">${tr('profile.prefs.followBrowserZone', 'Follow my browser ({what})',
    { what: `${cityOf(browserZone)} ${offsetOf(browserZone)}` })}</option>
        ${matches.map(z => html`<option key=${z} value=${z}>${cityOf(z)} — ${z} (${offsetOf(z)})</option>`)}
      </select>
      <div class="pf-edit-hint">${tr('profile.prefs.timezoneHint',
    'Times are shown in this clock everywhere, including in email this site sends you, where your browser cannot be asked.')}</div>
    </label>

    <div class="pf-edit-label">
      ${tr('profile.prefs.sample', 'Right now, that reads')}
      <div class="pf-edit-readonly">${sample(region, timezone)}</div>
    </div>`;
}
