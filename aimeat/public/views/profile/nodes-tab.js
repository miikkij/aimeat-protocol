/**
 * @file nodes-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing personal node registrations, visibility,
 *   agent assignments, tunnel URLs, and mailbox status.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, tab Actions, Section, ListRow that
 *     opens, KeyValue, Fold, Steps, Field); no own classes. The status dot is a chip, visibility a
 *     pair of radio tabs, the setup guide a fold; the stats tab shows NodeStatsBody inside this frame.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-16 — Initial nodes tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (#1): tunnel-URL copy button uses
 *     canonical <CopyButton> (toast preserved via onCopied).
 *   v1.3.0 — 2026-06-02 — Component unification (#11): node status dot uses
 *     canonical <StatusDot> (online/offline/degraded/detached) instead of the
 *     bespoke 10px .pn-status-dot (now 8px, with title tooltip added).
 *   v1.4.0 — 2026-08-08 — The tunnel-URL copy button is btn-ghost btn-sm btn-copy-inline with the shared default
 *       labels; .pn-copy-btn and the profile.nodes.copyUrl/copied keys are gone.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { Page, Section, Fold, Stack, ListRow, KeyValue, Steps, Chip, Action, CopyAction, Field, Surface, Text } from '/components/poster-parts.js';
import { useConfirm } from '/components/Modal.js';
import * as nodesService from '/js/services/nodes.js';
import { getNodeUrl } from '/js/services/auth.js';
import { NodeStatsBody } from './node-stats-tab.js';
import { swallowed } from '/js/swallowed.js';

/* Default export below wraps the node list and Node stats into one page with
 * sub-tabs — Node stats left the sidebar menu (2026-06-10 sidebar reorg). */
function NodesList({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const NODE_URL = getNodeUrl();
  const tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
  const [nodes, setNodes] = useState(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedSetups, setExpandedSetups] = useState(new Set());

  useEffect(() => {
    if (session) loadData();
    // Load nodes once the session is available. loadData closes over onStats (prop)
    // and stable service/setters; keyed on session intentionally (liveRef below
    // handles subsequent refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadData() {
    try {
      const list = await nodesService.listNodes();
      setNodes(list);
      onStats?.({ nodes: list.length });
    } catch (err) { swallowed('nodes-tab', err); setNodes([]); onStats?.({ nodes: 0 }); }
  }

  async function handleRegister(nodeId, vis, gaiis) {
    let nid = nodeId.trim();
    if (!nid) { showToast(t('profile.nodes.registerFailed'), true); return; }
    const agentGaiis = gaiis ? gaiis.split(',').map(s => s.trim()).filter(Boolean) : [];
    const resp = await nodesService.registerNode(nid, session.owner, session.publicKey, agentGaiis, vis);
    if (resp.ok !== false) { showToast(t('profile.nodes.registered')); setShowNodeForm(false); loadData(); }
    else showToast(t('profile.nodes.registerFailed'), true);
  }

  async function handleDetach(nodeId) {
    confirm(t('profile.nodes.detachConfirm'), async () => {
      const resp = await nodesService.detachNode(nodeId);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
      showToast(t('profile.nodes.detachedToast'));
      loadData();
    }, { danger: true });
  }

  async function handleSetVis(nodeId, vis) {
    const resp = await nodesService.setVisibility(nodeId, vis);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.nodes.visUpdated'));
    loadData();
  }

  const toggle = (set, setter, idx) => {
    const s = new Set(set);
    if (s.has(idx)) s.delete(idx); else s.add(idx);
    setter(s);
  };
  const statusTone = (st) => (st === 'online' ? 'success' : st === 'degraded' ? 'coral' : 'danger');

  return html`<${Section} title=${t('profile.nodes.title')} description=${t('profile.nodes.desc')}
    actions=${html`<${Action} kind="primary" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}<//>`}>
    <${Stack}>
      ${showNodeForm && html`<${NodeForm} onRegister=${handleRegister} onCancel=${() => setShowNodeForm(false)} />`}
      ${!nodes ? html`<${Spinner} text=${t('profile.nodes.loading')} />`
        : nodes.length === 0 ? html`<${Surface} kind="aside"><${Text} tone="muted">${t('profile.nodes.empty')}<//><//>`
        : html`<${Stack} density="compact">${nodes.map((node, idx) => {
          const statusClass = node.status || 'offline';
          const statusLabel = t('profile.nodes.' + statusClass) || statusClass;
          const isPublic = node.visibility === 'public';
          const agentCount = node.agent_gaiis?.length || 0;
          const agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
          const mailboxCount = node.mailbox?.items || 0;
          const isOpen = expandedNodes.has(idx);
          const setupOpen = expandedSetups.has(idx);
          const mbUsedMB = ((node.mailbox?.used_bytes || 0) / 1024 / 1024).toFixed(1);
          const mbQuotaMB = ((node.mailbox?.quota_bytes || 0) / 1024 / 1024).toFixed(0);

          return html`<${ListRow} key=${node.node_id || idx} name=${escHtml(node.node_id)} nameTitle=${statusLabel}
            detail=${`${agentCount} ${agentWord} · ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}`}
            value=${html`<${Stack} direction="wrap" density="compact">
              <${Chip} tone=${isPublic ? 'success' : 'muted'}>${isPublic ? t('profile.nodes.public') : t('profile.nodes.private')}<//>
              <${Chip} tone=${statusTone(statusClass)}>${statusLabel}<//>
            <//>`}
            onOpen=${() => toggle(expandedNodes, setExpandedNodes, idx)}>
            ${isOpen && html`<${Stack}>
              <${KeyValue} label=${t('profile.nodes.tunnelUrl')} value=${html`<${Stack} direction="wrap" density="compact" align="center">
                <${Text} kind="mono">${tunnelUrl}<//>
                <${CopyAction} kind="text" text=${tunnelUrl} onCopied=${() => showToast(t('common.copied'))} />
              <//>`} />
              <${KeyValue} label=${t('profile.nodes.agentList')} value=${node.agent_gaiis?.length > 0
                ? html`<${Stack} density="compact">${node.agent_gaiis.map(g => html`<${Text} key=${g} kind="mono">${escHtml(g)}<//>`)}<//>`
                : html`<${Text} kind="caption" tone="muted">${t('profile.nodes.noAgents')}<//>`} />
              <${KeyValue} label=${t('profile.nodes.mailbox')} value=${`${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)`} />
              <${KeyValue} label=${t('profile.nodes.lastSeen')} value=${node.last_seen ? timeAgo(node.last_seen) : '-'} />
              <${KeyValue} label=${t('profile.nodes.visibility')} value=${html`<${Stack} direction="horizontal" density="compact" role="radiogroup" label=${t('profile.nodes.visibility')}>
                <${Action} kind="tab" semantics="radio" selected=${!isPublic} onClick=${() => handleSetVis(node.node_id, 'private')}>${t('profile.nodes.private')}<//>
                <${Action} kind="tab" semantics="radio" selected=${isPublic} onClick=${() => handleSetVis(node.node_id, 'public')}>${t('profile.nodes.public')}<//>
              <//>`} />
              <${Fold} title=${t('profile.nodes.setupTitle')} open=${setupOpen} onToggle=${() => toggle(expandedSetups, setExpandedSetups, idx)}>
                <${Stack}>
                  <${Steps} items=${[t('profile.nodes.setupStep1'), t('profile.nodes.setupStep2'), t('profile.nodes.setupStep3'), t('profile.nodes.setupStep4')]} />
                  <${Stack} direction="horizontal" align="start">
                    <${Action} href="/docs/personal-node-setup-guide.md" target="_blank">${t('profile.nodes.setupDocs')} →<//>
                  <//>
                <//>
              <//>
              <${Stack} direction="horizontal" align="start">
                <${Action} tone="danger" onClick=${() => handleDetach(node.node_id)}>${t('profile.nodes.detachBtn')}<//>
              <//>
            <//>`}
          <//>`;
        })}<//>`}
    <//>
    <${ConfirmUI} />
  <//>`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`<${Surface} kind="box"><${Stack}>
    <${Text} kind="heading" size="small">${t('profile.nodes.addTitle')}<//>
    <${Field} label=${t('profile.nodes.nodeIdLabel')} placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} />
    <${Stack} density="compact">
      <${Text} kind="label">${t('profile.nodes.visLabel')}<//>
      <${Stack} direction="horizontal" density="compact" role="radiogroup" label=${t('profile.nodes.visLabel')}>
        <${Action} kind="tab" semantics="radio" selected=${vis === 'private'} onClick=${() => setVis('private')}>${t('profile.nodes.private')}<//>
        <${Action} kind="tab" semantics="radio" selected=${vis === 'public'} onClick=${() => setVis('public')}>${t('profile.nodes.public')}<//>
      <//>
    <//>
    <${Field} label=${t('profile.nodes.agentGaiisLabel')} placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${e => setGaiis(e.target.value)} />
    <${Stack} direction="horizontal" align="start">
      <${Action} kind="primary" onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}<//>
      <${Action} onClick=${onCancel}>${t('profile.nodes.cancelBtn')}<//>
    <//>
  <//><//>`;
}

/* ── Page wrapper: Nodes | Node stats sub-tabs (Node stats merged here from the menu) ── */
export default function NodesTab(props) {
  const [sub, setSub] = useState('nodes');
  return html`<${Page} width="wide" title=${t('profile.tabs.nodes')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInfra') }, { label: t('profile.tabs.nodes') }]}>
    <${Stack}>
      <${Stack} direction="wrap" density="compact" role="tablist" label=${t('profile.tabs.nodes')}>
        <${Action} kind="tab" semantics="tab" selected=${sub === 'nodes'} onClick=${() => setSub('nodes')}>${t('profile.tabs.nodes')}<//>
        <${Action} kind="tab" semantics="tab" selected=${sub === 'stats'} onClick=${() => setSub('stats')}>${t('profile.tabs.nodeStats')}<//>
      <//>
      ${sub === 'nodes' ? html`<${NodesList} ...${props} />`
        : html`<${Text} kind="heading" size="small">${t('profile.nodeStats.title')}<//><${Text} kind="lead">${t('profile.nodeStats.desc')}<//><${NodeStatsBody} />`}
    <//>
  <//>`;
}
