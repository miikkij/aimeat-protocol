/**
 * @file public/views/admin/consul-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for the Consul KV config integration — shows connection
 *   status and key count, and lets operators export config to / import config from Consul. The tab
 *   draws library components and passes them data; it writes no class and no style.
 *
 * @structure
 *   - ConsulTab({ data, reload }): renders status, disabled/setup help, and export/import actions
 *   - handleExport/handleImport: call consulExport/consulImport and reload dashboard data
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class or inline style: the explanation is a hint,
 *     the card is the Object box with the address in its head and the health mark at its end, the
 *     two actions are the loud action and the action link, the result is the form's message (fine or
 *     refused). The health figure keeps its colour as the strip's fine or danger tone.
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
import { Box } from '/components/Box.js';
import { Loud, Action } from '/components/Action.js';
import { FormActions } from '/components/Field.js';
import { Space } from '/components/Layout.js';
import { Note } from '/components/Note.js';

export default function ConsulTab({ data, reload }) {
  const consul = data.consul;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!consul) return html`<${Empty} text=${t('dashboard.consulDisabled')} />`;

  if (!consul.enabled) {
    return html`
      <${Note}>${t('dashboard.consulExplain')}<//>
      <${Box}>
        <p>${t('dashboard.consulDisabled')}</p>
        <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
          <p>${t('dashboard.consulSetupDetail')}</p>
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
    <${Note}>${t('dashboard.consulExplain')}<//>
    <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
      <p>${t('dashboard.consulSetupDetail')}</p>
    <//>

    <${StatsGrid} items=${[
      // The health figure keeps its colour by meaning: fine when Consul answers, danger when not.
      { label: t('dashboard.consulStatus'), value: consul.healthy ? '✓' : '✗', tone: consul.healthy ? 'green' : 'red' },
      { label: t('dashboard.consulKeysLoaded'), value: consul.key_count },
    ]} />

    ${result && html`<${Space} above="medium" below="medium"><${Note} kind="message" error=${!result.ok}>${escHtml(result.msg)}<//><//>`}

    <${Space} above="medium">
      <${Box} marks=${html`<${Note} kind="meta" inline>${escHtml(consul.url)} — ${escHtml(consul.prefix)}<//>`}
        end=${html`<${Badge} type=${consul.healthy ? 'healthy' : 'critical'} />`}>
        <${FormActions}>
          <${Loud} control onClick=${handleExport} disabled=${loading}>${t('dashboard.consulExport')}<//>
          <${Action} small onClick=${handleImport} disabled=${loading}>${t('dashboard.consulImport')}<//>
        <//>
        ${consul.keys?.length > 0
    ? html`<${DataTable} headers=${['Key']} rows=${consul.keys.map(k => [escHtml(k)])} />`
    : html`<${Empty} text=${t('dashboard.consulNoKeys')} />`}
      <//>
    <//>
  `;
}
