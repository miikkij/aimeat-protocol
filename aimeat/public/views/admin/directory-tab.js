import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatsGrid } from './shared.js';
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
    <${StatsGrid} items=${[
      { label: t('dashboard.totalEntries'), value: dir?.total || 0, color: '#06b6d4' },
      { label: t('dashboard.cities'), value: dir?.cities || 0, color: '#22c55e' },
      { label: t('dashboard.categories'), value: dir?.categories || 0, color: '#f59e0b' },
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
