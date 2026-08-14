/**
 * @file public/views/admin/ghii-tab.js
 * @description Admin dashboard tab for managing GHII human users — lists accounts with
 *   verification level, email, TOTP status and timestamps, and lets the operator change
 *   verification level, remove an attached email, or delete a GHII.
 *
 * @structure
 *   - GhiiTab({ data, reload }): renders stats + user table with confirm-guarded actions
 *   - setLevel / doDelete / doRemoveEmail: call admin service (updateGhiiLevel, deleteGhii, removeGhiiEmail)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { updateGhiiLevel, deleteGhii, removeGhiiEmail } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function GhiiTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const users = data.ghiiUsers || [];

  async function setLevel(ghii, level) {
    try { await updateGhiiLevel(ghii, parseInt(level)); reload(); }
    catch (e) { showErr(e.message); }
  }

  function doDelete(ghii) {
    confirm(t('dashboard.deleteGhiiConfirm') + ' ' + ghii + '?', async () => {
      try { await deleteGhii(ghii); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  function doRemoveEmail(u) {
    confirm(t('dashboard.ghiiRemoveEmailConfirm').replace('{name}', u.display_name || u.username), async () => {
      try { await removeGhiiEmail(u.ghii); showOk(t('dashboard.ghiiEmailRemoved')); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-card" style="margin-bottom:12px">
      <h2>GHII <span style="font-weight:400;font-size:.85rem;color:var(--text-dim)">— ${t('dashboard.ghiiExplain')}</span></h2>
      <${ExpandableHelp} title=${t('dashboard.ghiiLevelsTitle')}>
        <div>
          <div style="margin-bottom:4px"><${Badge} type="critical" /> ${t('dashboard.ghiiLevelL0')}</div>
          <div style="margin-bottom:4px"><${Badge} type="watch" /> ${t('dashboard.ghiiLevelL1')}</div>
          <div style="margin-bottom:4px"><${Badge} type="healthy" /> ${t('dashboard.ghiiLevelL2')}</div>
        </div>
      </${ExpandableHelp}>
      <${ExpandableHelp} title="TOTP">
        <p>${t('dashboard.ghiiTotpExplain')}</p>
      </${ExpandableHelp}>
      <${ExpandableHelp} title=${t('dashboard.ghiiVerificationExplain').split('.')[0]}>
        <p>${t('dashboard.ghiiVerificationExplain')}</p>
      </${ExpandableHelp}>
    </div>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalGhiiUsers'), value: users.length, tone: 'cyan' },
      { label: t('dashboard.totpEnabled'), value: users.filter(u => u.totp_enabled).length, tone: 'green' },
      { label: t('dashboard.verifiedL2'), value: users.filter(u => u.verification_level === 2).length, tone: 'purple' },
    ]} />

    ${!users.length
      ? html`<${Empty} text=${t('dashboard.noGhiiUsers')} />`
      : html`<table>
        <thead><tr>
          <th>GHII</th>
          <th>${t('dashboard.displayName')}</th>
          <th>${t('dashboard.ghiiEmail')}</th>
          <th>${t('dashboard.verification')}</th>
          <th>${t('dashboard.totp')}</th>
          <th>${t('dashboard.lastLogin')}</th>
          <th>${t('dashboard.created')}</th>
          <th>${t('dashboard.actions')}</th>
        </tr></thead>
        <tbody>
          ${users.map(u => {
            const vBadge = u.verification_level === 2 ? 'healthy' : u.verification_level === 1 ? (u.email_verified ? 'healthy' : 'watch') : 'critical';
            return html`<tr>
              <td><code>${escHtml(u.ghii).substring(0, 16)}...</code></td>
              <td>${escHtml(u.display_name || u.username || '-')}</td>
              <td>${u.masked_email
                ? html`<span style="color:${u.email_verified ? 'var(--green,#22c55e)' : 'var(--text-dim)'}">${escHtml(u.masked_email)}</span>`
                : html`<span style="color:var(--text-dim)">–</span>`
              }</td>
              <td><${Badge} type=${vBadge} /> L${u.verification_level}</td>
              <td><${Badge} type=${u.totp_enabled ? 'healthy' : 'critical'} /></td>
              <td>${u.last_login_at ? dt(u.last_login_at) : html`<span style="color:var(--text-dim)">–</span>`}</td>
              <td>${dt(u.created_at)}</td>
              <td>
                <select onChange=${e => setLevel(u.ghii, e.target.value)}>
                  <option value="0" selected=${u.verification_level === 0}>L0</option>
                  <option value="1" selected=${u.verification_level === 1}>L1</option>
                  <option value="2" selected=${u.verification_level === 2}>L2</option>
                </select>
                ${' '}
                ${u.masked_email ? html`<button class="adm-btn-sm" onClick=${() => doRemoveEmail(u)} title=${t('dashboard.ghiiRemoveEmail')}>✉✕</button> ` : ''}
                <button class="adm-btn-sm" onClick=${() => doDelete(u.ghii)}>${t('dashboard.deleteLabel')}</button>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>`
    }
    <${ConfirmUI} />
  `;
}
