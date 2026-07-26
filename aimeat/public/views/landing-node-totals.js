/**
 * @file landing-node-totals.js
 * @description Landing-page "Happening on this node" panel. Replaces the previously
 *   often-empty 3-tab activity feed with cumulative, never-empty node counters:
 *   public apps, public organisms, connected agents (+ online now), public knowledge
 *   packages, and total app downloads. One fetch of GET /v1/public/node-totals on
 *   mount, refreshed on the aimeat-live-update window event and on a slow interval.
 *   Rationale: an empty feed reads as "broken"; counts always show the node is alive.
 * @structure default export NodeTotals() — sibling component imported by landing.js.
 * @usage import NodeTotals from './landing-node-totals.js'; <${NodeTotals} />
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial: cumulative node counters replacing the activity feed.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const num = (n) => (Number(n) || 0).toLocaleString();

export default function NodeTotals() {
  const [totals, setTotals] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/v1/public/node-totals')
        .then(r => r.json())
        .then(j => { if (alive && j && j.ok !== false && j.data) setTotals(j.data); })
        .catch(err => { swallowed('landing-node-totals: load', err); });
    };
    load();
    const off = onLiveUpdate(['agents', 'apps', 'organisms'], () => load());
    const iv = setInterval(load, 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(iv);
    };
  }, []);

  const d = totals || {};
  const cards = [
    { icon: '🎮', value: d.apps, label: tr('landing.totalApps', 'public apps') },
    { icon: '🧬', value: d.organisms, label: tr('landing.totalOrganisms', 'organisms') },
    {
      icon: '🤖', value: d.agents, label: tr('landing.totalAgents', 'agents'),
      sub: d.agents_online > 0 ? `${num(d.agents_online)} ${tr('landing.totalOnline', 'online now')}` : null,
    },
    { icon: '📚', value: d.knowledge_packages, label: tr('landing.totalKnowledge', 'knowledge packages') },
    { icon: '⬇️', value: d.downloads, label: tr('landing.totalDownloads', 'app downloads') },
  ];

  return html`
    <section class="pa nt">
      <h2 class="pa-title">${tr('landing.feedTitle', 'Happening on this node')}</h2>
      <p class="pa-sub">${tr('landing.totalsSub', "What's live on this node right now.")}</p>
      <div class="nt-grid">
        ${cards.map(c => html`
          <div class="nt-card" key=${c.label}>
            <span class="nt-icon">${c.icon}</span>
            <span class="nt-value">${totals ? num(c.value) : '–'}</span>
            <span class="nt-label">${c.label}</span>
            ${c.sub ? html`<span class="nt-sub">${c.sub}</span>` : null}
          </div>`)}
      </div>
    </section>`;
}
