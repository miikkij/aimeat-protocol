/**
 * @file public/views/admin/consul-tab.js
 * @description Admin dashboard tab for the Consul KV config integration — shows connection
 *   status and key count, and lets operators export config to / import config from Consul.
 *
 * @structure
 *   - ConsulTab({ data, reload }): renders status, disabled/setup help, and export/import actions
 *   - handleExport/handleImport: call consulExport/consulImport and reload dashboard data
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, StatsGrid, ExpandableHelp, Empty, DataTable } from './shared.js';
import { consulExport, consulImport } from '/js/services/admin.js';

export default function ConsulTab({ data, reload }) {
  const consul = data.consul;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!consul) return html`<${Empty} text=${t('dashboard.consulDisabled')} />`;

  if (!consul.enabled) {
    return html`
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.consulExplain')}</p>
      <div class="adm-card">
        <p>${t('dashboard.consulDisabled')}</p>
        <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
          <p>${t('dashboard.consulSetupDetail')}</p>
        </${ExpandableHelp}>
      </div>
    `;
  }

  const handleExport = async () => {
    setLoading(true);
    try {
      const r = await consulExport();
      setResult({ ok: true, msg: `Exported ${r.data.exported}/${r.data.total} keys to Consul` });
      await reload();
    } catch (err) { setResult({ ok: false, msg: err.message }); }
    setLoading(false);
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const r = await consulImport();
      setResult({ ok: true, msg: `Imported ${r.data.imported}/${r.data.total} keys from Consul` });
      await reload();
    } catch (err) { setResult({ ok: false, msg: err.message }); }
    setLoading(false);
  };

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.consulExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
      <p>${t('dashboard.consulSetupDetail')}</p>
    </${ExpandableHelp}>

    <${StatsGrid} items=${[
      { label: t('dashboard.consulStatus'), value: consul.healthy ? '\u2713' : '\u2717', color: consul.healthy ? '#22c55e' : '#ef4444' },
      { label: t('dashboard.consulKeysLoaded'), value: consul.key_count },
    ]} />

    ${result && html`<div style="margin:12px 0;padding:8px 12px;border-radius:6px;background:${result.ok ? '#16a34a22' : '#dc262622'};color:${result.ok ? '#22c55e' : '#ef4444'};font-size:.85rem">${escHtml(result.msg)}</div>`}

    <div class="adm-card" style="margin-top:12px">
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
        <span style="color:var(--text-dim);font-size:.85rem">${escHtml(consul.url)} \u2014 ${escHtml(consul.prefix)}</span>
        <span style="margin-left:auto"><${Badge} type=${consul.healthy ? 'healthy' : 'critical'} /></span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="adm-btn" onClick=${handleExport} disabled=${loading}>${t('dashboard.consulExport')}</button>
        <button class="adm-btn-action" onClick=${handleImport} disabled=${loading}>${t('dashboard.consulImport')}</button>
      </div>
      ${consul.keys?.length > 0
        ? html`<${DataTable} headers=${['Key']} rows=${consul.keys.map(k => [escHtml(k)])} />`
        : html`<${Empty} text=${t('dashboard.consulNoKeys')} />`
      }
    </div>
  `;
}
