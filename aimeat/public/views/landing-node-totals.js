/**
 * @file landing-node-totals.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Landing-page "Happening on this node" panel. Replaces the previously
 *   often-empty 3-tab activity feed with cumulative, never-empty node counters:
 *   public apps, public organisms, connected agents (+ online now), public knowledge
 *   packages, and total app downloads. One fetch of GET /v1/public/node-totals on
 *   mount, refreshed on the aimeat-live-update window event and on a slow interval.
 *   Rationale: an empty feed reads as "broken"; counts always show the node is alive.
 * @structure default export NodeTotals() — sibling component imported by landing.js.
 * @usage import NodeTotals from './landing-node-totals.js'; <${NodeTotals} />
 * @version-history
 *   v2.0.0 — 2026-08-28 — The showroom strip: four figures on one dark band (apps, opens, agents,
 *     awake now) in the visitor's words, no icons, no heading. The fetch and the refresh rules are
 *     unchanged; organisms and knowledge packages stay in the answer and leave the strip.
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

  // Four figures on one dark strip, in the showroom's words: what people made, how often it was
  // opened, how many helpers work here and how many are awake this minute. Organisms and knowledge
  // packages are still in the answer and no longer on the strip: a visitor has no word for either
  // yet, and a number with no word is noise. The strip says it is counting until the answer lands,
  // because a hard 0 on a live counter reads as a dead node.
  const d = totals || {};
  const figures = [
    { key: 'apps', value: d.apps, label: tr('landing.showApps', 'wishes running as apps') },
    { key: 'opens', value: d.downloads, label: tr('landing.showOpens', 'times opened') },
    { key: 'agents', value: d.agents, label: tr('landing.showAgents', 'AI helpers on the payroll') },
    { key: 'awake', value: d.agents_online, label: tr('landing.showAwake', 'awake right now'), live: true },
  ];

  return html`
    <section class="nt" aria-live="polite">
      <div class="nt-strip">
        ${figures.map(f => html`
          <div class="nt-figure" key=${f.key}>
            ${f.live ? html`<span class="nt-dot" aria-hidden="true"></span>` : null}
            <span class="nt-value">${totals ? num(f.value) : '…'}</span>
            <span class="nt-label">${f.label}</span>
          </div>`)}
      </div>
      ${totals ? null : html`<p class="nt-counting">${tr('landing.showCounting', 'Counting right here, live…')}</p>`}
    </section>`;
}
