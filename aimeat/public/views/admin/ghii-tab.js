import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp } from './shared.js';
import { updateGhiiLevel, deleteGhii } from '/js/services/admin.js';

export default function GhiiTab({ data, reload }) {
  const users = data.ghiiUsers || [];

  async function setLevel(ghii, level) {
    try { await updateGhiiLevel(ghii, parseInt(level)); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function doDelete(ghii) {
    if (!confirm(t('dashboard.deleteGhiiConfirm') + ' ' + ghii + '?')) return;
    try { await deleteGhii(ghii); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  return html`
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
      { label: t('dashboard.totalGhiiUsers'), value: users.length, color: '#06b6d4' },
      { label: t('dashboard.totpEnabled'), value: users.filter(u => u.totp_enabled).length, color: '#22c55e' },
      { label: t('dashboard.verifiedL2'), value: users.filter(u => u.verification_level === 2).length, color: '#a855f7' },
    ]} />

    ${!users.length
      ? html`<${Empty} text=${t('dashboard.noGhiiUsers')} />`
      : html`<table>
        <thead><tr>
          <th>GHII</th>
          <th>${t('dashboard.displayName')}</th>
          <th>${t('dashboard.verification')}</th>
          <th>${t('dashboard.totp')}</th>
          <th>${t('dashboard.created')}</th>
          <th>${t('dashboard.actions')}</th>
        </tr></thead>
        <tbody>
          ${users.map(u => {
            const vBadge = u.verification_level === 2 ? 'healthy' : u.verification_level === 1 ? 'watch' : 'critical';
            return html`<tr>
              <td><code>${escHtml(u.ghii).substring(0, 16)}...</code></td>
              <td>${escHtml(u.display_name || u.username || '-')}</td>
              <td><${Badge} type=${vBadge} /> L${u.verification_level}</td>
              <td><${Badge} type=${u.totp_enabled ? 'healthy' : 'critical'} /></td>
              <td>${dt(u.created_at)}</td>
              <td>
                <select onChange=${e => setLevel(u.ghii, e.target.value)}>
                  <option value="0" selected=${u.verification_level === 0}>L0</option>
                  <option value="1" selected=${u.verification_level === 1}>L1</option>
                  <option value="2" selected=${u.verification_level === 2}>L2</option>
                </select>
                ${' '}
                <button class="adm-btn-sm" onClick=${() => doDelete(u.ghii)}>${t('dashboard.deleteLabel')}</button>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>`
    }
  `;
}
