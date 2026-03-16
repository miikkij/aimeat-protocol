import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, useToast, Toast } from './shared.js';
import { grantRole } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function OwnersTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const owners = data.owners || [];
  if (owners.length === 0) return html`<${Empty} text=${t('dashboard.noOwnersFound')} />`;

  function doGrant(name) {
    confirm(t('dashboard.grantConfirm').replace('{name}', name), async () => {
      try { await grantRole(name, 'operator'); reload(); }
      catch (e) { showErr(e.message); }
    });
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-card">
      <div class="scrollable">
        <table>
          <thead><tr>
            <th>${t('dashboard.name')}</th>
            <th>${t('dashboard.displayName')}</th>
            <th>${t('dashboard.roles')}</th>
            <th>${t('dashboard.agents')}</th>
            <th>${t('dashboard.created')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${owners.map(ow => {
              const roles = ow.roles || [];
              const isOp = roles.includes('operator');
              return html`<tr>
                <td><strong>${escHtml(ow.name)}</strong></td>
                <td>${escHtml(ow.display_name || '\u2014')}</td>
                <td>${roles.length ? roles.map(r => html`<span class="tag" style="font-size:.75rem">${r}</span> `) : html`<span style="color:var(--text-dim)">—</span>`}</td>
                <td>${ow.agents ? ow.agents.length : 0}</td>
                <td style="color:var(--text-dim)">${dt(ow.created_at)}</td>
                <td>${!isOp && html`<button class="adm-btn-sm" onClick=${() => doGrant(ow.name)}>${t('dashboard.grantOperator')}</button>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>
    <${ConfirmUI} />
  `;
}
