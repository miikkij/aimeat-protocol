/**
 * @file public/views/admin/directory-tab.js
 * @description Admin dashboard "Directory" tab (Preact + HTM) — shows directory index stats (entries,
 *   cities, categories) and an operator control to rebuild the directory index.
 *
 * @structure
 *   - DirectoryTab({ data }): default export; renders StatsGrid + rebuild button, tracks rebuild state
 *   - doRebuild(): calls rebuildDirectory() and surfaces success/error feedback
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
import { rebuildDirectory } from '/js/services/admin.js';

export default function DirectoryTab({ data }) {
  const dir = data.directory;
  const [rebuilding, setRebuilding] = useState(false);
  const [result, setResult] = useState(null);

  async function doRebuild() {
    setRebuilding(true);
    setResult(null);
    try {
      await rebuildDirectory();
      setResult({ ok: true, msg: t('dashboard.directoryRebuilt') });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setRebuilding(false);
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.directoryExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.directoryHelpTitle')}>${t('dashboard.directoryHelpDetail')}</${ExpandableHelp}>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalEntries'), value: dir?.total || 0, tone: 'cyan' },
      { label: t('dashboard.cities'), value: dir?.cities || 0, tone: 'green' },
      { label: t('dashboard.categories'), value: dir?.categories || 0, tone: 'amber' },
    ]} />

    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.directoryMaintenance')}</h4>
      <button class="adm-btn" onClick=${doRebuild} disabled=${rebuilding}>
        ${rebuilding ? '...' : t('dashboard.rebuildIndex')}
      </button>
      ${result && html`<div style="margin-top:8px;font-size:.85rem;color:${result.ok ? '#22c55e' : '#ef4444'}">${result.msg}</div>`}
    </div>
  `;
}
