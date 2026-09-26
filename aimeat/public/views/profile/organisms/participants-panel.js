/**
 * @file participants-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace participants panel — who takes part in this workspace, as a node → owner →
 *   agents chart + listing, the viewer's contract agents (with one-click adopt), and (for the
 *   workspace creator) an access manager. Extracted from organisms-tab.js with no behaviour change.
 * @structure ParticipantsPanel
 * @usage import { ParticipantsPanel } from '/views/profile/organisms/participants-panel.js';
 * @version-history
 *   v1.14.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 — 2026-09-25 — The access manager's requests and members are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.11.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.9.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.8.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.5.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.3.0 — 2026-07-16 — The access-manager grantee input is a ContactPicker (contacts + directory
 *     suggestions + email resolve) instead of a bare text field.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-07-03 — Contract engagements: active/retired lifecycle chips (Adopt writes an active
 *     engagement, Retire flips it to retired), a legacy-agent one-click Retire, and re-adopt.
 *   v1.2.0 — 2026-07-03 — Collapse a fully-retired agent (every advertised contract retired, none active)
 *     into ONE "retired from here" chip + Bring back, so contracts never used here don't read as history.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/** Short calendar day for a retired-since stamp, in the reader's own format. '' if absent. */
function fmtDay(iso) {
  return iso ? fmtDate(iso) : '';
}
import * as orgService from '/js/services/organisms.js';
import { listAgents, offersWorkspaceContract, contractNamesOf, adoptContractTask } from '/js/services/agents.js';
import { Mermaid } from '/components/Mermaid.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

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
    listAgents().then(a => setContractAgents((a || []).filter(offersWorkspaceContract))).catch(err => { swallowed('participants-panel: ParticipantsPanel', err); });
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
      await orgService.activateEngagement(orgId, wsId, a.gaii, contract).catch(err => { swallowed('participants-panel: adopt', err); });
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
      for (const c of actions) await orgService.retireEngagement(orgId, wsId, a.gaii, c).catch(err => { swallowed('participants-panel: retireAll', err); });
      showToast?.((t('organisms.retired') || '{agent} retired from this workspace').replace('{agent}', a.display_name || a.name));
      await refreshEngagements();
    } finally { setRetireBusy(''); }
  };
  // Bring a fully-retired agent back: re-adopt every advertised contract (inverse of retireAll). Used by
  // the collapsed "retired from here" chip so one click puts the agent back to work in this workspace.
  const readoptAll = async (a) => {
    const names = contractNamesOf(a);
    const actions = names.length ? names : [''];
    setAdoptBusy(`${a.gaii}:*`);
    try {
      for (const c of actions) await orgService.activateEngagement(orgId, wsId, a.gaii, c).catch(err => { swallowed('participants-panel: readoptAll', err); });
      await adoptContractTask(a.name, { organismId: orgId, ws: wsId, contract: actions[0] }).catch(err => { swallowed('participants-panel: readoptAll', err); });
      showToast?.((t('organisms.broughtBack') || '{agent} is working here again').replace('{agent}', a.display_name || a.name));
      await refreshEngagements();
    } finally { setAdoptBusy(''); }
  };
  const refreshEngagements = () => orgService.getWorkspaceEngagements(orgId, wsId).then(setEngagements).catch(err => { swallowed('participants-panel: refreshEngagements', err); });
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => {
      orgService.getWorkspaceParticipants(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(err => { swallowed('participants-panel: fetchIt', err); });
      orgService.getWorkspaceEngagements(orgId, wsId).then(e => { if (!cancelled) setEngagements(e); }).catch(err => { swallowed('participants-panel: fetchIt', err); });
    };
    fetchIt();
    const off = onLiveUpdate(['organisms'], fetchIt);
    return () => { cancelled = true; off(); };
  }, [orgId, wsId]);
  const isManager = !!(data && (data.nodes || []).some(n => (n.owners || []).some(o => o.isSelf && o.isCreator)));
  const loadAccess = useCallback(() => orgService.getWorkspaceAccess(orgId, wsId).then(setAccess).catch(err => { swallowed('participants-panel: fetchIt', err); }), [orgId, wsId]);
  useEffect(() => { if (isManager) loadAccess(); }, [isManager, orgId, wsId, data, loadAccess]);  if (!data || !(data.nodes || []).length) return null;
  const owners = [];
  for (const n of data.nodes) for (const o of (n.owners || [])) owners.push({ ...o, node: n.id, isLocalNode: n.isLocal });

  const after = async (p) => { setBusy(true); try { await p; await loadAccess(); } catch (err) { swallowed('participants-panel: after', err); } finally { setBusy(false); } };
  const doGrant = (g, r) => { const name = (g || '').trim(); if (name) { after(orgService.grantWorkspaceRole(orgId, wsId, name, r)); setGrantee(''); } };
  const doRevoke = (g) => after(orgService.revokeWorkspaceRole(orgId, wsId, g));
  const doDecide = (requester, decision) => after(orgService.decideWorkspaceAccess(orgId, wsId, requester, decision));
  const pending = (access?.requests || []).filter(r => r.status === 'pending');
  const members = access?.members || [];

  return html`
    <div class="pj-chart poster-box">
      <div class="pj-chart-head">
        <span class="pj-chart-title">${'👥 '}${t('organisms.participants') || 'Who works here'}</span>
        <button class="poster-action poster-action--small" onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
      </div>
      ${show ? html`
        <div class="pj-parts">
          ${contractAgents.length ? html`
            <div class="pj-contract-agents poster-box">
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
                  const engs = actions.map(c => engFor(a, c));
                  const hasAnyEng = engs.some(Boolean);
                  const activeCount = engs.filter(e => e?.state === 'active').length;
                  const retiredCount = engs.filter(e => e?.state === 'retired').length;
                  const legacyActive = traceHere && !hasAnyEng;
                  // Fully retired here: every advertised contract retired, none active — the one-click
                  // "Retire from here" outcome. Collapse to ONE agent-level chip instead of a per-contract
                  // "retired" row each, so contracts that never actually ran here don't read as history.
                  const allRetired = activeCount === 0 && retiredCount > 0 && retiredCount === actions.length;
                  const retiredAt = allRetired ? engs.filter(e => e?.state === 'retired').map(e => e.retiredAt).filter(Boolean).sort().slice(-1)[0] : null;
                  return html`
                    <span class="pj-part-agent own" key=${a.gaii} title=${a.gaii}>
                      ${'📜 '}${a.display_name || a.name}
                      ${legacyActive ? html`
                        <span class="poster-status poster-status--fine" title=${t('organisms.contractActiveHint') || 'This agent already works in this workspace'}>${'✓ '}${t('organisms.contractActive') || 'active here'}</span>
                        <button class="poster-action poster-action--small pj-retire-btn" disabled=${retireBusy === `${a.gaii}:*`}
                          title=${t('organisms.retireHint') || 'Stop this agent from working in THIS workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                          onClick=${() => retireAll(a)}>${retireBusy === `${a.gaii}:*` ? '…' : (t('organisms.retire') || 'Retire')}</button>`
                        : allRetired ? html`
                        <span class="poster-status poster-status--off" title=${t('organisms.retiredFromHereHint') || 'This agent is retired from this workspace — its loop skips it. Bring it back to let it work here again.'}>${'🚫 '}${t('organisms.retiredFromHere') || 'retired from here'} ${fmtDay(retiredAt)}</span>
                        <button class="poster-action poster-action--small pj-adopt-btn" disabled=${adoptBusy === `${a.gaii}:*`}
                          onClick=${() => readoptAll(a)}>${adoptBusy === `${a.gaii}:*` ? '…' : (t('organisms.bringBack') || 'Bring back')}</button>`
                        : actions.map(c => {
                          const eng = engFor(a, c);
                          const label = c || (t('organisms.bareContract') || 'contract');
                          const bkey = `${a.gaii}:${c}`;
                          if (eng?.state === 'active') return html`
                            <span class="pj-eng" key=${c}>
                              <span class="poster-status poster-status--fine">${'✓ '}${label}</span>
                              <button class="poster-action poster-action--small pj-retire-btn" disabled=${retireBusy === bkey}
                                title=${t('organisms.retireHint') || 'Stop this agent from working in THIS workspace — its loop skips it and the chip becomes “retired”. Its past work stays as history.'}
                                onClick=${() => retire(a, c)}>${retireBusy === bkey ? '…' : (t('organisms.retire') || 'Retire')}</button>
                            </span>`;
                          if (eng?.state === 'retired') return html`
                            <span class="pj-eng" key=${c}>
                              <span class="poster-status poster-status--off" title=${(t('organisms.retiredUntilHint') || 'Retired — this agent served here until this date. Its past work stays visible.')}>${label}${' · '}${t('organisms.retiredTag') || 'retired'} ${fmtDay(eng.retiredAt)}</span>
                              <button class="poster-action poster-action--small pj-adopt-btn" disabled=${adoptBusy === bkey}
                                onClick=${() => adopt(a, c)}>${adoptBusy === bkey ? '…' : (t('organisms.reAdopt') || 'Re-adopt')}</button>
                            </span>`;
                          return html`
                            <button class="poster-action poster-action--small pj-adopt-btn" key=${c} disabled=${adoptBusy === bkey}
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
            ${owners.map((o, i) => html`<div class="pj-part-owner poster-box" key=${i}>
              <div class="pj-part-human">
                <span>${'👤 '}<strong>${(o.owner)}</strong></span>
                ${o.isSelf ? html`<span class="poster-chip poster-chip--sun">${t('organisms.you') || 'you'}</span>` : null}
                ${o.isCreator ? html`<span class="poster-chip">${t('organisms.creatorTag') || 'creator'}</span>` : null}
                ${!o.isMember && !o.isSelf ? html`<span class="poster-chip poster-chip--coral">${t('organisms.guest') || 'guest'}</span>` : null}
                ${!o.isLocalNode ? html`<span class="pj-part-node">${'🌐 '}${(o.node)}</span>` : null}
                ${o.contributions ? html`<span class="poster-count poster-count--tally" title=${t('organisms.contributions') || 'contributions'}>${o.contributions}</span>` : null}
              </div>
              ${(o.agents || []).length ? html`<div class="pj-part-agents">
                ${o.agents.map((a, j) => html`
                  <span class="pj-part-agent ${a.isOwn ? 'own' : 'ghost'}" key=${j}
                    title=${a.isOwn ? '' : (t('organisms.otherAgentHint') || 'Another owner’s agent — you see what it has done here, not its live status')}>
                    ${'🤖 '}${(a.name)}<span class="poster-count poster-count--tally">${a.contributions}</span>
                  </span>`)}
              </div>` : null}
            </div>`)}
          </div>
          ${isManager ? html`
            <div class="pj-access">
              <div class="pj-access-title">${t('organisms.manageAccess') || 'Manage who can work here'}</div>
              ${pending.length || members.length ? html`<div class="listing listing--name-doors listing--cols">
              ${pending.map(r => html`<div class="listing-row" key=${'req-' + r.requester}>
                <div class="listing-name">${'🙋 '}<strong>${(r.requester)}</strong> <span class="pj-access-note">${t('organisms.requestedAccess') || 'requested access'}</span></div>
                <div class="listing-doors">
                  <button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => doDecide(r.requester, 'contributor')}>${t('organisms.addAsContributor') || 'Add as contributor'}</button>
                  <button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => doDecide(r.requester, 'viewer')}>${t('organisms.addAsViewer') || 'as viewer'}</button>
                  <button class="poster-action poster-action--small poster-action--row poster-action--danger" disabled=${busy} onClick=${() => doDecide(r.requester, 'deny')}>${t('organisms.deny') || 'Deny'}</button>
                </div>
              </div>`)}
              ${members.map(m => html`<div class="listing-row" key=${'mem-' + m.owner}>
                <div class="listing-name">${'👤 '}<strong>${(m.owner)}</strong> <span class="poster-chip">${m.role === 'contributor' ? (t('organisms.roleContributorShort') || 'contributor') : (t('organisms.roleViewerShort') || 'viewer')}</span></div>
                <div class="listing-doors">
                  ${m.role === 'viewer'
                    ? html`<button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => doGrant(m.owner, 'contributor')}>${t('organisms.makeContributor') || '→ can write'}</button>`
                    : html`<button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => doGrant(m.owner, 'viewer')}>${t('organisms.makeViewer') || '→ read only'}</button>`}
                  <button class="poster-action poster-action--small poster-action--row poster-action--danger" disabled=${busy} onClick=${() => doRevoke(m.owner)}>${t('organisms.remove') || 'Remove'}</button>
                </div>
              </div>`)}
              </div>` : null}
              <div class="pj-access-add">
                <${ContactPicker} value=${grantee} onChange=${setGrantee} onSubmit=${(v) => doGrant(v, role)}
                  kinds=${['ghii']}
                  placeholder=${t('organisms.addMemberPlaceholder') || 'owner name (or owner@node / agent#owner@node)'} disabled=${busy} />
                <select class="select-field" value=${role} onChange=${e => setRole(e.target.value)}>
                  <option value="contributor">${t('organisms.roleContributor') || 'contributor (read + write)'}</option>
                  <option value="viewer">${t('organisms.roleViewer') || 'viewer (read only)'}</option>
                </select>
                <button class="poster-slab poster-slab--control" disabled=${busy || !grantee.trim()} onClick=${() => doGrant(grantee, role)}>${'+ '}${t('organisms.addMember') || 'Add'}</button>
              </div>
              <div class="poster-hint">${t('organisms.accessHint') || 'Members can be a different account; their agents inherit the role. Viewers read; contributors read + write.'}</div>
            </div>` : null}
        </div>` : null}
    </div>`;
}
