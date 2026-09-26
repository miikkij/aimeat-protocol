/**
 * @file nodes-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing personal node registrations, visibility,
 *   agent assignments, tunnel URLs, and mailbox status.
 * @version-history
 *   v1.20.0 -- 2026-09-26 -- Private and Public beside their radio dots are the Check line (css/components/check-line.css), no longer the row label (a unification: Jouni's decision "Check line").
 *   v1.19.0 -- 2026-09-26 -- The page opens with the Settings head: the crumb, NODES as the page's title and the line that says what it is for, the Nodes and Node stats tabs under it; the line leaves the list's band title (a unification: Jouni's decision "Nodes page head").
 *   v1.17.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.14.0 -- 2026-09-26 -- A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v1.13.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A node's agents, the CORS chain, the ecosystem's identifiers and its pairing code are inline code (.code-inline); their own mono looks go (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The last quiet ways on with a look of their own are the action link (.poster-action; the danger tone for detach, the small link for a link inside a part, the quiet cut in the account dialogs): pn-detach-btn, pn-setup-link, pf-aitr-row-link, pf-edit-link, pf-pw-eye and the door's underlined words; a place keeps only its layout (Jouni's decision "Action link", a unification).
 *   v1.10.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- An opened node's details (tunnel, agents, mailbox, last seen, visibility) are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
 *   v1.5.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { StatusDot } from '/components/StatusDot.js';
import { useConfirm } from '/components/Modal.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import * as nodesService from '/js/services/nodes.js';
import { getNodeUrl } from '/js/services/auth.js';
import NodeStatsTab from './node-stats-tab.js';
import { swallowed } from '/js/swallowed.js';

/** A setup step's words begin with their own number ("1. Open…"); the list counts, so the number is said once. */
const stepWords = (s) => String(s).replace(/^\s*\d+\.\s*/, '');

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

  return html`
    <div class="poster-section-title">${t('profile.nodes.title')}</div>
    <button class="poster-slab mb-1" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}</button>
    ${showNodeForm && html`<${NodeForm} onRegister=${handleRegister} onCancel=${() => setShowNodeForm(false)} />`}
    ${!nodes ? html`<${LoadingLine} text=${t('profile.nodes.loading')} />`
      : nodes.length === 0 ? html`<div class="poster-quiet">${t('profile.nodes.empty')}</div>`
      : html`<div class="listing listing--name-desc-doors">${nodes.map((node, idx) => {
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
            <div class=${`listing-row pn-row ${isOpen ? 'is-open' : ''}`} key=${node.node_id} onClick=${(e) => {
                if (e.target.closest?.('.listing-open')) return;
                const s = new Set(expandedNodes);
                if (s.has(idx)) s.delete(idx); else s.add(idx);
                setExpandedNodes(s);
              }}>
              <div class="listing-name"><${StatusDot} status=${statusClass} title=${statusLabel} /> ${escHtml(node.node_id)}</div>
              <div class="listing-desc">${agentCount} ${agentWord} \u2502 ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}</div>
              <div class="listing-doors">
                  ${isPublic
                    ? html`<span class="poster-chip poster-chip--sun">${t('profile.nodes.public')}</span>`
                    : html`<span class="poster-chip">${t('profile.nodes.private')}</span>`}
                  <span class="poster-status poster-status--${statusClass === 'online' ? 'fine' : statusClass === 'degraded' ? 'attention' : 'danger'}">${statusLabel}</span>
                  <button type="button" class="poster-icon poster-icon--small">${isOpen ? '\u25B2' : '\u25BC'}</button>
              </div>
              ${isOpen && html`
                <div class="listing-open poster-box poster-box--raised">
                  <div class="facts">
                    <span class="facts-k poster-label">${t('profile.nodes.tunnelUrl')}</span>
                    <span class="facts-v">
                      <code class="code-inline">${tunnelUrl}</code>
                      <${CopyButton} text=${tunnelUrl} className="poster-action poster-action--small btn-copy-inline"
                        onCopied=${() => showToast(t('common.copied'))} />
                    </span>
                    <span class="facts-k poster-label">${t('profile.nodes.agentList')}</span>
                    <div class="facts-v">
                      ${node.agent_gaiis?.length > 0
                        ? html`<div class="pn-agent-list">${node.agent_gaiis.map(g => html`<div><code class="code-inline">${escHtml(g)}</code></div>`)}</div>`
                        : html`<div class="poster-quiet pn-no-agents">${t('profile.nodes.noAgents')}</div>`}
                    </div>
                    <span class="facts-k poster-label">${t('profile.nodes.mailbox')}</span>
                    <span class="facts-v">${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)</span>
                    <span class="facts-k poster-label">${t('profile.nodes.lastSeen')}</span>
                    <span class="facts-v">${node.last_seen ? timeAgo(node.last_seen) : '-'}</span>
                    <span class="facts-k poster-label">${t('profile.nodes.visibility')}</span>
                    <div class="facts-v">
                      <div class="pn-vis-toggle">
                        <button class="poster-tab ${!isPublic ? 'is-on' : ''}" onClick=${() => handleSetVis(node.node_id, 'private')}>${t('profile.nodes.private')}</button>
                        <button class="poster-tab ${isPublic ? 'is-on' : ''}" onClick=${() => handleSetVis(node.node_id, 'public')}>${t('profile.nodes.public')}</button>
                      </div>
                    </div>
                  </div>
                  <div class="flex-actions">
                    <button type="button" class=${`poster-tab poster-tab--fold ${setupOpen ? 'is-on' : ''}`} aria-pressed=${setupOpen ? 'true' : 'false'} onClick=${() => {
                      const s = new Set(expandedSetups);
                      if (s.has(idx)) s.delete(idx); else s.add(idx);
                      setExpandedSetups(s);
                    }}>${t('profile.nodes.setupTitle')}</button>
                    ${setupOpen && html`
                      <div class="pn-setup open poster-row--thing">
                        <${IndexList} steps>
                          ${[1, 2, 3, 4].map((n) => html`<${IndexStep} key=${n}>${stepWords(t(`profile.nodes.setupStep${n}`))}<//>`)}
                        <//>
                        <a href="/docs/personal-node-setup-guide.md" target="_blank" class="poster-action poster-action--more">${t('profile.nodes.setupDocs')} \u2192</a>
                      </div>
                    `}
                  </div>
                  <button class="poster-action poster-action--small poster-action--danger pn-detach-btn" onClick=${() => handleDetach(node.node_id)}>${t('profile.nodes.detachBtn')}</button>
                </div>
              `}
            </div>`;
        })}</div>`
    }
    <${ConfirmUI} />`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`
    <div class="create-form poster-row--thing">
      <div class="poster-section-title">${t('profile.nodes.addTitle')}</div>
      <div class="form-row"><label class="poster-label">${t('profile.nodes.nodeIdLabel')}</label><input class="og-input" placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} /></div>
      <div class="form-row"><label class="poster-label">${t('profile.nodes.visLabel')}</label>
        <div class="radio-row">
          <label class="radio-label check-line">
            <input type="radio" name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')} /> ${t('profile.nodes.private')}
          </label>
          <label class="radio-label check-line">
            <input type="radio" name="nodeVis" value="public" checked=${vis === 'public'} onChange=${() => setVis('public')} /> ${t('profile.nodes.public')}
          </label>
        </div>
      </div>
      <div class="form-row"><label class="poster-label">${t('profile.nodes.agentGaiisLabel')}</label><input class="og-input" placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${e => setGaiis(e.target.value)} /></div>
      <div class="form-actions">
        <button class="poster-slab" onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}</button>
        <button class="poster-action poster-action--small" onClick=${onCancel}>${t('profile.nodes.cancelBtn')}</button>
      </div>
    </div>`;
}

/* ── Page wrapper: the Settings head (the crumb, the page's name, the line that says what it is for),
   then the Nodes | Node stats sub-tabs (Node stats merged here from the menu) ── */
export default function NodesTab(props) {
  const [sub, setSub] = useState('nodes');
  return html`
    <div class="og mb-1">
      <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuInfra')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.nodes')}</span></div>
      <div class="og-mast og-mast--page"><div class="og-mast-words">
        <h1 class="og-title poster-page-title">${t('profile.tabs.nodes')}</h1>
        <p class="og-desc og-desc--page">${t('profile.nodes.desc')}</p>
      </div></div>
    </div>
    <div class="sub-tabs poster-row--thing">
      <button class="poster-tab ${sub === 'nodes' ? 'is-on' : ''}" onClick=${() => setSub('nodes')}>${t('profile.tabs.nodes')}</button>
      <button class="poster-tab ${sub === 'stats' ? 'is-on' : ''}" onClick=${() => setSub('stats')}>${t('profile.tabs.nodeStats')}</button>
    </div>
    ${sub === 'nodes' ? html`<${NodesList} ...${props} />` : html`<${NodeStatsTab} ...${props} />`}
  `;
}
