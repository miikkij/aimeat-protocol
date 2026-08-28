/**
 * @file landing-wall.js
 * @description The landing page's live evidence: the wall of apps people published to this node,
 *   and today's numbers under it. Both answer "is this place alive" with data rather than copy,
 *   which is why they are the two sections the page cannot fake.
 *
 *   Extracted from landing.js unchanged when that file reached 789 of its 800 allowed lines. The
 *   wall's own rules survive the move: newest first (a leaderboard whose top has not moved in
 *   weeks says the opposite of what this section is for), twelve cards before "show the rest"
 *   (sixty measured 37.9 phone screens and buried the visitor's next step), a zero left out
 *   rather than printed, and apps opened in a sandboxed opaque-origin iframe rather than as a
 *   top-level apex document.
 * @structure EyeMark · fmtPublished · WALL_FIRST_PAGE · Gallery · StatsPanel
 * @usage import { Gallery, StatsPanel } from './landing-wall.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Pure extraction from landing.js v5.3.0. No behaviour change.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { storeHref } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// An eye, drawn rather than typed: an emoji would render as a different picture on every
// platform and the house rule keeps emoji out of the UI. currentColor so the accent is set in CSS.
const EyeMark = html`<svg class="ld-eye" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

/* ── Today's stats + ownership line — THE sales core. Real numbers; zeros are omitted. ── */
// No navigate prop any more: the one link here leaves the site (the store), so nothing routes.
export function StatsPanel() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/v1/public/node-stats-today').then(r => r.json())
      .then(j => { if (j?.ok !== false) setStats(j.data); })
      .catch(err => { swallowed('landing: StatsPanel', err); });
  }, []);

  const parts = [];
  if (stats?.public_writes > 0) parts.push(`${stats.public_writes} ${tr('landing.statWrites', 'public entries written')}`);
  if (stats?.tasks_completed > 0) parts.push(`${stats.tasks_completed} ${tr('landing.statTasks', 'tasks completed')}`);
  if (stats?.schedules_fired > 0) parts.push(`${stats.schedules_fired} ${tr('landing.statSchedules', 'schedules fired')}`);

  return html`
    <div class="ld-stats">
      <div class="ld-stats-line">
        ${parts.length > 0
          ? html`${tr('landing.todayPrefix', 'This node today:')} ${parts.join(' · ')} · 0 ${tr('landing.humanHours', 'human hours')}`
          : tr('landing.statsFallback', 'This node runs agents around the clock: schedules, tasks and publishing without human hours.')}
      </div>
      <div class="ld-stats-own">
        ${tr('landing.ownLine', 'The same could run for you. Your own node, your data, your agents.')}
        ${/* The store is the one price door, so this line names no price of its own any more. */''}
        ${storeHref() ? html`<a class="ld-stats-cta" href=${storeHref()} target="_blank" rel="noopener">${tr('landing.ownCta', 'Get your own →')}</a>` : ''}
      </div>
    </div>
  `;
}

/* ── Live wall — the REAL apps people built with their AI and published to this node (from the
   apps API, manifest-driven). Three per row + a filter. Each card: name · description · who made
   it · when. The proof the loop works: your creation lands on this same wall. ── */
// Date only. The clock time of a publish tells a visitor nothing, and it was the part that
// pushed the card's footer onto a second line, so half the grid wrapped and half did not.
function fmtPublished(iso) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch (err) { swallowed('landing: fmtPublished', err); return ''; }
}

/** How many cards the wall shows before "show the rest". On a phone every extra card is a full
 *  screen of scrolling: 60 cards measured 37.9 screens of landing page, and the visitor's own
 *  next step (the two doors above) is what that length buries (UX-remake v3, P11). */
const WALL_FIRST_PAGE = 12;

export function Gallery() {
  const [apps, setApps] = useState([]);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Newest first by default: the wall's job is to show the place is alive, and the freshest
  // publish says that better than a leaderboard whose top has not moved in weeks.
  const [sort, setSort] = useState('newest');
  useEffect(() => {
    // Public proof wall: the default listing already excludes parked + operator-hidden
    // apps (no manage flag), so the wall never surfaces moderated/hidden apps.
    fetch(`/v1/apps?sort=${encodeURIComponent(sort)}&limit=60`).then(r => r.json())
      .then(j => setApps(j?.data?.apps || []))
      .catch(err => { swallowed('landing: Gallery', err); });
  }, [sort]);

  const ql = q.trim().toLowerCase();
  const matched = !ql ? apps : apps.filter((a) => {
    const m = a.manifest || {};
    return [m.name, m.description, m.authorDisplay, a.owner].some(v => (v || '').toLowerCase().includes(ql));
  });
  // A search shows everything it matched (the visitor asked for it); the default wall shows the
  // first page with the rest one click away, never behind a link to another page.
  const shown = (ql || showAll) ? matched : matched.slice(0, WALL_FIRST_PAGE);
  const hiddenCount = matched.length - shown.length;

  return html`
    <div class="ld-section">
      <h2 class="ld-h2">${tr('landing.wallTitle', 'Built by people with their AI. Yours goes here too.')}</h2>
      <div class="ld-wall-bar">
        <input class="ld-wall-search" type="search" value=${q}
          onInput=${(e) => setQ(e.target.value)}
          placeholder=${tr('landing.wallSearch', 'Search apps…')}
          aria-label=${tr('landing.wallSearch', 'Search apps')} />
        <div class="ld-wall-sort" role="group" aria-label=${tr('landing.wallSortLabel', 'Order the apps')}>
          <button type="button" class=${`ld-wall-sort-btn ${sort === 'newest' ? 'is-on' : ''}`}
            aria-pressed=${sort === 'newest'} onClick=${() => setSort('newest')}>
            ${tr('landing.wallSortNewest', 'Recently updated')}
          </button>
          <button type="button" class=${`ld-wall-sort-btn ${sort === 'popular' ? 'is-on' : ''}`}
            aria-pressed=${sort === 'popular'} onClick=${() => setSort('popular')}>
            ${tr('landing.wallSortPopular', 'Most opened')}
          </button>
        </div>
      </div>
      ${shown.length === 0
        ? html`<p class="ld-app-desc">${apps.length === 0
            ? tr('landing.wallEmpty', 'Be the first. Copy the prompt above, build something, and it lands here.')
            : tr('landing.wallNoMatch', 'No apps match your search.')}</p>`
        : html`<div class="ld-gallery">
            ${shown.map((a) => {
              const m = a.manifest || {};
              // H-2: open published apps in a sandboxed (opaque-origin) iframe, never as a
              // top-level apex document. Click-to-open instead of an apex href, so middle-/
              // ctrl-click can't bypass it either.
              const href = `/v1/apps/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.filename)}?mode=inline`;
              const desc = (m.description || '').length > 140 ? m.description.slice(0, 140) + '…' : (m.description || '');
              const author = m.authorDisplay || a.owner || tr('landing.wallAnon', 'someone');
              const when = a.created_at ? fmtPublished(a.created_at) : '';
              const open = () => openAppSandboxed(href, m.name || a.filename);
              // Version first, then the two numbers, and a zero is left out rather than printed:
              // "0 opens" on a freshly published app reads as a verdict on it.
              // The node's own version is the incrementing publish number, the same v30 the
              // catalogue shows. The manifest's semver is whatever the author typed and does not
              // move when they republish, so it says nothing about how alive the app is.
              const opensLabel = `${a.downloads} ${a.downloads === 1 ? tr('landing.wallOpen1', 'open') : tr('landing.wallOpens', 'opens')}`;
              const facts = [];
              if (a.version_number) facts.push(html`<span>v${a.version_number}</span>`);
              // The count carries the mark; the word it replaces stays as the accessible name, so
              // a screen reader still says "41 opens" and a hover still spells it out.
              if (a.downloads > 0) facts.push(html`<span class="ld-app-opens" title=${opensLabel} aria-label=${opensLabel}>${EyeMark}${a.downloads}</span>`);
              if (a.forks > 0) facts.push(html`<span>${a.forks} ${a.forks === 1 ? tr('landing.wallFork1', 'fork') : tr('landing.wallForks', 'forks')}</span>`);
              return html`
                <div key=${a.owner + '/' + a.filename} class="ld-app-card" role="button" tabindex="0"
                  onClick=${open} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                  ${a.screenshot_url ? html`<img class="ld-app-shot" src=${a.screenshot_url} loading="lazy" alt="" />` : ''}
                  <div class="ld-app-name">${m.icon ? escHtml(m.icon) + ' ' : ''}${escHtml(m.name || a.filename)}</div>
                  ${desc && html`<div class="ld-app-desc">${escHtml(desc)}</div>`}
                  <div class="ld-app-foot">
                    <span class="ld-app-facts">${facts.map((f, i) => html`${i ? html`<span class="ld-app-sep">·</span>` : ''}${f}`)}</span>
                    <span class="ld-app-by">${escHtml(author)}${when ? ' · ' + when : ''}</span>
                  </div>
                </div>`;
            })}
          </div>`}
      ${hiddenCount > 0 ? html`
        <div class="ld-wall-more">
          <button type="button" class="btn-outline" onClick=${() => setShowAll(true)}>
            ${tr('landing.wallShowAll', 'Show the other {n} apps').replace('{n}', String(hiddenCount))}
          </button>
        </div>` : ''}
    </div>
  `;
}
