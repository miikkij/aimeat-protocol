/**
 * @file landing-activity.js
 * @description Public activity feed for the logged-out landing page. Three tabs —
 *   Apps / Organisms / Agents — each a live list of recent public events (app
 *   publishes, public organism + workspace publishes, agent materials & knowledge
 *   packages). Initial load via GET /v1/public/activity-feed?category=; live updates
 *   via a single public SSE stream (GET /v1/public/events, native EventSource auto-
 *   reconnect) that prepends each event to its category regardless of the active tab.
 *   Each row shows HH:MM + a one-line summary; clicking a row expands a detail blob
 *   and a link to the underlying material/event.
 * @structure default export PublicActivityFeed() — sibling component imported by landing.js.
 * @usage import PublicActivityFeed from './landing-activity.js'; <${PublicActivityFeed} />
 * @version-history
 *   v1.0.0 — 2026-06-16 — Initial: 3-tab real-time public activity feed (owner spec).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
// NOTE: text interpolated as a child below (${ev.summary} etc.) is auto-escaped by
// Preact, so it is XSS-safe AND renders quotes correctly — do NOT call escHtml here
// (that would double-escape, surfacing literal &quot; in titles).

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const CATEGORIES = ['apps', 'organisms', 'agents'];
const LABELS = {
  apps: () => tr('landing.feedTabApps', 'Apps'),
  organisms: () => tr('landing.feedTabOrganisms', 'Organisms'),
  agents: () => tr('landing.feedTabAgents', 'Agents'),
};
const ICONS = { apps: '🎮', organisms: '🧬', agents: '🤖' };
const MAX_PER_TAB = 50;

const hhmm = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// One stable key per event so prepends from SSE dedupe against the initial load.
const evKey = (e) => `${e.at}|${e.summary}`;

function Row({ ev }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!(ev.detail || ev.link);
  return html`
    <li class="pa-row ${open ? 'pa-row--open' : ''}">
      <button class="pa-row-head" onClick=${() => hasMore && setOpen(o => !o)} aria-expanded=${open}>
        <span class="pa-time">${hhmm(ev.at)}</span>
        <span class="pa-summary">${ev.summary || ''}</span>
        ${hasMore ? html`<span class="pa-caret">${open ? '▾' : '▸'}</span>` : null}
      </button>
      ${open ? html`
        <div class="pa-detail">
          ${ev.detail ? html`<p class="pa-detail-text">${ev.detail}</p>` : null}
          ${ev.actor ? html`<p class="pa-detail-actor">${ev.actor}</p>` : null}
          ${ev.link ? html`<a class="pa-detail-link" href=${ev.link} target="_blank" rel="noopener">${tr('landing.feedOpen', 'Open →')}</a>` : null}
        </div>` : null}
    </li>`;
}

export default function PublicActivityFeed() {
  const [active, setActive] = useState('apps');
  // One list per category, kept independently; SSE routes each event to its bucket.
  const [lists, setLists] = useState({ apps: null, organisms: null, agents: null });
  const [unseen, setUnseen] = useState({ apps: 0, organisms: 0, agents: 0 });
  const activeRef = useRef(active);
  activeRef.current = active;

  // Initial load — fetch all three categories once on mount.
  useEffect(() => {
    let alive = true;
    Promise.all(CATEGORIES.map(cat =>
      fetch(`/v1/public/activity-feed?category=${cat}&limit=${MAX_PER_TAB}`)
        .then(r => r.json())
        .then(j => [cat, (j && j.ok !== false && j.data && j.data.items) || []])
        .catch(() => [cat, []]),
    )).then(pairs => {
      if (!alive) return;
      const next = { apps: [], organisms: [], agents: [] };
      for (const [cat, items] of pairs) next[cat] = items;
      setLists(next);
    });
    return () => { alive = false; };
  }, []);

  // Live updates — one public SSE stream (native auto-reconnect). Prepend each event
  // to its category bucket, deduped, and bump the unseen badge for inactive tabs.
  useEffect(() => {
    let es;
    try {
      es = new EventSource('/v1/public/events');
    } catch (err) { swallowed('landing-activity: PublicActivityFeed', err); return undefined; }
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch { return; }
      if (!ev || !CATEGORIES.includes(ev.category)) return;
      setLists(prev => {
        const cur = prev[ev.category] || [];
        if (cur.some(x => evKey(x) === evKey(ev))) return prev;
        return { ...prev, [ev.category]: [ev, ...cur].slice(0, MAX_PER_TAB) };
      });
      if (ev.category !== activeRef.current) {
        setUnseen(u => ({ ...u, [ev.category]: (u[ev.category] || 0) + 1 }));
      }
    };
    return () => { try { es.close(); } catch (err) { swallowed('landing-activity: PublicActivityFeed', err); } };
  }, []);

  const selectTab = (cat) => {
    setActive(cat);
    setUnseen(u => (u[cat] ? { ...u, [cat]: 0 } : u));
  };

  const current = lists[active];

  return html`
    <section class="pa">
      <h2 class="pa-title">${tr('landing.feedTitle', 'Happening on this node')}</h2>
      <p class="pa-sub">${tr('landing.feedSub', 'Public apps, organisms and agent materials as they are published. Click a row for details.')}</p>
      <div class="pa-tabs" role="tablist">
        ${CATEGORIES.map(cat => html`
          <button key=${cat} role="tab" aria-selected=${active === cat}
            class="pa-tab ${active === cat ? 'pa-tab--active' : ''}"
            onClick=${() => selectTab(cat)}>
            <span class="pa-tab-icon">${ICONS[cat]}</span>${LABELS[cat]()}
            ${unseen[cat] > 0 ? html`<span class="pa-badge">${unseen[cat]}</span>` : null}
          </button>`)}
      </div>
      <div class="pa-panel">
        ${current === null
          ? html`<div class="pa-empty">${tr('landing.feedLoading', 'Loading…')}</div>`
          : current.length === 0
            ? html`<div class="pa-empty">${tr('landing.feedEmpty', 'Nothing here yet — be the first to publish something public.')}</div>`
            : html`<ul class="pa-list">${current.map(ev => html`<${Row} key=${evKey(ev)} ev=${ev} />`)}</ul>`}
      </div>
    </section>`;
}
