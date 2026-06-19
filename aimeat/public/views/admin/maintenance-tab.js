import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, EconRow, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { setMaintenance, getBackup, doRestore as apiRestore } from '/js/services/admin.js';

export default function MaintenanceTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const m = data.maintenance || { enabled: false, message: '', enabledAt: null, enabledBy: null };
  const [msg, setMsg] = useState(m.message || '');
  const [backupResult, setBackupResult] = useState(null);

  async function toggle(on) {
    try {
      await setMaintenance(on, msg);
      reload();
    } catch (e) { showErr(e.message); }
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

  const color = m.enabled ? '#ef4444' : '#22c55e';
  const status = m.enabled ? t('dashboard.maintenanceOn') : t('dashboard.operational');

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-card" style="border-left:4px solid ${color}">
      <h2>${t('dashboard.maintenanceMode')}</h2>
      <div class="adm-stat adm-mb-md" style="color:${color}">${status}</div>
      ${m.enabled && html`<div class="adm-mb-md">
        ${m.message && html`<${EconRow} label=${t('dashboard.message')} value=${escHtml(m.message)} />`}
        ${m.enabledAt && html`<${EconRow} label=${t('dashboard.since')} value=${dt(m.enabledAt)} />`}
        ${m.enabledBy && html`<${EconRow} label=${t('dashboard.by')} value=${escHtml(m.enabledBy)} />`}
      </div>`}
      <div class="adm-mt-lg">
        <label class="adm-text-sm adm-text-dim" style="display:block;margin-bottom:4px">${t('dashboard.customMessage')}</label>
        <input type="text" value=${msg} onInput=${e => setMsg(e.target.value)}
          placeholder=${t('dashboard.customMessagePlaceholder')}
          style="width:100%;margin-bottom:12px" />
        ${m.enabled
          ? html`<button class="adm-btn" style="background:#22c55e;width:100%" onClick=${() => toggle(false)}>${t('dashboard.disableMaintenance')}</button>`
          : html`<button class="adm-btn" style="background:#ef4444;width:100%" onClick=${() => toggle(true)}>${t('dashboard.enableMaintenance')}</button>`
        }
      </div>
      <p class="adm-text-dim adm-text-xs adm-mt-md">${t('dashboard.maintenanceExplain')}</p>
    </div>

    <!-- Backup/Restore -->
    <div class="adm-card adm-mt-lg">
      <h2>${t('dashboard.backupRestore')}</h2>
      <div class="adm-flex-wrap" style="gap:12px">
        <button class="adm-btn" style="flex:1;min-width:140px" onClick=${doBackup}>${t('dashboard.downloadBackup')}</button>
        <button class="adm-btn" style="flex:1;min-width:140px;background:#a855f7" onClick=${pickRestore}>${t('dashboard.restoreFromFile')}</button>
      </div>
      ${backupResult && html`<div class="adm-mt-sm adm-text-base" style="color:${backupResult.ok ? '#22c55e' : '#ef4444'}">${escHtml(backupResult.msg)}</div>`}
      <p class="adm-text-dim adm-text-xs adm-mt-sm">${t('dashboard.backupExplain')}</p>
    </div>
    <${ConfirmUI} />
  `;
}
