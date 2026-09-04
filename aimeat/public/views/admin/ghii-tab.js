/**
 * @file public/views/admin/ghii-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for managing GHII human users — lists accounts with
 *   verification level, email, TOTP status and timestamps, and lets the operator change
 *   verification level, remove an attached email, or delete a GHII.
 *
 * @structure
 *   - GhiiTab({ data, reload }): renders stats + user table with confirm-guarded actions
 *   - setLevel / doDelete / doRemoveEmail / doResetTotp: call admin service
 *
 * @version-history
 *   v1.1.0 — 2026-09-04 — The two-step sign-in reset, on the rows that have it armed. Removing it
 *     the normal way needs a code from the device the person lost, so this was the account's only
 *     way back and it did not exist. The table gained its scroll box in the same change: at 390px
 *     it is 766px wide against a page that clips, so the actions column was unreachable on a phone
 *     and the reset button is the last control in it.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { updateGhiiLevel, deleteGhii, removeGhiiEmail, resetGhiiTotp } from '/js/services/admin.js';
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

  // The answer to "I lost my phone and my backup codes". It hands the operator nothing: the
  // password still stands, and the person is told on their own feed who did this.
  function doResetTotp(u) {
    confirm(t('dashboard.ghiiTotpResetConfirm').replace('{name}', u.display_name || u.username), async () => {
      try { await resetGhiiTotp(u.username); showOk(t('dashboard.ghiiTotpResetDone')); reload(); }
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
      // Eight columns and an actions cell: 766px wide, against a page that clips at overflow-x
      // hidden. On a phone the actions column was simply cut off, and the reset button added here
      // is the last control in it. The box scrolls; the page still must not.
      : html`<div class="adm-table-wrap"><table>
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
                ${u.totp_enabled ? html`<button class="adm-btn-sm" onClick=${() => doResetTotp(u)} title=${t('dashboard.ghiiTotpResetHint')}>${t('dashboard.ghiiTotpReset')}</button> ` : ''}
                <button class="adm-btn-sm" onClick=${() => doDelete(u.ghii)}>${t('dashboard.deleteLabel')}</button>
              </td>
            </tr>`;
          })}
        </tbody>
      </table></div>`
    }
    <${ConfirmUI} />
  `;
}
