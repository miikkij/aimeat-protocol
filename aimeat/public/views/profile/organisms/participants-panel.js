/**
 * @file participants-panel.js
 * @description Workspace participants panel — who takes part in this workspace, as a node → owner →
 *   agents chart + listing, the viewer's contract agents (with one-click adopt), and (for the
 *   workspace creator) an access manager. Extracted from organisms-tab.js with no behaviour change.
 * @structure ParticipantsPanel
 * @usage import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-07-03 — Contract engagements: active/retired lifecycle chips (Adopt writes an active
 *     engagement, Retire flips it to retired), a legacy-agent one-click Retire, and re-adopt.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/** Short calendar day for a retired-since stamp (locale date, no time). '' if absent/unparseable. */
function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}
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
  // Engagements = the first-class (agent × contract × workspace) bindings with an active/retired
  // lifecycle. They drive the chips below (vs. the coarse "active here" record trace), so a contract
  // can be adopted AND retired — a real off-switch, and retired ones stay as "used here until <date>".
  const [engagements, setEngagements] = useState([]);
  const [retireBusy, setRetireBusy] = useState('');
  useEffect(() => {
    listAgents().then(a => setContractAgents((a || []).filter(offersWorkspaceContract))).catch(() => {});
  }, []);
  // The engagement for (agent, contract) in THIS workspace, or undefined. contract '' = bare marker.
  const engFor = (a, contract) => engagements.find(e => e.agent === a.gaii && (e.contract || '') === (contract || ''));
  // One-click adoption: write an ACTIVE engagement (immediately visible + the source of truth the
  // agent's loop obeys) AND queue the agreed adopt-contract task (docs/agent-workspace-contracts.md
  // §7c) so the agent provisions its contract's spaces itself and reports back.
  const adopt = async (a, contract) => {
    const key = `${a.gaii}:${contract || ''}`;
    setAdoptBusy(key);
    try {
      await orgService.activateEngagement(orgId, wsId, a.gaii, contract).catch(() => {});
      const r = await adoptContractTask(a.name, { organismId: orgId, ws: wsId, contract });
      if (r?.ok === false) showToast?.(r?.error?.message || (t('organisms.adoptFailed') || 'Could not queue the adoption task'));
      else showToast?.((t('organisms.adoptQueued') || 'Adoption task queued for {agent} — it provisions the contract and reports back').replace('{agent}', a.display_name || a.name));
      await refreshEngagements();
    } catch (e) { showToast?.((e && e.message) || (t('organisms.adoptFailed') || 'Could not queue the adoption task')); }
    finally { setAdoptBusy(''); }
  };
  // Retire a contract engagement — the agent's loop then skips this workspace. Works even with no
  // prior engagement (a pre-contracts agent, "active here" only from record traces): it writes a
  // retired marker so the history reads "used here until <date>".
  const retire = async (a, contract) => {
    const key = `${a.gaii}:${contract || ''}`;
    setRetireBusy(key);
    try {
      const r = await orgService.retireEngagement(orgId, wsId, a.gaii, contract);
      if (r?.ok === false) showToast?.(r?.error?.message || (t('organisms.retireFailed') || 'Could not retire the contract'));
      else showToast?.((t('organisms.retired') || '{agent} retired from this workspace').replace('{agent}', a.display_name || a.name));
      await refreshEngagements();
    } catch (e) { showToast?.((e && e.message) || (t('organisms.retireFailed') || 'Could not retire the contract')); }
    finally { setRetireBusy(''); }
  };
  // Retire every advertised contract of an agent from this workspace (used for a "legacy" agent that
  // is working here — trace only — with no engagement records yet, so one click stops it entirely).
  const retireAll = async (a) => {
    const names = contractNamesOf(a);
    const actions = names.length ? names : [''];
    setRetireBusy(`${a.gaii}:*`);
    try {
      for (const c of actions) await orgService.retireEngagement(orgId, wsId, a.gaii, c).catch(() => {});
      showToast?.((t('organisms.retired') || '{agent} retired from this workspace').replace('{agent}', a.display_name || a.name));
      await refreshEngagements();
    } finally { setRetireBusy(''); }
  };
  const refreshEngagements = () => orgService.getWorkspaceEngagements(orgId, wsId).then(setEngagements).catch(() => {});
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => {
      orgService.getWorkspaceParticipants(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
      orgService.getWorkspaceEngagements(orgId, wsId).then(e => { if (!cancelled) setEngagements(e); }).catch(() => {});
    };
    fetchIt();
    const off = onLiveUpdate(['organisms'], fetchIt);
    return () => { cancelled = true; off(); };
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
                  // One control per advertised contract (a single unnamed one falls back to the bare
                  // marker). The agent does the rest — join, provision, complete the task.
                  const actions = names.length ? names : [''];
                  // "Legacy" = the agent appears in the record traces (it has worked here) but carries
                  // no engagement record yet — it started before contracts were first-class. Offer one
                  // agent-level Retire so it can be stopped; new adopts get precise per-contract chips.
                  const traceHere = owners.some(o => o.isSelf && (o.agents || []).some(ag => ag.isOwn && ag.name === a.name));
                  const hasAnyEng = actions.some(c => engFor(a, c));
                  const legacyActive = traceHere && !hasAnyEng;
                  return html`
                    <span class="pj-part-agent own" key=${a.gaii} title=${a.gaii}>
                      ${'📜 '}${a.display_name || a.name}
                      ${legacyActive ? html`
                        <span class="badge badge-success pj-mini" title=${t('organisms.contractActiveHint') || 'This agent already works in this workspace'}>${'✓ '}${t('organisms.contractActive') || 'active here'}</span>
                        <button class="btn-ghost btn-sm pj-retire-btn" disabled=${retireBusy === `${a.gaii}:*`}
                          title=${t('organisms.retireHint') || 'Stop this agent from working in THIS workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                          onClick=${() => retireAll(a)}>${retireBusy === `${a.gaii}:*` ? '…' : (t('organisms.retire') || 'Retire')}</button>`
                        : actions.map(c => {
                          const eng = engFor(a, c);
                          const label = c || (t('organisms.bareContract') || 'contract');
                          const bkey = `${a.gaii}:${c}`;
                          if (eng?.state === 'active') return html`
                            <span class="pj-eng" key=${c}>
                              <span class="badge badge-success pj-mini">${'✓ '}${label}</span>
                              <button class="btn-ghost btn-sm pj-retire-btn" disabled=${retireBusy === bkey}
                                title=${t('organisms.retireHint') || 'Stop this agent from working in THIS workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                                onClick=${() => retire(a, c)}>${retireBusy === bkey ? '…' : (t('organisms.retire') || 'Retire')}</button>
                            </span>`;
                          if (eng?.state === 'retired') return html`
                            <span class="pj-eng" key=${c}>
                              <span class="badge badge-muted pj-mini" title=${(t('organisms.retiredUntilHint') || 'Retired — this agent served here until this date. Its past work stays visible.')}>${label}${' · '}${t('organisms.retiredTag') || 'retired'} ${fmtDay(eng.retiredAt)}</span>
                              <button class="btn-outline btn-sm pj-adopt-btn" disabled=${adoptBusy === bkey}
                                onClick=${() => adopt(a, c)}>${adoptBusy === bkey ? '…' : (t('organisms.reAdopt') || 'Re-adopt')}</button>
                            </span>`;
                          return html`
                            <button class="btn-outline btn-sm pj-adopt-btn" key=${c} disabled=${adoptBusy === bkey}
                              title=${t('organisms.adoptHint') || 'Queue a task for this agent to adopt its contract into THIS workspace (it provisions the spaces itself)'}
                              onClick=${() => adopt(a, c)}>
                              ${adoptBusy === bkey ? '…' : `${t('organisms.adoptContract') || 'Adopt'}${c ? ` ${c}` : ''}`}
                            </button>`;
                        })}
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
