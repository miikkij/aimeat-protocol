/**
 * @file public/views/admin/maintenance-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin maintenance page in the poster face (design canvas "AIMEAT Admin
 *   Maintenance"). Four sections in the order an operator asks: what answers and what does not
 *   right now, taking the node down or bringing it back with the line people will read and a
 *   preview of the page they get, the backup, and the restore. The three writes go through the
 *   same routes as before. Every part is a library component; the page passes data and writes no
 *   class.
 *
 * @structure
 *   - MaintenanceTab({ data, reload, switchPage }) — the four sections and the actions
 *   - the status word, what stays open, and the numeral strip
 *   - StatusPagePreview (components): the 503 page as a visitor gets it, drawn small
 *   - askBody: the confirm dialog's body — the line people read and the doors that stay open
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (admin group G2): Section, Verdict and Readings,
 *     FigureStrip, TextField, Loud and Action, Note, and the library's StatusPagePreview for the 503
 *     preview. The page sheet admin-maintenance.css goes.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 -- 2026-09-13 -- Compose the four section headings from the shared B1 shape.
 *   v2.0.0 — 2026-09-12 — The poster face: two cards become four sections, the full-width red
 *     button and the purple restore button become one ink slab and two underlined words, the
 *     message field gets the preview that shows what it actually writes, and taking the node
 *     down asks once before it happens (it asked nothing before).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, dt, Badge, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Label, Code } from '/components/Mark.js';
import { TextField } from '/components/TextField.js';
import { Row, Beside, Space } from '/components/Layout.js';
import { StatusPagePreview } from '/components/StatusPagePreview.js';
import { setMaintenance, getBackup, doRestore as apiRestore } from '/js/services/admin.js';

const M = (key, params) => t('dashboard.maint.' + key, params);

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
   *  ask, because that is the safe direction. The body stands inside the dialog's paragraph, so it is
   *  drawn from inline parts only. */
  function askDown() {
    const body = html`
      ${M('askBody')}
      <${Label} block>${M('askShown')}<//>
      <b>${msg || M('previewEmpty')}</b>
      <br />${M('askStaysAdmin')} <${Code}>/v1/admin/*<//>
      <br />${M('askStaysHealth')} <${Code}>/v1/health<//>`;
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

  const open = html`<${Badge} type="healthy" label=${M('badgeOpen')} />`;
  const stamp = m.enabled && m.enabledAt
    ? t('dashboard.since') + ': ' + dt(m.enabledAt) + (m.enabledBy ? ' · ' + t('dashboard.by') + ': ' + m.enabledBy : '')
    : t('dashboard.uptime') + ': ' + fmtUp(d.uptime_seconds) + ' · ' + t('dashboard.storage') + ': ' + (d.storage_type || '');

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${M('now')}
        doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${M('nowToConfig')}<//>`}>
        <${Verdict} word=${m.enabled ? t('dashboard.maintenanceOn') : t('dashboard.operational')} tone=${m.enabled ? 'danger' : undefined}
          line=${m.enabled ? M('lineDown') : M('lineUp')} stamp=${stamp}>
          <${Readings} rows=${[
            { key: 'public', name: M('rowPublic'), why: m.enabled ? M('rowPublicWhyDown') : M('rowPublicWhy'),
              mark: html`<${Badge} type=${m.enabled ? 'danger' : 'healthy'} label=${m.enabled ? M('badgeRefusing') : M('badgeAnswering')} />`,
              value: m.enabled ? '503' : '200' },
            { key: 'admin', name: M('rowAdmin'), why: M('rowAdminWhy'), mark: open, value: '/v1/admin/*' },
            { key: 'health', name: M('rowHealth'), why: M('rowHealthWhy'), mark: open, value: '/v1/health' },
            { key: 'fed', name: M('rowFed'), why: M('rowFedWhy'), mark: open, value: '/v1/federation/directory', last: true },
          ]} />
        <//>
      <//>

      <${FigureStrip} wrap items=${[
        m.enabled && downSeconds != null
          ? { key: 'time', n: fmtUp(downSeconds), tone: 'notice', label: M('downFor'), sub: dt(m.enabledAt) || undefined }
          : { key: 'time', n: fmtUp(d.uptime_seconds), label: M('upLabel'), sub: d.storage_type || undefined },
        { key: 'owners', n: num(c.owners || 0), label: t('dashboard.registeredOwners'), onClick: () => switchPage('owners') },
        { key: 'agents', n: num(c.agents || 0), label: t('dashboard.registeredAgents'), sub: (c.active_agents_24h || 0) + ' ' + t('dashboard.active24h'), onClick: () => switchPage('agents') },
        { key: 'boards', n: num(c.boards || 0), label: t('dashboard.activeBoards'), onClick: () => switchPage('boards') },
      ]} />

      <${Section} num="02" title=${m.enabled ? M('bring') : M('take')}>
        <${Note} kind="lead">${m.enabled ? M('bringLead') : M('takeLead')}<//>
        <${Beside} wide side=${html`<${StatusPagePreview} status="503 Service Unavailable" type="text/html" node=${nodeId}
            head=${M('previewHead')} message=${(m.enabled ? m.message : msg) || M('previewEmpty')} sub=${M('previewSub')}
            live=${m.enabled} label=${m.enabled ? M('previewLive') : M('previewLabel')}
            hint=${m.enabled ? M('previewHintLive') : M('previewHint')} />`}>
          <${TextField} label=${M('msgLabel')} value=${msg} onInput=${setMsg}
            placeholder=${t('dashboard.customMessagePlaceholder')} hint=${m.enabled ? M('msgHintDown') : M('msgHint')} />
          <${Space} above="section">
            <${Row} wrap gap="medium">
              ${m.enabled
                ? html`<${Loud} onClick=${() => setMode(false)}>${M('bringBtn')}<//>`
                : html`<${Loud} onClick=${askDown}>${M('takeBtn')}<//>`}
              ${m.enabled ? html`<${Action} small soft onClick=${() => setMode(true)}>${M('msgSave')}<//>` : null}
              <${Note} kind="hint" inline>${m.enabled ? M('bringNote') : M('takeNote')}<//>
            <//>
          <//>
        <//>
      <//>

      <${Section} num="03" title=${M('backup')}
        doors=${html`<${Action} small onClick=${doBackup}>${t('dashboard.downloadBackup')}<//>`}>
        <${Readings} rows=${[
          { key: 'what', name: M('backupWhat'), why: M('backupWhatWhy'), mark: html`<${Badge} type="muted" label="json" />`, value: M('backupOneFile') },
          { key: 'name', name: M('backupName'), why: M('backupNameWhy'), mark: null, value: 'aimeat-backup-' + new Date().toISOString().slice(0, 10) + '.json', last: true },
        ]} />
        ${backupResult && html`<${Note} kind="message" error=${!backupResult.ok}>${backupResult.msg}<//>`}
      <//>

      <${Section} num="04" title=${M('restore')}
        doors=${html`<${Action} small tone="danger" onClick=${pickRestore}>${t('dashboard.restoreFromFile')}<//>`}>
        <${Note} kind="aside"><b>${M('restoreWarnLead')}</b> ${M('restoreWarn')}<//>
        <${Note} kind="hint">${M('restoreNote')}<//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
