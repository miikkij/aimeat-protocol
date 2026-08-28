/**
 * @file changelog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The whole change log as a page (/v1/changelog): every entry of /changelog.json,
 *   newest first, with a month rail, a filter by kind, a search, and an address per entry. The
 *   same file the front page folds into one line (landing-changelog.js), read the same way and
 *   rendered in the showroom's language, so shipping a change and announcing it stay one edit.
 *
 *   NOTHING HERE IS NEW DATA. The page is a reading of a file that already exists; the month
 *   counts, the kind counts and the anchors are all derived from it in the browser. An entry's
 *   address is its date plus its position among that day's entries, which is stable as long as
 *   the file keeps newest-first order within a day, the rule the file header already states.
 * @structure monthKey · monthLabel · entryId · default export Changelog({ navigate })
 * @usage routed at /v1/changelog by spa.html; listed in routes/portal.ts spaRoutes
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "Changelog and Build Story".
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale, onLocaleChange } from '/js/i18n.js';
import { pick, fmtDate, KIND_LABEL } from '/views/landing-changelog.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const KINDS = ['feature', 'fix', 'security', 'notice'];

/** "2026-08-28" → "2026-08", the rail's unit. */
function monthKey(date) { return String(date || '').slice(0, 7); }

/** "2026-08" → "August 2026" in the app's language, the same rule fmtDate follows. */
function monthLabel(key, lang) {
  try {
    const d = new Date(key + '-01T12:00:00Z');
    return isNaN(d.getTime()) ? key : d.toLocaleDateString(lang === 'fi' ? 'fi-FI' : 'en-GB', { month: 'long', year: 'numeric' });
  } catch (err) { swallowed('changelog: monthLabel', err); return key; }
}

/** The address of an entry: its date, then its position among that day's entries. */
function entryId(entries, index) {
  const date = entries[index]?.date || 'undated';
  let n = 0;
  for (let i = 0; i < index; i++) if (entries[i]?.date === date) n++;
  return n === 0 ? date : `${date}-${n + 1}`;
}

export default function Changelog({ navigate }) {
  const [entries, setEntries] = useState(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  // The entries carry their own translations, so a language switch re-renders them.
  const [lang, setLang] = useState(getLocale());
  useEffect(() => onLocaleChange(() => setLang(getLocale())), []);

  useEffect(() => {
    // window.__B is the server's "?v=BUILD_ID" cache-buster, the same rule the front page's fold uses.
    fetch('/changelog.json' + (window.__B || ''))
      .then(r => (r.ok ? r.json() : null))
      .then(j => setEntries(Array.isArray(j?.entries) ? j.entries : []))
      .catch(err => { swallowed('changelog: load', err); setEntries([]); });
  }, []);

  // Once the list is in, an address in the URL (#2026-08-28) scrolls to its entry.
  useEffect(() => {
    if (!entries?.length || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [entries]);

  const all = useMemo(() => entries || [], [entries]);
  const ids = useMemo(() => all.map((_, i) => entryId(all, i)), [all]);
  const counts = useMemo(() => {
    const c = { all: all.length };
    for (const k of KINDS) c[k] = all.filter(e => (e.kind || 'notice') === k).length;
    return c;
  }, [all]);
  const months = useMemo(() => {
    const m = new Map();
    for (const e of all) { const k = monthKey(e.date); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()];
  }, [all]);

  const ql = q.trim().toLowerCase();
  const shown = all
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => kind === 'all' || (e.kind || 'notice') === kind)
    .filter(({ e }) => !ql || [pick(e.title, lang), pick(e.body, lang)].some(s => s.toLowerCase().includes(ql)));

  // The month headings are drawn where a month begins in the SHOWN list, so a filter never
  // leaves an empty heading behind.
  let lastMonth = '';

  return html`
    <div class="ld chg">
      <section class="chg-head">
        <span class="ld-sh-kicker">${tr('changelog.kicker', 'Built with itself, every day')}</span>
        <h1 class="chg-title">${tr('changelog.title', 'What shipped here')}</h1>
        <p class="ld-sh-position">${tr('changelog.position', 'Newest first. Every entry says what a person gets, not what the code does.')}</p>
        <p class="chg-lead">${tr('changelog.lead', 'The same list the front page folds into one line. The agents you can adopt here are the ones building the platform, and this is what that produced, day by day.')}</p>
      </section>

      <div class="chg-bar">
        <div class="chg-chips" role="group" aria-label=${tr('changelog.filterLabel', 'Show only')}>
          <button type="button" class=${`chg-chip ${kind === 'all' ? 'is-on' : ''}`} aria-pressed=${kind === 'all'} onClick=${() => setKind('all')}>
            ${tr('changelog.all', 'All')} · ${counts.all}
          </button>
          ${KINDS.map(k => html`
            <button type="button" key=${k} class=${`chg-chip ${kind === k ? 'is-on' : ''}`} aria-pressed=${kind === k} onClick=${() => setKind(k)}>
              ${KIND_LABEL[k]()} · ${counts[k] || 0}
            </button>`)}
        </div>
        <input class="chg-search" type="search" value=${q} onInput=${(e) => setQ(e.target.value)}
          placeholder=${tr('changelog.searchPh', 'Search the log…')} aria-label=${tr('changelog.searchPh', 'Search the log')} />
      </div>

      <div class="chg-body">
        <aside class="chg-rail">
          <span class="chg-rail-label">${tr('changelog.byMonth', 'By month')}</span>
          ${months.map(([k, n]) => html`
            <a key=${k} class="chg-rail-month" href=${'#m-' + k}
              onClick=${(e) => { e.preventDefault(); document.getElementById('m-' + k)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
              ${monthLabel(k, lang)} · ${n}
            </a>`)}
          <div class="ld-sh-box chg-rail-json">
            <span class="ld-sh-box-label">${tr('changelog.machinesLabel', 'For machines:')}</span>
            ${' '}${tr('changelog.machines', 'the same log as JSON, one entry per change, in both languages:')}${' '}
            <a href="/changelog.json">/changelog.json</a>
          </div>
        </aside>

        <div class="chg-list">
          ${entries === null ? html`<p class="chg-empty">${tr('changelog.loading', 'Reading the log…')}</p>` : ''}
          ${entries !== null && shown.length === 0 ? html`<p class="chg-empty">${all.length === 0
            ? tr('changelog.none', 'Nothing has been announced here yet.')
            : tr('changelog.noMatch', 'No entry matches.')}</p>` : ''}
          ${shown.map(({ e, i }) => {
            const mk = monthKey(e.date);
            const heading = mk !== lastMonth;
            lastMonth = mk;
            const id = ids[i];
            const k = e.kind || 'notice';
            return html`
              ${heading ? html`<h2 class="chg-month" id=${'m-' + mk}>${monthLabel(mk, lang)}</h2>` : ''}
              <article class="chg-entry" id=${id} key=${id}>
                <div class="chg-meta">
                  <span class="chg-date">${fmtDate(e.date, lang)}</span>
                  <span class=${'chg-kind chg-kind-' + k}>${(KIND_LABEL[k] || KIND_LABEL.notice)()}</span>
                  ${e.version ? html`<span class="chg-version">v${e.version}</span>` : ''}
                  <a class="chg-anchor" href=${'#' + id} title=${tr('changelog.anchor', 'The address of this entry')}>#${id}</a>
                </div>
                <h3 class="chg-entry-title">${pick(e.title, lang)}</h3>
                ${pick(e.body, lang) ? html`<p class="chg-entry-body">${pick(e.body, lang)}</p>` : ''}
              </article>`;
          })}
        </div>
      </div>

      <section class="chg-close">
        <p>
          <span class="chg-close-label">${tr('landing.dogfoodLabel', 'Why it improves this fast:')}</span>
          ${' '}
          ${tr('landing.dogfoodText', 'AIMEAT is built with AIMEAT, every day. The agents you can adopt are the ones building the platform, and every rough edge gets found by us before it finds you.')}
          ${' '}
          <a href="/v1/portal" onClick=${(e) => { e.preventDefault(); navigate('/v1/portal'); }}>${tr('changelog.back', 'Back to the front page →')}</a>
        </p>
      </section>
    </div>`;
}
