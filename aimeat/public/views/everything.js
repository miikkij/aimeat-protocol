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
 *   v1.1.0 - 2026-09-15 - Search headings and normalized words; feature links and matching contents.
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

/** app-tools and app tools are one query; repeated whitespace and case do not affect matching. */
const normalize = (s) => s.normalize('NFKC').toLowerCase().replace(/[-\u2010-\u2015_]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Search headings and row text together, keeping the source's section numbers and anchors. */
export function matchingGroups(data, query) {
  if (!data) return [];
  const q = normalize(query);
  if (!q) return data.groups;
  return data.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => normalize(g.title + ' ' + r.plain).includes(q)) }))
    .filter((g) => g.rows.length > 0);
}

/** One matching group, with its original section number and feature anchors. */
function Section({ g, reach }) {
  const rows = g.rows;
  const cols = g.columns.map((c, i) => ({ name: c, i })).filter((c) => reach || c.i !== g.reach);
  return html`
    <section class="ev-group" id=${g.slug}>
      <h2 class="ev-h2"><span class="ev-num showroom-slab--sun">${g.n}</span> ${g.title}</h2>
      ${g.lead.map((p, i) => html`<p class="ev-lead" key=${i} dangerouslySetInnerHTML=${{ __html: p }}></p>`)}
      <div class="ev-tablebox">
        <table class="ev-table poster-frame">
          <thead><tr>${cols.map((c) => html`<th scope="col" key=${c.i} class=${c.i === g.reach ? 'ev-reach' : ''}>${c.name}</th>`)}</tr></thead>
          <tbody>
            ${rows.map((r, ri) => html`
              <tr key=${r.slug || ri} id=${r.slug}>
                ${cols.map((c) => c.i === 0 && r.slug
                  ? html`<td><a class="ev-feature" href=${'#' + r.slug} dangerouslySetInnerHTML=${{ __html: r.cells[c.i] }}></a></td>`
                  : html`<td key=${c.i} class=${c.i === g.reach ? 'ev-reach' : ''} dangerouslySetInnerHTML=${{ __html: r.cells[c.i] }}></td>`)}
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

  const groups = useMemo(() => matchingGroups(data, query), [data, query]);
  const shown = groups.reduce((sum, g) => sum + g.rows.length, 0);

  // The initial HTML has the anchors too. Restore the requested position after the JSON fetch
  // replaces that body; otherwise a direct feature link stops at the temporary loading screen.
  useEffect(() => {
    if (!data) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const toggle = () => setReach((on) => { writeReach(!on); return !on; });
  const back = (e) => { e.preventDefault(); navigate('/v1/portal'); };

  return html`
    <div class="ev">
      <header class="ev-head">
        <a class="showroom-door ev-back" href="/v1/portal" onClick=${back}>${tr('everything.back', '← Front page')}</a>
        <h1 class="ev-title">${tr('everything.title', 'Everything in AIMEAT')}</h1>
        ${data?.stamp ? html`<p class="ev-stamp">${tr('everything.stamp', 'Version {v}, checked against the code on {d}').replace('{v}', data.stamp.version).replace('{d}', data.stamp.date)}</p>` : ''}
        ${failed ? html`<p class="ev-intro">${tr('everything.error', 'The list could not be loaded.')}</p>` : ''}
        ${!data && !failed ? html`<p class="ev-intro">${tr('everything.loading', 'Loading the list…')}</p>` : ''}
      </header>
      ${data ? html`
        <div class="ev-controls poster-frame">
          <label class="ev-search">
            <span class="ev-label">${tr('everything.search', 'Search the list')}</span>
            <input type="search" class="ev-search-input poster-frame" value=${query} onInput=${(e) => setQuery(e.target.value)}
              placeholder=${tr('everything.searchPh', 'A feature, a standard, an API…')} />
          </label>
          <button type="button" class=${`btn-outline ev-toggle ${reach ? 'is-on' : ''}`} aria-pressed=${reach} onClick=${toggle}>
            ${reach ? tr('everything.toggleOff', 'Hide API and MCP details') : tr('everything.toggleOn', 'Show API and MCP details')}
          </button>
          ${query ? html`<button type="button" class="btn-ghost" onClick=${() => setQuery('')}>${tr('everything.clear', 'Clear search')}</button>` : ''}
          <span class="ev-count">${tr('everything.count', '{n} of {total} rows').replace('{n}', String(shown)).replace('{total}', String(data.counts.rows))}</span>
        </div>
        ${!query ? data.intro.map((p, i) => html`<p class="ev-intro" key=${i} dangerouslySetInnerHTML=${{ __html: p }}></p>`) : ''}
        <nav class="ev-toc" aria-label=${tr('everything.contents', 'Contents')}>
          <span class="ev-label">${tr('everything.contents', 'Contents')}</span>
          <ol class="ev-toc-list">
            ${groups.map((g) => html`<li key=${g.slug} value=${g.n}><a href=${'#' + g.slug}>${g.title}</a></li>`)}
          </ol>
        </nav>
        <p class="ev-legend"><span class="ev-mark showroom-slab--sun">off</span> ${tr('everything.legendOff', 'ships but stays off until the operator switches it on')} · <span class="ev-mark showroom-slab--sun">testnet</span> ${tr('everything.legendTestnet', 'defaults to a test network')}</p>
        ${groups.map((g) => html`<${Section} g=${g} reach=${reach} key=${g.slug} />`)}
        ${shown === 0 ? html`<p class="ev-intro">${tr('everything.noMatch', 'No row matches that.')}</p>` : ''}
        ${data.outro ? html`<p class="ev-outro" dangerouslySetInnerHTML=${{ __html: data.outro }}></p>` : ''}
        <p class="ev-outro"><a href="/v1/everything.md">${tr('everything.markdown', 'Read the complete guide as Markdown')}</a></p>
        <p class="ev-outro"><a href="https://github.com/miikkij/aimeat-protocol/blob/main/docs/AIMEAT-Feature-List.md" target="_blank" rel="noopener">${tr('everything.source', 'The list as a file, in the repository →')}</a></p>` : ''}
    </div>`;
}
