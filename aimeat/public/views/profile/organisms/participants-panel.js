/**
 * @file participants-panel.js
 * @description Workspace participants panel — who takes part in this workspace, as a node → owner →
 *   agents chart + listing, the viewer's contract agents (with one-click adopt), and (for the
 *   workspace creator) an access manager. Extracted from organisms-tab.js with no behaviour change.
 * @structure ParticipantsPanel
 * @usage import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { listAgents, offersWorkspaceContract, contractNamesOf, adoptContractTask } from '/js/services/agents.js';
import { Mermaid } from '/components/Mermaid.js';

/* Participants panel — who takes part in this workspace, as a node → owner → agents chart plus a
 * listing. Built from the records' identity traces (humans + their agents) + organism membership.
 * The viewer's own agents are named; everyone else's appear as anonymous ghost boxes. */
export function ParticipantsPanel({ orgId, wsId, showToast }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState(true);
  const [access, setAccess] = useState(null);     // { requests, members } — only for the workspace creator
  const [grantee, setGrantee] = useState('');
  const [role, setRole] = useState('contributor');
  const [busy, setBusy] = useState(false);
  // The viewer's own agents advertising a workspace contract (tag 'workspace-contract' +
  // optional 'contract.<name>' tags) — surfaced here so a user looking at a workspace sees
  // straight away which of their agents can serve it.
  const [contractAgents, setContractAgents] = useState([]);
  const [adoptBusy, setAdoptBusy] = useState('');   // `${gaii}:${contract}` of the in-flight adopt
  useEffect(() => {
    listAgents().then(a => setContractAgents((a || []).filter(offersWorkspaceContract))).catch(() => {});
  }, []);
  // One-click adoption: queue the agreed adopt-contract task (docs/agent-workspace-contracts.md
  // §7c) — the agent provisions its contract's spaces itself and the task completion is the ack.
  const adopt = async (a, contract) => {
    const key = `${a.gaii}:${contract || ''}`;
    setAdoptBusy(key);
    try {
      const r = await adoptContractTask(a.name, { organismId: orgId, ws: wsId, contract });
      if (r?.ok === false) showToast?.(r?.error?.message || (t('organisms.adoptFailed') || 'Could not queue the adoption task'));
      else showToast?.((t('organisms.adoptQueued') || 'Adoption task queued for {agent} — it provisions the contract and reports back').replace('{agent}', a.display_name || a.name));
    } catch (e) { showToast?.((e && e.message) || (t('organisms.adoptFailed') || 'Could not queue the adoption task')); }
    finally { setAdoptBusy(''); }
  };
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => orgService.getWorkspaceParticipants(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    fetchIt();
    window.addEventListener('aimeat-live-update', fetchIt);
    return () => { cancelled = true; window.removeEventListener('aimeat-live-update', fetchIt); };
  }, [orgId, wsId]);
  const isManager = !!(data && (data.nodes || []).some(n => (n.owners || []).some(o => o.isSelf && o.isCreator)));
  const loadAccess = () => orgService.getWorkspaceAccess(orgId, wsId).then(setAccess).catch(() => {});
  useEffect(() => { if (isManager) loadAccess(); }, [isManager, orgId, wsId, data]);  if (!data || !(data.nodes || []).length) return null;
  const owners = [];
  for (const n of data.nodes) for (const o of (n.owners || [])) owners.push({ ...o, node: n.id, isLocalNode: n.isLocal });

  const after = async (p) => { setBusy(true); try { await p; await loadAccess(); } catch (e) { /* the row stays so the user can retry */ } finally { setBusy(false); } };
  const doGrant = (g, r) => { const name = (g || '').trim(); if (name) { after(orgService.grantWorkspaceRole(orgId, wsId, name, r)); setGrantee(''); } };
  const doRevoke = (g) => after(orgService.revokeWorkspaceRole(orgId, wsId, g));
  const doDecide = (requester, decision) => after(orgService.decideWorkspaceAccess(orgId, wsId, requester, decision));
  const pending = (access?.requests || []).filter(r => r.status === 'pending');
  const members = access?.members || [];

  return html`
    <div class="pj-chart">
      <div class="pj-chart-head">
        <span class="pj-chart-title">${'👥 '}${t('organisms.participants') || 'Who works here'}</span>
        <button class="btn-ghost btn-sm" onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
      </div>
      ${show ? html`
        <div class="pj-parts">
          ${contractAgents.length ? html`
            <div class="pj-contract-agents">
              <div class="pj-access-title">${'📜 '}${t('organisms.contractAgents') || 'Your contract agents'}</div>
              <div class="section-desc">${t('organisms.contractAgentsDesc') || 'These agents of yours advertise a workspace contract — they can process a workspace like this one. Grant access (below) or attach them in the organism Agents tab.'}</div>
              <div class="pj-part-agents">
                ${contractAgents.map(a => {
                  const names = contractNamesOf(a);
                  // An agent already working in THIS workspace (it appears among the viewer's own
                  // agents in the participants data) gets a ✓ instead of Adopt buttons — offering
                  // adoption for an agent that is already here is noise, and the task would be a
                  // no-op re-provision anyway.
                  const here = owners.some(o => o.isSelf && (o.agents || []).some(ag => ag.isOwn && ag.name === a.name));
                  // One adopt action per advertised contract (a single unnamed one falls back to
                  // the bare marker). The agent does the rest — join, provision, complete the task.
                  const actions = names.length ? names : [''];
                  return html`
                    <span class="pj-part-agent own" key=${a.gaii} title=${a.gaii}>
                      ${'📜 '}${a.display_name || a.name}
                      ${here ? html`<span class="badge badge-success pj-mini" title=${t('organisms.contractActiveHint') || 'This agent already works in this workspace'}>${'✓ '}${t('organisms.contractActive') || 'active here'}</span>`
                        : actions.map(c => html`
                        <button class="btn-outline btn-sm pj-adopt-btn" key=${c} disabled=${adoptBusy === `${a.gaii}:${c}`}
                          title=${t('organisms.adoptHint') || 'Queue a task for this agent to adopt its contract into THIS workspace (it provisions the spaces itself)'}
                          onClick=${() => adopt(a, c)}>
                          ${adoptBusy === `${a.gaii}:${c}` ? '…' : `${t('organisms.adoptContract') || 'Adopt'}${c ? ` ${c}` : ''}`}
                        </button>`)}
                    </span>`;
                })}
              </div>
            </div>` : null}
          <${Mermaid} chart=${orgService.buildParticipantsMermaid(data)} />
          <div class="pj-parts-list">
            ${owners.map((o, i) => html`<div class="pj-part-owner" key=${i}>
              <div class="pj-part-human">
                <span>${'👤 '}<strong>${(o.owner)}</strong></span>
                ${o.isSelf ? html`<span class="badge badge-info pj-mini">${t('organisms.you') || 'you'}</span>` : null}
                ${o.isCreator ? html`<span class="badge badge-success pj-mini">${t('organisms.creatorTag') || 'creator'}</span>` : null}
                ${!o.isMember && !o.isSelf ? html`<span class="badge badge-warn pj-mini">${t('organisms.guest') || 'guest'}</span>` : null}
                ${!o.isLocalNode ? html`<span class="pj-part-node">${'🌐 '}${(o.node)}</span>` : null}
                ${o.contributions ? html`<span class="pj-part-count" title=${t('organisms.contributions') || 'contributions'}>${o.contributions}</span>` : null}
              </div>
              ${(o.agents || []).length ? html`<div class="pj-part-agents">
                ${o.agents.map((a, j) => html`
                  <span class="pj-part-agent ${a.isOwn ? 'own' : 'ghost'}" key=${j}
                    title=${a.isOwn ? '' : (t('organisms.otherAgentHint') || 'Another owner’s agent — you see what it has done here, not its live status')}>
                    ${'🤖 '}${(a.name)}<span class="pj-part-count">${a.contributions}</span>
                  </span>`)}
              </div>` : null}
            </div>`)}
          </div>
          ${isManager ? html`
            <div class="pj-access">
              <div class="pj-access-title">${t('organisms.manageAccess') || 'Manage who can work here'}</div>
              ${pending.map(r => html`<div class="pj-access-row" key=${'req-' + r.requester}>
                <span class="pj-access-who">${'🙋 '}<strong>${(r.requester)}</strong> <span class="pj-access-note">${t('organisms.requestedAccess') || 'requested access'}</span></span>
                <span class="pj-access-actions">
                  <button class="btn-success btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'contributor')}>${t('organisms.addAsContributor') || 'Add as contributor'}</button>
                  <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'viewer')}>${t('organisms.addAsViewer') || 'as viewer'}</button>
                  <button class="btn-danger btn-sm" disabled=${busy} onClick=${() => doDecide(r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}</button>
                </span>
              </div>`)}
              ${members.map(m => html`<div class="pj-access-row" key=${'mem-' + m.owner}>
                <span class="pj-access-who">${'👤 '}<strong>${(m.owner)}</strong> <span class="badge ${m.role === 'contributor' ? 'badge-success' : 'badge-info'} pj-mini">${m.role === 'contributor' ? (t('organisms.roleContributorShort') || 'contributor') : (t('organisms.roleViewerShort') || 'viewer')}</span></span>
                <span class="pj-access-actions">
                  ${m.role === 'viewer'
                    ? html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doGrant(m.owner, 'contributor')}>${t('organisms.makeContributor') || '→ can write'}</button>`
                    : html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => doGrant(m.owner, 'viewer')}>${t('organisms.makeViewer') || '→ read only'}</button>`}
                  <button class="btn-danger btn-sm" disabled=${busy} onClick=${() => doRevoke(m.owner)}>${t('organisms.remove') || 'Remove'}</button>
                </span>
              </div>`)}
              <div class="pj-access-add">
                <input class="pj-access-input" placeholder=${t('organisms.addMemberPlaceholder') || 'owner name (or owner@node / agent#owner@node)'} value=${grantee}
                  onInput=${e => setGrantee(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') doGrant(grantee, role); }} />
                <select class="pj-access-role" value=${role} onChange=${e => setRole(e.target.value)}>
                  <option value="contributor">${t('organisms.roleContributor') || 'contributor (read + write)'}</option>
                  <option value="viewer">${t('organisms.roleViewer') || 'viewer (read only)'}</option>
                </select>
                <button class="btn-primary btn-sm" disabled=${busy || !grantee.trim()} onClick=${() => doGrant(grantee, role)}>${'+ '}${t('organisms.addMember') || 'Add'}</button>
              </div>
              <div class="pj-access-hint">${t('organisms.accessHint') || 'Members can be a different account; their agents inherit the role. Viewers read; contributors read + write.'}</div>
            </div>` : null}
        </div>` : null}
    </div>`;
}
