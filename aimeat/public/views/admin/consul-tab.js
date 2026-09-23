/**
 * @file public/views/admin/consul-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for the Consul KV config integration — shows connection
 *   status and key count, and lets operators export config to / import config from Consul.
 *
 * @structure
 *   - ConsulTab({ data, reload }): renders status, disabled/setup help, and export/import actions
 *   - handleExport/handleImport: call consulExport/consulImport and reload dashboard data
 *
 * @version-history
 *   v1.1.0 — 2026-09-22 — Composed from the shared component set: the explanation is the section's
 *     description, the connection is one list row with its status chip and the two actions, the
 *     result is the success or danger aside. No inline style and no card of its own any more.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, StatsGrid, ExpandableHelp, Empty, DataTable } from './shared.js';
import { Section, Stack, ListRow, Surface, Action, Text } from '/components/poster-parts.js';
import { consulExport, consulImport } from '/js/services/admin.js';

export default function ConsulTab({ data, reload }) {
  const consul = data.consul;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!consul) return html`<${Empty} text=${t('dashboard.consulDisabled')} />`;

  if (!consul.enabled) {
    return html`
      <${Section} description=${t('dashboard.consulExplain')}>
        <${Stack}>
          <${Text}>${t('dashboard.consulDisabled')}<//>
          <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
            <${Text}>${t('dashboard.consulSetupDetail')}<//>
          <//>
        <//>
      <//>
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
    <${Section} description=${t('dashboard.consulExplain')}>
      <${Stack}>
        <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
          <${Text}>${t('dashboard.consulSetupDetail')}<//>
        <//>

        <${StatsGrid} items=${[
          { label: t('dashboard.consulStatus'), value: consul.healthy ? '✓' : '✗', tone: consul.healthy ? undefined : 'red' },
          { label: t('dashboard.consulKeysLoaded'), value: consul.key_count },
        ]} />

        ${result && html`<${Surface} kind="aside" tone=${result.ok ? 'success' : 'danger'} role="status"><${Text}>${escHtml(result.msg)}<//><//>`}

        <${ListRow} name=${escHtml(consul.url)} detail=${escHtml(consul.prefix)}
          value=${html`<${Badge} type=${consul.healthy ? 'healthy' : 'critical'} />`}
          actions=${html`
            <${Action} onClick=${handleExport} disabled=${loading}>${t('dashboard.consulExport')}<//>
            <${Action} onClick=${handleImport} disabled=${loading}>${t('dashboard.consulImport')}<//>`} />

        ${consul.keys?.length > 0
          ? html`<${DataTable} headers=${['Key']} rows=${consul.keys.map(k => [{ text: escHtml(k), mono: true }])} />`
          : html`<${Empty} text=${t('dashboard.consulNoKeys')} />`
        }
      <//>
    <//>
  `;
}
