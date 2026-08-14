/**
 * @file public/views/admin/owners-tab.js
 * @description Admin dashboard tab listing registered owners (name, display name, roles,
 *   agent count, created date) with operator actions to grant and revoke the operator role.
 *
 * @structure
 *   - OwnersTab({ data, reload }): renders the owners table
 *   - doGrant(name): confirms then grants the operator role via grantRole and reloads
 *   - doRevoke(name): confirms then removes the operator role via revokeRole and reloads
 *
 * @version-history
 *   v1.2.0 — 2026-08-14 — Revoke Operator action next to Grant Operator.
 *   v1.1.0 — 2026-07-18 — Vaihe 2d: hand-rolled <table> → canonical admin <DataTable> (rows/headers
 *     model); cell content preserved verbatim.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, useToast, Toast, DataTable } from './shared.js';
import { grantRole, revokeRole } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

export default function OwnersTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const owners = data.owners || [];
  if (owners.length === 0) return html`<${Empty} text=${t('dashboard.noOwnersFound')} />`;

  function doGrant(name) {
    confirm(t('dashboard.grantConfirm').replace('{name}', name), async () => {
      try { await grantRole(name, 'operator'); reload(); }
      catch (e) { showErr(e.message); }
    });
  }

  function doRevoke(name) {
    confirm(t('dashboard.revokeConfirm').replace('{name}', name), async () => {
      try { await revokeRole(name, 'operator'); reload(); }
      catch (e) { showErr(e.message); }
    });
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${DataTable}
      scroll=${true}
      headers=${[t('dashboard.name'), t('dashboard.displayName'), t('dashboard.roles'), t('dashboard.agents'), t('dashboard.created'), '']}
      rows=${owners.map(ow => {
        const roles = ow.roles || [];
        const isOp = roles.includes('operator');
        return [
          html`<strong>${escHtml(ow.name)}</strong>`,
          escHtml(ow.display_name || '—'),
          roles.length ? html`${roles.map(r => html`<span class="tag" style="font-size:.75rem">${r}</span> `)}` : html`<span style="color:var(--text-dim)">—</span>`,
          ow.agents ? ow.agents.length : 0,
          html`<span style="color:var(--text-dim)">${dt(ow.created_at)}</span>`,
          isOp
            ? html`<button class="adm-btn-sm" onClick=${() => doRevoke(ow.name)}>${t('dashboard.revokeOperator')}</button>`
            : html`<button class="adm-btn-sm" onClick=${() => doGrant(ow.name)}>${t('dashboard.grantOperator')}</button>`,
        ];
      })}
    />
    <${ConfirmUI} />
  `;
}
