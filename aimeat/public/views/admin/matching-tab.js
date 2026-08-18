/**
 * @file public/views/admin/matching-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for the AI matching engine — shows profile/match stats and
 *   provides a button to manually trigger a matching run, reporting the number of matches found.
 *
 * @structure
 *   - MatchingTab({ data }): default component; renders stats grid + trigger button, calls runMatching()
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { StatsGrid, ExpandableHelp } from './shared.js';
import { runMatching } from '/js/services/admin.js';

export default function MatchingTab({ data }) {
  const m = data.matching;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function doRun() {
    setRunning(true);
    setResult(null);
    try {
      const r = await runMatching();
      setResult({ ok: true, msg: t('dashboard.matchingComplete') + (r.data?.matches_found ? ' (' + r.data.matches_found + ')' : '') });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setRunning(false);
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.matchingExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.matchingHelpTitle')}>${t('dashboard.matchingHelpDetail')}</${ExpandableHelp}>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalProfiles'), value: m?.total_profiles || 0, tone: 'cyan' },
      { label: t('dashboard.activeMatches'), value: m?.active_matches || 0, tone: 'green' },
      { label: t('dashboard.lastRun'), value: m?.last_run || '\u2014', tone: 'purple' },
    ]} />

    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.matchingEngine')}</h4>
      <button class="adm-btn" onClick=${doRun} disabled=${running}>
        ${running ? '...' : t('dashboard.triggerMatching')}
      </button>
      ${result && html`<div style="margin-top:8px;font-size:.85rem;color:${result.ok ? '#22c55e' : '#ef4444'}">${result.msg}</div>`}
    </div>
  `;
}
