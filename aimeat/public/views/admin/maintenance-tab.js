/**
 * @file public/views/admin/maintenance-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin maintenance page in the poster face (design canvas "AIMEAT Admin
 *   Maintenance"). Four sections in the order an operator asks: what answers and what does not
 *   right now, taking the node down or bringing it back with the line people will read and a
 *   preview of the page they get, the backup, and the restore. The three writes go through the
 *   same routes as before.
 *
 * @structure
 *   - MaintenanceTab({ data, reload, switchPage }) — the four sections and the actions
 *   - RightNow: the status word, what stays open, and the numeral strip
 *   - Preview: the 503 page as a visitor gets it, drawn small
 *   - askBody: the confirm dialog's body — the line people read and the doors that stay open
 *
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, metric rows, the
 *     numeral band, a shared field, the one loud action, the preview as a box and restore's warning
 *     as the solid danger aside. The page's own sheet (admin-maintenance.css) is gone.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 -- 2026-09-13 -- Compose the four section headings from the shared B1 shape.
 *   v2.0.0 — 2026-09-12 — The poster face: two cards become four sections, the full-width red
 *     button and the purple restore button become one ink slab and two underlined words, the
 *     message field gets the preview that shows what it actually writes, and taking the node
 *     down asks once before it happens (it asked nothing before).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, dt, Badge, Row, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, NumeralBand, ListRow, Field, Action, Chip, Surface, Text } from '/components/poster-parts.js';
import { useConfirm } from '/components/Modal.js';
import { setMaintenance, getBackup, doRestore as apiRestore } from '/js/services/admin.js';

const M = (key, params) => t('dashboard.maint.' + key, params);

/** The 503 page as a visitor gets it, drawn small. The wording follows the page the node serves
 *  (src/server-bootstrap/middleware-guards.ts), so the preview is the page and not a drawing of
 *  one; when that page changes, this changes with it. */
function Preview({ nodeId, message, live }) {
  return html`<${Stack} density="compact">
    ${live
    ? html`<div><${Chip} tone="coral">${M('previewLive')}<//></div>`
    : html`<${Text} kind="label">${M('previewLabel')}<//>`}
    <${Surface} kind="box">
      <${Stack} density="compact">
        <${Stack} direction="horizontal" align="between">
          <${Text} kind="mono" tone="muted">503 Service Unavailable<//><${Text} kind="mono" tone="muted">text/html<//>
        <//>
        <${Stack} density="compact" align="center">
          <${Text} kind="mono" tone="muted">${nodeId}<//>
          <${Text} kind="heading" size="small">${M('previewHead')}<//>
          <${Text}><strong>${message || M('previewEmpty')}</strong><//>
          <${Text} kind="caption" tone="muted">${M('previewSub')}<//>
        <//>
      <//>
    <//>
    <${Text} kind="caption" tone="muted">${live ? M('previewHintLive') : M('previewHint')}<//>
  <//>`;
}

export default function MaintenanceTab({ data, reload, switchPage }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const m = data.maintenance || { enabled: false, message: '', enabledAt: null, enabledBy: null };
  const d = data.dash || {};
  const c = d.counts || {};
  const nodeId = d.node_id || '';
  const [msg, setMsg] = useState(m.message || '');
  const [backupResult, setBackupResult] = useState(null);

  /** Seconds the node has been down, from the moment the operator turned it on. */
  const downSeconds = m.enabledAt ? Math.max(0, Math.round((Date.now() - new Date(m.enabledAt).getTime()) / 1000)) : null;

  async function setMode(on) {
    try {
      await setMaintenance(on, msg);
      reload();
    } catch (e) { showErr(e.message); }
  }

  /** The one question. Taking a node down used to happen on a single click; coming back does not
   *  ask, because that is the safe direction. */
  function askDown() {
    const body = html`<${Stack}>
      <${Text}>${M('askBody')}<//>
      <${Stack} density="compact">
        <${Text} kind="label">${M('askShown')}<//>
        <${Surface} kind="box"><${Text}><strong>${msg || M('previewEmpty')}</strong><//><//>
      <//>
      <div>
        <${ListRow} density="compact" name=${M('askStaysAdmin')} value="/v1/admin/*" />
        <${ListRow} density="compact" name=${M('askStaysHealth')} value="/v1/health" />
      </div>
    <//>`;
    confirm(body, () => setMode(true), { title: M('askTitle'), confirmLabel: M('takeBtn'), danger: true });
  }

  async function doBackup() {
    try {
      const r = await getBackup();
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aimeat-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setBackupResult({ ok: true, msg: t('dashboard.backupDownloaded') });
    } catch (e) { setBackupResult({ ok: false, msg: e.message }); }
  }

  function pickRestore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      if (!input.files?.[0]) return;
      confirm(t('dashboard.restoreConfirm'), async () => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const parsed = JSON.parse(/** @type {string} */ (reader.result));
            await apiRestore(parsed);
            setBackupResult({ ok: true, msg: t('dashboard.dataRestored') });
            reload();
          } catch (e) { setBackupResult({ ok: false, msg: e.message }); }
        };
        reader.readAsText(input.files[0]);
      }, { danger: true });
    };
    input.click();
  }

  const row = (title, why, badge, value) => html`<${Row} title=${title} why=${why} chip=${badge}
    value=${value != null ? html`<${Text} kind="mono">${value}<//>` : null} />`;
  const cell = (page, value, label, sub, coral) => ({ id: page || label, value, label, note: sub || undefined,
    tone: coral ? 'coral' : undefined, onClick: page ? () => switchPage(page) : undefined });

  return html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${Section} title=${M('now')} count="01" actions=${html`<${Action} onClick=${() => switchPage('config')}>${M('nowToConfig')}<//>`}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large" tone=${m.enabled ? 'danger' : 'plain'}>${m.enabled ? t('dashboard.maintenanceOn') : t('dashboard.operational')}<//>
          <${Text}>${m.enabled ? M('lineDown') : M('lineUp')}<//>
          <${Text} kind="mono" tone="muted">${m.enabled && m.enabledAt
    ? t('dashboard.since') + ': ' + dt(m.enabledAt) + (m.enabledBy ? ' · ' + t('dashboard.by') + ': ' + m.enabledBy : '')
    : t('dashboard.uptime') + ': ' + fmtUp(d.uptime_seconds) + ' · ' + t('dashboard.storage') + ': ' + (d.storage_type || '')}<//>
        <//>
        <div>
          ${row(M('rowPublic'), m.enabled ? M('rowPublicWhyDown') : M('rowPublicWhy'),
    html`<${Badge} type=${m.enabled ? 'danger' : 'healthy'} label=${m.enabled ? M('badgeRefusing') : M('badgeAnswering')} />`,
    m.enabled ? '503' : '200')}
          ${row(M('rowAdmin'), M('rowAdminWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/admin/*')}
          ${row(M('rowHealth'), M('rowHealthWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/health')}
          ${row(M('rowFed'), M('rowFedWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/federation/directory')}
        </div>
      <//>
    <//>

    <${NumeralBand} tone="plain" items=${[
      m.enabled && downSeconds != null
        ? cell(null, fmtUp(downSeconds), M('downFor'), dt(m.enabledAt), true)
        : cell(null, fmtUp(d.uptime_seconds), M('upLabel'), d.storage_type || ''),
      cell('owners', num(c.owners || 0), t('dashboard.registeredOwners')),
      cell('agents', num(c.agents || 0), t('dashboard.registeredAgents'), (c.active_agents_24h || 0) + ' ' + t('dashboard.active24h')),
      cell('boards', num(c.boards || 0), t('dashboard.activeBoards')),
    ]} />

    <${Section} title=${m.enabled ? M('bring') : M('take')} count="02" description=${m.enabled ? M('bringLead') : M('takeLead')}>
      <${Columns} layout="equal" collapse=${900}>
        <${Stack}>
          <${Stack} density="compact">
            <${Field} label=${M('msgLabel')} value=${msg} onInput=${e => setMsg(e.target.value)}
              placeholder=${t('dashboard.customMessagePlaceholder')} />
            <${Text} kind="caption" tone="muted">${m.enabled ? M('msgHintDown') : M('msgHint')}<//>
          <//>
          <${Stack} direction="wrap" align="center">
            ${m.enabled
    ? html`<${Action} kind="primary" onClick=${() => setMode(false)}>${M('bringBtn')}<//>`
    : html`<${Action} kind="primary" onClick=${askDown}>${M('takeBtn')}<//>`}
            ${m.enabled
    ? html`<${Action} onClick=${() => setMode(true)}>${M('msgSave')}<//>`
    : null}
            <${Text} kind="caption" tone="muted">${m.enabled ? M('bringNote') : M('takeNote')}<//>
          <//>
        <//>
        <${Preview} nodeId=${nodeId} message=${m.enabled ? m.message : msg} live=${m.enabled} />
      <//>
    <//>

    <${Section} title=${M('backup')} count="03" actions=${html`<${Action} onClick=${doBackup}>${t('dashboard.downloadBackup')}<//>`}>
      ${row(M('backupWhat'), M('backupWhatWhy'), html`<${Badge} type="muted" label="json" />`, M('backupOneFile'))}
      ${row(M('backupName'), M('backupNameWhy'), null, 'aimeat-backup-' + new Date().toISOString().slice(0, 10) + '.json')}
      ${backupResult && html`<${Text} tone=${backupResult.ok ? 'success' : 'danger'}>${backupResult.msg}<//>`}
    <//>

    <${Section} title=${M('restore')} count="04" actions=${html`<${Action} tone="danger" onClick=${pickRestore}>${t('dashboard.restoreFromFile')}<//>`}>
      <${Stack} density="compact">
        <${Surface} kind="aside" tone="danger"><${Text}><strong>${M('restoreWarnLead')}</strong> ${M('restoreWarn')}<//><//>
        <${Text} kind="caption" tone="muted">${M('restoreNote')}<//>
      <//>
    <//>

    <${ConfirmUI} />
  <//>`;
}
