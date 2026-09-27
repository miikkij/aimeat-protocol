/**
 * @file public/views/admin/genesis-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for Genesis federation peers — shows peer stats and a table
 *   with per-peer approve/suspend/remove actions (operator tooling). The tab draws library
 *   components and passes them data; it writes no class and no style.
 *
 * @structure
 *   - GenesisTab (default export): renders StatsGrid (total/approved/suspended/pending) + peers List
 *   - doAction: confirm-then-call wrapper around approve/suspend/removeGenesisPeer with reload + error toast
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class or inline style: the explanation is a hint,
 *     the peers table is a List (the node id and address in typewriter, the status mark, the last
 *     sync as a time, the three actions as action links; suspend and remove in the danger tone,
 *     which already asked to be confirmed as dangerous). The cells say their column on a phone. A long
 *     list still scrolls inside its box (32rem, main's .scrollable 600px).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { approveGenesisPeer, suspendGenesisPeer, removeGenesisPeer } from '/js/services/admin.js';
import { List, Row as ListRow, Name, Cell, When, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Space } from '/components/Layout.js';
import { Note } from '/components/Note.js';

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

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Note}>${t('dashboard.genesisExplain')}<//>
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
    : html`<${Space} above="medium"><${Box} scroll="page">
        <${List} cols="name-code-state-when-doors" labels
          head=${[t('dashboard.nodeId'), 'URL', t('dashboard.statusLabel'), t('dashboard.lastSync'), t('dashboard.actions')]}>
          ${peers.map(p => html`
            <${ListRow} key=${p.id}>
              <${Name} asKey>${escHtml(p.genesis_node_id)}<//>
              <${Cell} meta>${escHtml(p.genesis_url || '—')}<//>
              <${Cell}><${Badge} type=${p.status === 'approved' || p.status === 'active' ? 'healthy' : p.status === 'suspended' ? 'critical' : 'watch'} label=${p.status} /><//>
              <${When}>${dt(p.last_sync_at)}<//>
              <${Doors}>
                ${(p.status === 'pending' || p.status === 'suspended') && html`
                  <${Action} small row onClick=${() => doAction(approveGenesisPeer, p.id, 'dashboard.approveConfirm')}>${t('dashboard.approve')}<//>`}
                ${p.status !== 'suspended' && html`
                  <${Action} small row tone="danger" onClick=${() => doAction(suspendGenesisPeer, p.id, 'dashboard.suspendConfirm', true)}>${t('dashboard.suspend')}<//>`}
                <${Action} small row tone="danger" onClick=${() => doAction(removeGenesisPeer, p.id, 'dashboard.removeConfirm', true)}>${t('dashboard.remove')}<//>
              <//>
            <//>`)}
        <//>
      <//><//>`}
    <${ConfirmUI} />
  `;
}
