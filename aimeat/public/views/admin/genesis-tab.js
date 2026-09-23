/**
 * @file public/views/admin/genesis-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for Genesis federation peers — shows peer stats and a table
 *   with per-peer approve/suspend/remove actions (operator tooling).
 *
 * @structure
 *   - GenesisTab (default export): renders StatsGrid (total/approved/suspended/pending) + peers table
 *   - doAction: confirm-then-call wrapper around approve/suspend/removeGenesisPeer with reload + error toast
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the peers as the shared table
 *     (stacking on a phone), its actions as underlined words. No inline styles left.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Stack, Table, Action, Text } from '/components/poster-parts.js';
import { approveGenesisPeer, suspendGenesisPeer, removeGenesisPeer } from '/js/services/admin.js';

export default function GenesisTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const gen = data.genesis;
  if (!gen) return html`<${Empty} text=${t('dashboard.genesisNotAvailable')} />`;

  const peers = gen.peers || [];

  async function doAction(fn, id, confirmKey, danger) {
    confirm(t(confirmKey || 'dashboard.confirmAction'), async () => {
      try { await fn(id); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: !!danger });
  }

  return html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Text} tone="muted">${t('dashboard.genesisExplain')}<//>
    <${ExpandableHelp} title=${t('dashboard.genesisHelpTitle')}>
      ${t('dashboard.genesisHelpDetail')}
    <//>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalPeers'), value: peers.length, tone: 'cyan' },
      { label: t('dashboard.approved'), value: peers.filter(p => p.status === 'approved' || p.status === 'active').length, tone: 'green' },
      { label: t('dashboard.suspended'), value: peers.filter(p => p.status === 'suspended').length, tone: 'red' },
      { label: t('dashboard.pending'), value: peers.filter(p => p.status === 'pending').length, tone: 'amber' },
    ]} />

    ${!peers.length
      ? html`<${Empty} text=${t('dashboard.noGenesisPeers')} />`
      : html`<${Table} collapse=${640} label=${t('dashboard.totalPeers')}
        headers=${[t('dashboard.nodeId'), 'URL', t('dashboard.statusLabel'), t('dashboard.lastSync'), t('dashboard.actions')]}
        rows=${peers.map(p => [
          { text: escHtml(p.genesis_node_id), mono: true },
          { text: escHtml(p.genesis_url || '\u2014'), mono: true },
          html`<${Badge} type=${p.status === 'approved' || p.status === 'active' ? 'healthy' : p.status === 'suspended' ? 'critical' : 'watch'} label=${p.status} />`,
          { text: dt(p.last_sync_at), mono: true },
          html`<${Stack} direction="wrap" density="compact">
            ${(p.status === 'pending' || p.status === 'suspended') && html`
              <${Action} tone="success" onClick=${() => doAction(approveGenesisPeer, p.id, 'dashboard.approveConfirm')}>${t('dashboard.approve')}<//>`}
            ${p.status !== 'suspended' && html`
              <${Action} onClick=${() => doAction(suspendGenesisPeer, p.id, 'dashboard.suspendConfirm', true)}>${t('dashboard.suspend')}<//>`}
            <${Action} tone="danger" onClick=${() => doAction(removeGenesisPeer, p.id, 'dashboard.removeConfirm', true)}>${t('dashboard.remove')}<//>
          <//>`,
        ])} />`}
    <${ConfirmUI} />
  <//>`;
}
