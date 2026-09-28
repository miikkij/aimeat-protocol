/**
 * @file nodes-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing personal node registrations, visibility,
 *   agent assignments, tunnel URLs, and mailbox status.
 * @version-history
 *   v1.21.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes itself, so a node id or agent GAII with an ampersand showed as &amp;.
 *   v1.21.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with the Tabs bar, Section, List with its opened Panel, Facts, Card, Fields, TextField, Check, Tab, Split, Mark, Note, Action): the page passes data and writes no class. The setup steps name their keys again as main did (page group G8).
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
import { timeAgo } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Tabs, Tab, TabPanel } from '/components/Tabs.js';
import { List, Row, Name, Desc, Doors, Panel } from '/components/List.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Card } from '/components/Card.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Row as Line, Stack, Split, Space } from '/components/Layout.js';
import { Fields, Field, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
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

  const toggleIn = (set, setter, idx) => {
    const s = new Set(set);
    if (s.has(idx)) s.delete(idx); else s.add(idx);
    setter(s);
  };

  return html`
    <${Section} band title=${t('profile.nodes.title')} first>
    <${Space} below="large"><${Loud} onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}<//><//>
    ${showNodeForm && html`<${NodeForm} onRegister=${handleRegister} onCancel=${() => setShowNodeForm(false)} />`}
    ${!nodes ? html`<${LoadingLine} text=${t('profile.nodes.loading')} />`
      : html`<${List} cols="name-desc-doors" empty=${t('profile.nodes.empty')}>${nodes.map((node, idx) => {
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

          // The setup steps, said by their own keys (main listed profile.nodes.setupStep1 \u2026 4).
          const steps = ['profile.nodes.setupStep1', 'profile.nodes.setupStep2', 'profile.nodes.setupStep3', 'profile.nodes.setupStep4'];
          return html`
            <${Row} key=${node.node_id} open=${isOpen} onToggle=${() => toggleIn(expandedNodes, setExpandedNodes, idx)}>
              <${Name} dot=${statusClass} dotTitle=${statusLabel}>${node.node_id}<//>
              <${Desc}>${agentCount} ${agentWord} \u2502 ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}<//>
              <${Doors}>
                  ${isPublic
                    ? html`<${Mark} tone="sun">${t('profile.nodes.public')}<//>`
                    : html`<${Mark}>${t('profile.nodes.private')}<//>`}
                  <${Mark} kind="status" tone=${statusClass === 'online' ? 'fine' : statusClass === 'degraded' ? 'attention' : 'danger'}>${statusLabel}<//>
                  <${Icon} small>${isOpen ? '\u25B2' : '\u25BC'}<//>
              <//>
              ${isOpen && html`
                <${Panel}>
                  <${Facts} rows=${[
                    { k: t('profile.nodes.tunnelUrl'), v: tunnelUrl, mono: true,
                      action: html`<${Action} small copy=${tunnelUrl} onCopied=${() => showToast(t('common.copied'))}>${t('common.copy')}<//>` },
                    { k: t('profile.nodes.agentList'),
                      v: node.agent_gaiis?.length > 0
                        ? node.agent_gaiis.map(g => html`<${FactLine} key=${g}><${Code}>${g}<//><//>`)
                        : html`<${Note} kind="quiet">${t('profile.nodes.noAgents')}<//>` },
                    { k: t('profile.nodes.mailbox'), v: `${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)` },
                    { k: t('profile.nodes.lastSeen'), v: node.last_seen ? timeAgo(node.last_seen) : '-' },
                    { k: t('profile.nodes.visibility'), controls: true,
                      v: html`<${Tabs} label=${t('profile.nodes.visibility')} value=${isPublic ? 'public' : 'private'}
                        onSelect=${(v) => handleSetVis(node.node_id, v)}
                        items=${[{ value: 'private', label: t('profile.nodes.private') }, { value: 'public', label: t('profile.nodes.public') }]} />` },
                  ]} />
                  <${Stack} above="medium">
                    <${Line}>
                      <${Tab} tone="fold" on=${setupOpen} pressed=${setupOpen}
                        onClick=${() => toggleIn(expandedSetups, setExpandedSetups, idx)}>${t('profile.nodes.setupTitle')}<//>
                    <//>
                    ${setupOpen && html`
                      <${Split}>
                        <${IndexList} steps>
                          ${steps.map((key) => html`<${IndexStep} key=${key}>${stepWords(t(key))}<//>`)}
                        <//>
                        <${Action} tone="more" href="/docs/personal-node-setup-guide.md" newTab>${t('profile.nodes.setupDocs')} \u2192<//>
                      <//>
                    `}
                  <//>
                  <${Space} above="medium"><${Action} small tone="danger" onClick=${() => handleDetach(node.node_id)}>${t('profile.nodes.detachBtn')}<//><//>
                <//>
              `}
            <//>`;
        })}<//>`
    }
    <//>
    <${ConfirmUI} />`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`
    <${Card} tone="section" title=${t('profile.nodes.addTitle')}>
      <${Fields}>
        <${TextField} label=${t('profile.nodes.nodeIdLabel')} placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${setNodeId} />
        <${Field} label=${t('profile.nodes.visLabel')} group>
          <${Check} radio inline name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')}>${t('profile.nodes.private')}<//>
          <${Check} radio inline name="nodeVis" value="public" checked=${vis === 'public'} onChange=${() => setVis('public')}>${t('profile.nodes.public')}<//>
        <//>
        <${TextField} label=${t('profile.nodes.agentGaiisLabel')} placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${setGaiis} />
      <//>
      <${FormActions}>
        <${Loud} onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}<//>
        <${Action} small onClick=${onCancel}>${t('profile.nodes.cancelBtn')}<//>
      <//>
    <//>`;
}

/* ── Page wrapper: the Settings head (the crumb, the page's name, the line that says what it is for),
   then the Nodes | Node stats sub-tabs (Node stats merged here from the menu) ── */
export default function NodesTab(props) {
  const [sub, setSub] = useState('nodes');
  return html`
    <${SettingsPage} page
      crumb=${[t('nav.profile'), t('profile.landing.menuInfra'), t('profile.tabs.nodes')]}
      title=${t('profile.tabs.nodes')}
      desc=${t('profile.nodes.desc')}>
      <${Tabs} bar kind="view" value=${sub} onSelect=${setSub}
        items=${[{ value: 'nodes', label: t('profile.tabs.nodes') }, { value: 'stats', label: t('profile.tabs.nodeStats') }]} />
      <${TabPanel} value=${sub}>${sub === 'nodes' ? html`<${NodesList} ...${props} />` : html`<${NodeStatsTab} ...${props} />`}<//>
    <//>
  `;
}
