/**
 * @file public/views/appcat/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the catalogue's page shows, worked out from the listing and nothing else: an app's
 *   name, icon, words in the page's language and its facts; the seven "something missing" conditions
 *   (the keys the profile's Apps page counts and links here with ?filter=); the state, tag, search and
 *   order filters with their counts; the small formats (size, date, number; the dates and counts in
 *   the reader's own format through /js/format.js, the site's rule). Pure functions over the
 *   store's rows, so every list and the rail read the same answers (the old render.js, rows.js and
 *   server-io.js rules, features.md F19–F20, F32–F33, F46, F73–F76, F156–F161).
 * @structure KUNTO_KEYS · STATES · appName · appIcon · appDesc · appTags · shipsAgents · kunto(sa, bound) ·
 *   stateOf(sa) · tagCounts(rows) · filterRows(rows, f) · sortRows(rows, mode) · stateCounts(rows, bound) ·
 *   fmtKb(bytes) · fmtDate(iso) · fmtNum(n) · host()
 * @usage import { filterRows, sortRows } from '/views/appcat/model.js';
 * @version-history
 *   v1.0.1 — 2026-09-27 — The own list's search reads the manifest's description, as the old one did
 *     (appcat parity).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell), from the old catalogue's rules.
 */
import { lang } from '/views/appcat/i18n.js';
import { num, date } from '/js/format.js';

/** The condition rows, in the rail's order; the keys are the contract with the profile's Apps page (F161, F288). */
export const KUNTO_KEYS = ['noMap', 'noAi', 'specOff', 'seoOff', 'stale60', 'noShot', 'noSkill'];
/** The state rows (F160). */
export const STATES = ['listed', 'unlisted', 'draft'];

const man = (sa) => (sa && sa.manifest) || {};

/** The app's name: the manifest's, else its filename. */
export const appName = (sa) => man(sa).name || sa.filename || '';
/** The app's own icon where it has one, else 📝 (the old rows' fallback). */
export const appIcon = (sa) => sa.icon || man(sa).icon || '\u{1F4DD}';
/** What the app does, in the page's language when it says it there (F33). */
export const appDesc = (sa) => { const m = man(sa); return (m.descriptions && m.descriptions[lang()]) || m.description || ''; };
/** The app's tags. */
export const appTags = (sa) => (Array.isArray(man(sa).tags) ? man(sa).tags : []);
/** Whether the manifest declares bundled agents (F36, F46). */
export const shipsAgents = (sa) => { const c = man(sa).cortex; return !!(c && Array.isArray(c.agents) && c.agents.length); };

/**
 * The seven things an own app can be missing (F161): no data map, no word on AI use, an old build
 * guide, not found by search engines, no change in 60 days, no screenshot, no skill.
 * @param {any} sa a listing row
 * @param {Set<string>} bound the "owner/filename" refs a skill is bound to
 */
export function kunto(sa, bound) {
  const m = man(sa);
  const spec = sa.spec_check && sa.spec_check.status;
  const age = sa.created_at ? Date.now() - Date.parse(sa.created_at) : 0;
  return {
    noMap: !(sa.data_map && sa.data_map.missing === false),
    noAi: !(sa.ai_posture || m.aiPosture),
    specOff: spec === 'missing' || spec === 'stale',
    seoOff: sa.seo_state === 'off',
    stale60: age > 60 * 864e5,
    noShot: !sa.has_screenshot,
    noSkill: !bound.has((sa.owner || '') + '/' + (sa.filename || '')),
  };
}

/** 'unlisted' (parked) or 'listed' (published, not parked). */
export const stateOf = (sa) => (sa.parked ? 'unlisted' : 'listed');

/** The counts the rail and the band say for the own list: listed, unlisted, draft waiting, opens, and each condition. */
export function stateCounts(rows, bound) {
  const c = { listed: 0, unlisted: 0, draft: 0, opens: 0, kunto: Object.fromEntries(KUNTO_KEYS.map((k) => [k, 0])) };
  for (const sa of rows) {
    if (sa.parked) c.unlisted++; else c.listed++;
    if (sa.has_draft) c.draft++;
    c.opens += sa.downloads || 0;
    const k = kunto(sa, bound);
    for (const key of KUNTO_KEYS) if (k[key]) c.kunto[key]++;
  }
  return c;
}

/**
 * The tags of a list with their counts (F20, F159): one tag per spelling ignoring case, the first
 * spelling seen wins, sorted by count and then by name.
 * @returns {{ key: string, label: string, n: number }[]}
 */
export function tagCounts(rows) {
  const counts = {}; const casing = {};
  for (const sa of rows) {
    const seen = {};
    for (const tg of appTags(sa)) {
      const lc = String(tg).toLowerCase();
      if (seen[lc]) continue;
      seen[lc] = true;
      if (!(lc in casing)) casing[lc] = String(tg);
      counts[lc] = (counts[lc] || 0) + 1;
    }
  }
  return Object.keys(counts).sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b)).map((k) => ({ key: k, label: casing[k], n: counts[k] }));
}

/**
 * The rows a list shows under the filters (F73–F75): the tag (exact, ignoring case), the state or
 * condition row (the own list only), and the search (the name, what it does, a tag; for the other
 * two lists the name, the tags and the words, as the old data-filter held them).
 * @param {any[]} rows
 * @param {{ tag?: string|null, state?: string|null, q?: string, bound?: Set<string>, own?: boolean }} f
 */
export function filterRows(rows, f) {
  let out = rows;
  if (f.tag) { const at = f.tag.toLowerCase(); out = out.filter((sa) => appTags(sa).some((tg) => String(tg).toLowerCase() === at)); }
  if (f.own && f.state) {
    if (f.state === 'listed') out = out.filter((sa) => !sa.parked);
    else if (f.state === 'unlisted') out = out.filter((sa) => !!sa.parked);
    else if (f.state === 'draft') out = out.filter((sa) => !!sa.has_draft);
    else if (KUNTO_KEYS.includes(f.state)) out = out.filter((sa) => kunto(sa, f.bound || new Set())[f.state]);
  }
  const q = (f.q || '').trim().toLowerCase();
  if (q) {
    out = out.filter((sa) => {
      if (f.own) {
        // The own list searched the manifest's own description, not the words in the page's
        // language (render.js: app.description).
        return appName(sa).toLowerCase().includes(q) || String(man(sa).description || '').toLowerCase().includes(q)
          || appTags(sa).some((tg) => String(tg).toLowerCase().includes(q));
      }
      const text = (appName(sa) + ' ' + appTags(sa).map((tg) => String(tg).toLowerCase()).join(' ') + (appDesc(sa) ? ' ' + appDesc(sa) : '')).toLowerCase();
      return text.includes(q);
    });
  }
  return out;
}

/** The order (F76): newest keeps the node's order; most opened by downloads; A → Z by name. */
export function sortRows(rows, mode) {
  const list = rows.slice();
  if (mode === 'opens') list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else if (mode === 'name') list.sort((a, b) => String(appName(a)).localeCompare(String(appName(b)), undefined, { sensitivity: 'base' }));
  return list;
}

/** "260 kB" from a byte count; empty when unknown (rows.js fmtKb). */
export function fmtKb(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1000) return Math.round(kb) + ' kB';
  return (Math.round(kb / 102.4) / 10) + ' MB';
}

/** A short date in the reader's own format (the site's formatter); empty when unknown. */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : date(iso);
}

/** A count in the reader's own format. */
export const fmtNum = (n) => num(Number(n || 0));

/** This node's host without a leading "apps." (the masthead's line, F22). */
export const host = () => (typeof location !== 'undefined' ? location.host.replace(/^apps\./, '') : '');
