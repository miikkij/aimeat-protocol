/**
 * @file everything.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Everything in AIMEAT" (TARGET-077): the whole feature list, as the repo keeps it
 *   in docs/AIMEAT-Feature-List.md, on one page. The page reads public/data/everything.json, which
 *   scripts/build-everything.ts writes from that file; nothing here is a second copy of the list.
 *
 *   The Reach column (REST prefixes, MCP tool families) is off by default and a switch shows it,
 *   remembered per browser. A contents list of the groups sits at the top with a search box that
 *   filters the rows as it is typed. The version stamp comes from the list's own header, and the
 *   page shows none when the list stops carrying one, so it cannot claim a version the list does not.
 *
 *   THE CELLS ARE HTML FROM THE BUILD. The build turns the rows' inline markdown (bold, code,
 *   links) into HTML from a file in this repository, never from a person's input, which is the one
 *   reason innerHTML is acceptable here.
 * @structure Everything (default) · Toggle · Section
 * @usage routed at /v1/everything by spa.html; /everything redirects there
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const REACH_KEY = 'aimeat.everything.reach';
const readReach = () => { try { return localStorage.getItem(REACH_KEY) === '1'; } catch (err) { swallowed('everything: reach read', err); return false; } };
const writeReach = (on) => { try { localStorage.setItem(REACH_KEY, on ? '1' : '0'); } catch (err) { swallowed('everything: reach write', err); } };

/** One group: its heading, its lead, its table. `q` is the search, lower-cased, or ''. */
function Section({ g, reach, q }) {
  const rows = q ? g.rows.filter((r) => r.plain.toLowerCase().includes(q)) : g.rows;
  if (rows.length === 0) return null;
  const cols = g.columns.map((c, i) => ({ name: c, i })).filter((c) => reach || c.i !== g.reach);
  return html`
    <section class="ev-group" id=${g.slug}>
      <h2 class="ev-h2"><span class="ev-num showroom-slab--sun">${g.n}</span> ${g.title}</h2>
      ${g.lead.map((p, i) => html`<p class="ev-lead" key=${i} dangerouslySetInnerHTML=${{ __html: p }}></p>`)}
      <div class="ev-tablebox">
        <table class="ev-table poster-frame">
          <thead><tr>${cols.map((c) => html`<th key=${c.i} class=${c.i === g.reach ? 'ev-reach' : ''}>${c.name}</th>`)}</tr></thead>
          <tbody>
            ${rows.map((r, ri) => html`
              <tr key=${ri}>
                ${cols.map((c) => html`<td key=${c.i} class=${c.i === g.reach ? 'ev-reach' : ''} dangerouslySetInnerHTML=${{ __html: r.cells[c.i] }}></td>`)}
              </tr>`)}
          </tbody>
        </table>
      </div>
    </section>`;
}

export default function Everything({ navigate }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reach, setReach] = useState(readReach);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/data/everything.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((j) => { if (alive) setData(j); })
      .catch((err) => { swallowed('everything: load', err); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!data) return 0;
    if (!q) return data.counts.rows;
    return data.groups.reduce((s, g) => s + g.rows.filter((r) => r.plain.toLowerCase().includes(q)).length, 0);
  }, [data, q]);

  const toggle = () => setReach((on) => { writeReach(!on); return !on; });
  const back = (e) => { e.preventDefault(); navigate('/v1/portal'); };

  return html`
    <div class="ev">
      <header class="ev-head">
        <a class="showroom-door ev-back" href="/v1/portal" onClick=${back}>${tr('everything.back', '← Front page')}</a>
        <h1 class="ev-title">${tr('everything.title', 'Everything in AIMEAT')}</h1>
        ${data?.stamp ? html`<p class="ev-stamp">${tr('everything.stamp', 'Version {v}, checked against the code on {d}').replace('{v}', data.stamp.version).replace('{d}', data.stamp.date)}</p>` : ''}
        ${data ? data.intro.map((p, i) => html`<p class="ev-intro" key=${i} dangerouslySetInnerHTML=${{ __html: p }}></p>`) : ''}
        ${failed ? html`<p class="ev-intro">${tr('everything.error', 'The list could not be loaded.')}</p>` : ''}
        ${!data && !failed ? html`<p class="ev-intro">${tr('everything.loading', 'Loading the list…')}</p>` : ''}
      </header>
      ${data ? html`
        <div class="ev-controls poster-frame">
          <label class="ev-search">
            <span class="ev-label">${tr('everything.search', 'Search the list')}</span>
            <input type="search" class="ev-search-input poster-frame" value=${query} onInput=${(e) => setQuery(e.target.value)}
              placeholder=${tr('everything.searchPh', 'A feature, a word, a door…')} />
          </label>
          <button type="button" class=${`btn-outline ev-toggle ${reach ? 'is-on' : ''}`} aria-pressed=${reach} onClick=${toggle}>
            ${reach ? tr('everything.toggleOff', 'Hide where the door is') : tr('everything.toggleOn', 'Show where the door is')}
          </button>
          <span class="ev-count">${tr('everything.count', '{n} of {total} rows').replace('{n}', String(shown)).replace('{total}', String(data.counts.rows))}</span>
        </div>
        <nav class="ev-toc" aria-label=${tr('everything.contents', 'Contents')}>
          <span class="ev-label">${tr('everything.contents', 'Contents')}</span>
          <ol class="ev-toc-list">
            ${data.groups.map((g) => html`<li key=${g.slug}><a href=${'#' + g.slug}>${g.title}</a></li>`)}
          </ol>
        </nav>
        <p class="ev-legend"><span class="ev-mark showroom-slab--sun">off</span> ${tr('everything.legendOff', 'ships but stays off until the operator switches it on')} · <span class="ev-mark showroom-slab--sun">testnet</span> ${tr('everything.legendTestnet', 'defaults to a test network')}</p>
        ${data.groups.map((g) => html`<${Section} g=${g} reach=${reach} q=${q} key=${g.slug} />`)}
        ${shown === 0 ? html`<p class="ev-intro">${tr('everything.noMatch', 'No row matches that.')}</p>` : ''}
        ${data.outro ? html`<p class="ev-outro" dangerouslySetInnerHTML=${{ __html: data.outro }}></p>` : ''}
        <p class="ev-outro"><a href="https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md" target="_blank" rel="noopener">${tr('everything.source', 'The list as a file, in the repository →')}</a></p>` : ''}
    </div>`;
}
