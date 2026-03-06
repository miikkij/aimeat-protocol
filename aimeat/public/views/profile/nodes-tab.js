import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as nodesService from '/js/services/nodes.js';
import { getNodeUrl } from '/js/services/auth.js';

export default function NodesTab({ session, showToast, onStats }) {
  const NODE_URL = getNodeUrl();
  const tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
  const [nodes, setNodes] = useState(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedSetups, setExpandedSetups] = useState(new Set());

  useEffect(() => {
    if (session) loadData();
  }, [session]);

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
    if (!confirm(t('profile.nodes.detachConfirm'))) return;
    const resp = await nodesService.detachNode(nodeId);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.nodes.detachedToast'));
    loadData();
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
    <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}</button>
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
                s.has(idx) ? s.delete(idx) : s.add(idx);
                setExpandedNodes(s);
              }}>
                <div class="pn-header-left">
                  <div class="pn-status-dot ${statusClass}"></div>
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
                    <span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem">
                      <code style="font-size:.75rem">${tunnelUrl}</code>
                      <button onClick=${() => { copyToClipboard(tunnelUrl).then(() => showToast(t('profile.nodes.copied'))); }} style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">${t('profile.nodes.copyUrl')}</button>
                    </span>
                  </div>
                  <div style="padding:.5rem 0">
                    <span class="pn-detail-label">${t('profile.nodes.agentList')}</span>
                    ${node.agent_gaiis?.length > 0
                      ? html`<div class="pn-agent-list">${node.agent_gaiis.map(g => html`<div class="pn-agent-item">${escHtml(g)}</div>`)}</div>`
                      : html`<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">${t('profile.nodes.noAgents')}</div>`}
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
                  <div style="margin-top:.75rem">
                    <button class="expand-btn" style="font-size:.8rem;padding:6px 12px" onClick=${() => {
                      const s = new Set(expandedSetups);
                      s.has(idx) ? s.delete(idx) : s.add(idx);
                      setExpandedSetups(s);
                    }}>${t('profile.nodes.setupTitle')} <span style="transition:transform .2s;${setupOpen ? 'transform:rotate(180deg)' : ''}">\u25BC</span></button>
                    ${setupOpen && html`
                      <div class="pn-setup open">
                        <ol>
                          <li>${t('profile.nodes.setupStep1')}</li>
                          <li>${t('profile.nodes.setupStep2')}</li>
                          <li>${t('profile.nodes.setupStep3')}</li>
                          <li>${t('profile.nodes.setupStep4')}</li>
                        </ol>
                        <a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">${t('profile.nodes.setupDocs')} \u2192</a>
                      </div>
                    `}
                  </div>
                  <button class="pn-detach-btn" onClick=${() => handleDetach(node.node_id)}>${t('profile.nodes.detachBtn')}</button>
                </div>
              `}
            </div>`;
        })
    }`;
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
        <div style="display:flex;gap:1rem">
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')} /> ${t('profile.nodes.private')}
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
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
