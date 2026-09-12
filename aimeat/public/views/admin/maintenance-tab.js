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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, fmtUp, dt, Badge, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { setMaintenance, getBackup, doRestore as apiRestore } from '/js/services/admin.js';

const M = (key, params) => t('dashboard.maint.' + key, params);

/** The 503 page as a visitor gets it, drawn small. The wording follows the page the node serves
 *  (src/server-bootstrap/middleware-guards.ts), so the preview is the page and not a drawing of
 *  one; when that page changes, this changes with it. */
function Preview({ nodeId, message, live }) {
  return html`
    <div>
      ${live
    ? html`<span class="adm-maint-live"><i></i>${M('previewLive')}</span>`
    : html`<div class="adm-maint-lbl">${M('previewLabel')}</div>`}
      <div class="adm-maint-prev">
        <div class="adm-maint-prev-top"><span>503 Service Unavailable</span><span>text/html</span></div>
        <div class="adm-maint-prev-body">
          <div class="adm-maint-prev-node">${nodeId}</div>
          <h3>${M('previewHead')}</h3>
          <p class="adm-maint-prev-msg">${message || M('previewEmpty')}</p>
          <p class="adm-maint-prev-sub">${M('previewSub')}</p>
        </div>
      </div>
      <p class="adm-maint-hint">${live ? M('previewHintLive') : M('previewHint')}</p>
    </div>`;
}

export default function MaintenanceTab({ data, reload, switchPage }) {
  useViewCSS('/css/views/admin-maintenance.css');
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
    const body = html`<span class="adm-maint-ask">
      <span>${M('askBody')}</span>
      <span class="adm-maint-lbl">${M('askShown')}</span>
      <span class="adm-maint-ask-msg">${msg || M('previewEmpty')}</span>
      <span class="adm-maint-ask-rows">
        <span class="adm-maint-ask-row">${M('askStaysAdmin')}<code>/v1/admin/*</code></span>
        <span class="adm-maint-ask-row">${M('askStaysHealth')}<code>/v1/health</code></span>
      </span>
    </span>`;
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

  const row = (title, why, badge, value, last) => html`
    <div class="adm-mrow ${last ? 'adm-mrow--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${badge}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
  const cell = (page, value, label, sub, coral) => page
    ? html`<button type="button" onClick=${() => switchPage(page)}><b>${value}</b><span>${label}</span>${sub ? html`<small>${sub}</small>` : null}</button>`
    : html`<div><b class=${coral ? 'og-coral-num' : ''}>${value}</b><span>${label}</span>${sub ? html`<small>${sub}</small>` : null}</div>`;

  return html`
    <div class="og adm-maint">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${M('now')}<small>01</small></h2>
          <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('config')}>${M('nowToConfig')}</button></div></div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status ${m.enabled ? 'danger' : ''}">${m.enabled ? t('dashboard.maintenanceOn') : t('dashboard.operational')}</div>
            <p class="adm-alert-line">${m.enabled ? M('lineDown') : M('lineUp')}</p>
            <div class="adm-ov-up">
              ${m.enabled && m.enabledAt
    ? t('dashboard.since') + ': ' + dt(m.enabledAt) + (m.enabledBy ? ' · ' + t('dashboard.by') + ': ' + m.enabledBy : '')
    : t('dashboard.uptime') + ': ' + fmtUp(d.uptime_seconds) + ' · ' + t('dashboard.storage') + ': ' + (d.storage_type || '')}
            </div>
          </div>
          <div>
            ${row(M('rowPublic'), m.enabled ? M('rowPublicWhyDown') : M('rowPublicWhy'),
    html`<${Badge} type=${m.enabled ? 'danger' : 'healthy'} label=${m.enabled ? M('badgeRefusing') : M('badgeAnswering')} />`,
    m.enabled ? '503' : '200')}
            ${row(M('rowAdmin'), M('rowAdminWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/admin/*')}
            ${row(M('rowHealth'), M('rowHealthWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/health')}
            ${row(M('rowFed'), M('rowFedWhy'), html`<${Badge} type="healthy" label=${M('badgeOpen')} />`, '/v1/federation/directory', true)}
          </div>
        </div>
      </section>

      <div class="og-strip">
        ${m.enabled && downSeconds != null
    ? cell(null, fmtUp(downSeconds), M('downFor'), dt(m.enabledAt), true)
    : cell(null, fmtUp(d.uptime_seconds), M('upLabel'), d.storage_type || '')}
        ${cell('owners', num(c.owners || 0), t('dashboard.registeredOwners'))}
        ${cell('agents', num(c.agents || 0), t('dashboard.registeredAgents'), (c.active_agents_24h || 0) + ' ' + t('dashboard.active24h'))}
        ${cell('boards', num(c.boards || 0), t('dashboard.activeBoards'))}
      </div>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${m.enabled ? M('bring') : M('take')}<small>02</small></h2></div>
        <p class="adm-maint-lead">${m.enabled ? M('bringLead') : M('takeLead')}</p>
        <div class="adm-maint-two">
          <div>
            <div class="adm-maint-lbl">${M('msgLabel')}</div>
            <div class="adm-maint-fld">
              <input type="text" value=${msg} onInput=${e => setMsg(e.target.value)}
                placeholder=${t('dashboard.customMessagePlaceholder')} />
            </div>
            <p class="adm-maint-hint">${m.enabled ? M('msgHintDown') : M('msgHint')}</p>
            <div class="adm-maint-act">
              ${m.enabled
    ? html`<button class="adm-btn" onClick=${() => setMode(false)}>${M('bringBtn')}</button>`
    : html`<button class="adm-btn" onClick=${askDown}>${M('takeBtn')}</button>`}
              ${m.enabled
    ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setMode(true)}>${M('msgSave')}</button>`
    : null}
              <p>${m.enabled ? M('bringNote') : M('takeNote')}</p>
            </div>
          </div>
          <${Preview} nodeId=${nodeId} message=${m.enabled ? m.message : msg} live=${m.enabled} />
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('backup')}<small>03</small></h2>
          <div class="og-doors"><button type="button" class="og-door" onClick=${doBackup}>${t('dashboard.downloadBackup')}</button></div></div>
        ${row(M('backupWhat'), M('backupWhatWhy'), html`<${Badge} type="muted" label="json" />`, M('backupOneFile'))}
        ${row(M('backupName'), M('backupNameWhy'), null, 'aimeat-backup-' + new Date().toISOString().slice(0, 10) + '.json', true)}
        ${backupResult && html`<p class="adm-maint-said ${backupResult.ok ? 'is-ok' : 'is-bad'}">${backupResult.msg}</p>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('restore')}<small>04</small></h2>
          <div class="og-doors"><button type="button" class="og-door og-door--danger" onClick=${pickRestore}>${t('dashboard.restoreFromFile')}</button></div></div>
        <div class="adm-maint-warn"><b>${M('restoreWarnLead')}</b> ${M('restoreWarn')}</div>
        <p class="adm-maint-note">${M('restoreNote')}</p>
      </section>

      <${ConfirmUI} />
    </div>
  `;
}
