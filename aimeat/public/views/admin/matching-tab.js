import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatsGrid } from './shared.js';
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
    <${StatsGrid} items=${[
      { label: t('dashboard.totalProfiles'), value: m?.total_profiles || 0, color: '#06b6d4' },
      { label: t('dashboard.activeMatches'), value: m?.active_matches || 0, color: '#22c55e' },
      { label: t('dashboard.lastRun'), value: m?.last_run || '\u2014', color: '#a855f7' },
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
