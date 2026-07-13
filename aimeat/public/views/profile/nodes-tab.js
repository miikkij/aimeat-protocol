/**
 * @file nodes-tab.js
 * @description Profile tab for managing personal node registrations, visibility,
 *   agent assignments, tunnel URLs, and mailbox status.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial nodes tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (#1): tunnel-URL copy button uses
 *     canonical <CopyButton> (toast preserved via onCopied).
 *   v1.3.0 — 2026-06-02 — Component unification (#11): node status dot uses
 *     canonical <StatusDot> (online/offline/degraded/detached) instead of the
 *     bespoke 10px .pn-status-dot (now 8px, with title tooltip added).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { StatusDot } from '/components/StatusDot.js';
import { useConfirm } from '/components/Modal.js';
import * as nodesService from '/js/services/nodes.js';
import { getNodeUrl } from '/js/services/auth.js';
import NodeStatsTab from './node-stats-tab.js';

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
    } catch { setNodes([]); onStats?.({ nodes: 0 }); }
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

  return html`
    <div class="section-title">${t('profile.nodes.title')}</div>
    <div class="section-desc">${t('profile.nodes.desc')}</div>
    <button class="btn-primary mb-1" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}</button>
    ${showNodeForm && html`<${NodeForm} onRegister=${handleRegister} onCancel=${() => setShowNodeForm(false)} />`}
    ${!nodes ? html`<${Spinner} text=${t('profile.nodes.loading')} />`
      : nodes.length === 0 ? html`<div class="empty">${t('profile.nodes.empty')}</div>`
      : nodes.map((node, idx) => {
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

          return html`
            <div class="pn-card">
              <div class="pn-header" onClick=${() => {
                const s = new Set(expandedNodes);
                if (s.has(idx)) s.delete(idx); else s.add(idx);
                setExpandedNodes(s);
              }}>
                <div class="pn-header-left">
                  <${StatusDot} status=${statusClass} title=${statusLabel} />
                  <span class="pn-name">${escHtml(node.node_id)}</span>
                </div>
                <div class="pn-badges">
                  ${isPublic
                    ? html`<span class="badge badge-success">${t('profile.nodes.public')}</span>`
                    : html`<span class="badge badge-muted">${t('profile.nodes.private')}</span>`}
                  <span class="badge badge-${statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger'}">${statusLabel}</span>
                  <span class="pn-arrow ${isOpen ? 'open' : ''}">\u25BC</span>
                </div>
              </div>
              <div class="pn-quick">${agentCount} ${agentWord} \u2502 ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}</div>
              ${isOpen && html`
                <div class="pn-details open">
                  <div class="pn-detail-row">
                    <span class="pn-detail-label">${t('profile.nodes.tunnelUrl')}</span>
                    <span class="pn-detail-value flex-row">
                      <code class="text-meta-sm">${tunnelUrl}</code>
                      <${CopyButton} text=${tunnelUrl} label=${t('profile.nodes.copyUrl')} className="pn-copy-btn" onCopied=${() => showToast(t('profile.nodes.copied'))} />
                    </span>
                  </div>
                  <div class="pn-padding-half">
                    <span class="pn-detail-label">${t('profile.nodes.agentList')}</span>
                    ${node.agent_gaiis?.length > 0
                      ? html`<div class="pn-agent-list">${node.agent_gaiis.map(g => html`<div class="pn-agent-item">${escHtml(g)}</div>`)}</div>`
                      : html`<div class="pn-no-agents">${t('profile.nodes.noAgents')}</div>`}
                  </div>
                  <div class="pn-detail-row">
                    <span class="pn-detail-label">${t('profile.nodes.mailbox')}</span>
                    <span class="pn-detail-value">${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)</span>
                  </div>
                  <div class="pn-detail-row">
                    <span class="pn-detail-label">${t('profile.nodes.lastSeen')}</span>
                    <span class="pn-detail-value">${node.last_seen ? timeAgo(node.last_seen) : '-'}</span>
                  </div>
                  <div class="pn-detail-row">
                    <span class="pn-detail-label">${t('profile.nodes.visibility')}</span>
                    <div class="pn-vis-toggle">
                      <button class="pn-vis-btn ${!isPublic ? 'active' : ''}" onClick=${() => handleSetVis(node.node_id, 'private')}>${t('profile.nodes.private')}</button>
                      <button class="pn-vis-btn ${isPublic ? 'active' : ''}" onClick=${() => handleSetVis(node.node_id, 'public')}>${t('profile.nodes.public')}</button>
                    </div>
                  </div>
                  <div class="flex-actions">
                    <button class="expand-btn btn-sm" onClick=${() => {
                      const s = new Set(expandedSetups);
                      if (s.has(idx)) s.delete(idx); else s.add(idx);
                      setExpandedSetups(s);
                    }}>${t('profile.nodes.setupTitle')} <span class="pn-setup-arrow ${setupOpen ? 'open' : ''}">\u25BC</span></button>
                    ${setupOpen && html`
                      <div class="pn-setup open">
                        <ol>
                          <li>${t('profile.nodes.setupStep1')}</li>
                          <li>${t('profile.nodes.setupStep2')}</li>
                          <li>${t('profile.nodes.setupStep3')}</li>
                          <li>${t('profile.nodes.setupStep4')}</li>
                        </ol>
                        <a href="/docs/personal-node-setup-guide.md" target="_blank" class="pn-setup-link">${t('profile.nodes.setupDocs')} \u2192</a>
                      </div>
                    `}
                  </div>
                  <button class="pn-detach-btn" onClick=${() => handleDetach(node.node_id)}>${t('profile.nodes.detachBtn')}</button>
                </div>
              `}
            </div>`;
        })
    }
    <${ConfirmUI} />`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`
    <div class="create-form">
      <div class="section-title">${t('profile.nodes.addTitle')}</div>
      <div class="form-row"><label>${t('profile.nodes.nodeIdLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.nodes.visLabel')}</label>
        <div class="radio-row">
          <label class="radio-label">
            <input type="radio" name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')} /> ${t('profile.nodes.private')}
          </label>
          <label class="radio-label">
            <input type="radio" name="nodeVis" value="public" checked=${vis === 'public'} onChange=${() => setVis('public')} /> ${t('profile.nodes.public')}
          </label>
        </div>
      </div>
      <div class="form-row"><label>${t('profile.nodes.agentGaiisLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${e => setGaiis(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.nodes.cancelBtn')}</button>
      </div>
    </div>`;
}

/* ── Page wrapper: Nodes | Node stats sub-tabs (Node stats merged here from the menu) ── */
export default function NodesTab(props) {
  const [sub, setSub] = useState('nodes');
  return html`
    <div class="sub-tabs">
      <button class="sub-tab ${sub === 'nodes' ? 'active' : ''}" onClick=${() => setSub('nodes')}>${t('profile.tabs.nodes')}</button>
      <button class="sub-tab ${sub === 'stats' ? 'active' : ''}" onClick=${() => setSub('stats')}>${t('profile.tabs.nodeStats')}</button>
    </div>
    ${sub === 'nodes' ? html`<${NodesList} ...${props} />` : html`<${NodeStatsTab} ...${props} />`}
  `;
}
