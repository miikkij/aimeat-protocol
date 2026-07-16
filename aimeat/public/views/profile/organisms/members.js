/**
 * @file members.js
 * @description Organism Members tab — roster first (avatar rows with role badge, per-workspace
 *   access line, joined date, "…" menu for admin-promote/demote, access editing, make-creator,
 *   remove, block), a unified "+ Add people" panel (direct add / invitation / email invitation,
 *   all with role + workspace grants — see invite-panel.js), manageable pending-invitation rows,
 *   and pending join requests when present. For a regular member it is a read-only roster.
 * @structure OrgMemberManager; MemberAccessEditor (inline per-member workspace-role editor)
 * @usage import { OrgMemberManager } from '/views/profile/organisms/members.js';
 * @version-history
 *   v2.0.0 — 2026-07-16 — Unified add/invite panel (direct add default, invitation optional, email
 *     auto-detected); pending invites as editable rows; roster kebab gains Make/Remove admin +
 *     Edit access (per-workspace none/viewer/contributor). Email form moved to invite-panel.js.
 *   v1.2.0 — 2026-07-04 — Invite people not yet on the node by email (form now in invite-panel.js).
 *   v1.1.0 — 2026-06-22 — Per-member workspace access uses one getWorkspaceAccessAll(orgId) call
 *     instead of a per-owned-workspace getWorkspaceAccess fan-out.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { KebabMenu } from '/views/profile/shared.js';
import { PresenceDot } from '/components/PresenceDot.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate, orgInitials, relTime } from '/views/profile/organisms/helpers.js';
import { InvitePanel, PendingInvites } from '/views/profile/organisms/invite-panel.js';

/** Inline per-member workspace-role editor: every manageable workspace with a
 *  none/viewer/contributor select. Changes apply immediately (grant replaces, none revokes). */
function MemberAccessEditor({ orgId, member, wsOptions, wsAccess, busy, setBusy, showToast, onChanged }) {
  const bare = String(member.ghii || '').split('@')[0];
  const current = Object.fromEntries((wsAccess?.[bare] || []).map(x => [x.id, x.role]));
  const apply = async (wsId, role) => {
    setBusy(true);
    try {
      const r = role === 'none'
        ? await orgService.revokeWorkspaceRole(orgId, wsId, bare)
        : await orgService.grantWorkspaceRole(orgId, wsId, bare, role);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.accessUpdateFailed') || 'Access update failed'));
      else showToast(t('organisms.accessUpdated') || 'Access updated');
      onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.accessUpdateFailed') || 'Access update failed')); }
    finally { setBusy(false); }
  };
  return html`
    <div class="pj-eminvite pj-member-access">
      <div class="pj-eminvite-wslabel">${(t('organisms.editAccessFor') || 'Workspace access for {member}').replace('{member}', bare)}</div>
      <div class="pj-eminvite-wslist">
        ${wsOptions.map(w => {
          const owned = (wsAccess?.[bare] || []).some(x => x.id === w.id && x.role === 'owner');
          return html`
            <div class="pj-eminvite-wsrow" key=${w.id}>
              <label>${w.name}</label>
              ${owned ? html`<span class="badge badge-success">${t('organisms.wsCreator') || 'creator'}</span>` : html`
                <select class="input-field input-sm" disabled=${busy} value=${current[w.id] || 'none'}
                  onChange=${(e) => apply(w.id, e.target.value)}>
                  <option value="none">${t('organisms.accessNone') || 'No access'}</option>
                  <option value="viewer">${t('organisms.roleViewer') || 'Viewer'}</option>
                  <option value="contributor">${t('organisms.roleContributor') || 'Contributor'}</option>
                </select>`}
            </div>`;
        })}
      </div>
    </div>`;
}

/**
 * Organism member panel. For creator/admin (`canManage`) it is a full manager: approve/reject
 * join requests, add/invite people (direct add, invitation, or email — with role + workspace
 * grants), edit pending invitations, promote/demote admins, edit per-workspace access, remove/
 * block members, lift bans, and transfer ownership (creator only). For a regular member it
 * renders a read-only roster + agent list. Refreshes the parent list via onChanged.
 */
export function OrgMemberManager({ org, ghii, canManage, isCreator, showToast, confirm, onChanged, show }) {
  const orgId = org.id;
  // Membership is keyed by bare owner name; presence needs a full GHII. Local members
  // resolve via this node; an already-qualified (federated) ghii is passed through.
  const myNode = (window.AIMEAT?.auth?.getSession?.()?.ghii || '').split('@')[1] || '';
  const toGhii = (id) => (id && !id.includes('@')) ? (myNode ? `${id}@${myNode}` : '') : (id || '');
  const [requests, setRequests] = useState(null);
  const [members, setMembers] = useState(null);
  const [banned, setBanned] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailInvites, setEmailInvites] = useState([]);
  const [wsOptions, setWsOptions] = useState([]);      // [{ id, name }] workspaces available to grant
  const [wsAccess, setWsAccess] = useState(null);       // bare owner name → [{ id, name, role }]
  const [accessEditFor, setAccessEditFor] = useState(null); // bare owner name whose access panel is open

  const load = useCallback(async () => {
    const tasks = [orgService.listMembers(orgId).catch(() => null)];
    if (canManage) {
      tasks.push(
        orgService.listJoinRequests(orgId).catch(() => null),
        orgService.listMembers(orgId, 'banned').catch(() => null),
        orgService.listInvitations(orgId).catch(() => null),
        orgService.listEmailInvitations(orgId).catch(() => null),
      );
    }
    const [mb, rq, bn, inv, eminv] = await Promise.all(tasks);
    setMembers(mb?.data?.members || []);
    if (canManage) {
      setRequests(rq?.data?.join_requests || []);
      setBanned(bn?.data?.members || []);
      setInvitations(inv?.data?.invitations || []);
      setEmailInvites(eminv?.data?.invitations || []);
    }
  }, [orgId, canManage]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  // Per-member workspace access: workspace creators from discovery + the access rosters of every
  // MANAGEABLE workspace (?all=1 — for an org creator/admin that is ALL workspaces). Keyed by bare
  // owner name; entries keep the ws id so the access editor can grant/revoke. Also feeds wsOptions.
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    if (show !== 'members') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [wss, accessAll] = await Promise.all([
          orgService.discoverWorkspaces(orgId),
          orgService.getWorkspaceAccessAll(orgId),
        ]);
        const nameOf = new Map((wss || []).map(w => [w.id, w.name || w.id]));
        const map = {};
        const add = (who, wsId, wsName, role) => {
          const bare = String(who || '').split('@')[0];
          if (!bare) return;
          const list = map[bare] || (map[bare] = []);
          if (!list.some(x => x.id === wsId)) list.push({ id: wsId, name: wsName, role });
        };
        for (const w of wss) if (w.created_by) add(w.created_by, w.id, w.name || w.id, 'owner');
        for (const w of accessAll) for (const m of (w.members || [])) add(m.owner, w.ws, nameOf.get(w.ws) || w.name || w.ws, m.role);
        if (!cancelled) {
          setWsAccess(map);
          setWsOptions((wss || []).map(w => ({ id: w.id, name: w.name || w.id })));
        }
      } catch { /* the access line is optional */ }
    })();
    return () => { cancelled = true; };
  }, [orgId, show, accessTick]);
  const reloadAccess = () => setAccessTick(n => n + 1);

  const run = async (fn, okMsg, failKey) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) showToast(r?.error?.message || (t(failKey) || 'Failed'));
      else if (okMsg) showToast(okMsg);
      await load(); onChanged?.();
    } catch (e) { showToast((e && e.message) || (t(failKey) || 'Failed')); }
    finally { setBusy(false); }
  };

  const review = (rid, decision) => run(
    () => orgService.reviewJoinRequest(orgId, rid, decision),
    decision === 'approved' ? (t('organisms.joinApproved') || 'Request approved') : (t('organisms.joinRejected') || 'Request declined'),
    'organisms.reviewFailed');

  const remove = (memberGhii, ban) => confirm(
    (ban ? (t('organisms.confirmBlockMember') || 'Block {member} and remove them from this organism?') : (t('organisms.confirmRemoveMember') || 'Revoke {member}’s access to this organism?')).replace('{member}', memberGhii),
    () => run(() => orgService.removeMember(orgId, memberGhii, ban), ban ? (t('organisms.memberBlocked') || 'Member blocked') : (t('organisms.memberRemoved') || 'Member removed'), 'organisms.removeFailed'),
    { danger: true });

  const unban = (memberGhii) => run(() => orgService.unbanMember(orgId, memberGhii), (t('organisms.banLifted') || 'Block lifted'), 'organisms.removeFailed');

  const transfer = (toWhom) => confirm(
    (t('organisms.confirmTransfer') || 'Make {member} the creator? You will become an admin.').replace('{member}', toWhom),
    () => run(() => orgService.transferOwnership(orgId, toWhom), (t('organisms.ownershipTransferred') || 'Ownership transferred'), 'organisms.transferFailed'),
    { danger: true });

  const makeAdmin = (memberGhii) => run(() => orgService.addAdmin(orgId, memberGhii), (t('organisms.adminGranted') || 'Admin role granted'), 'organisms.adminChangeFailed');
  const demoteAdmin = (memberGhii) => run(() => orgService.removeAdmin(orgId, memberGhii), (t('organisms.adminRemoved') || 'Admin role removed'), 'organisms.adminChangeFailed');

  const pending = (requests || []).filter(r => r.status === 'pending');
  const showMembers = show !== 'agents';

  // "Access: Marketing (contributor)" line — creator shows "all workspaces" (mirrors reality:
  // the organism creator governs every workspace it owns; per-ws data may be partial for others).
  const accessLine = (m) => {
    if (m.role === 'creator') return t('organisms.accessAll') || 'all workspaces';
    const list = wsAccess?.[String(m.ghii || '').split('@')[0]] || [];
    if (!list.length) return '';
    return list.map(x => `${x.name} (${x.role})`).join(', ');
  };

  const onPeopleChanged = async () => { await load(); reloadAccess(); onChanged?.(); };

  return html`
    <div class="card-detail">
      ${showMembers ? html`
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.membersDesc') || 'Members can join workspaces; their agents inherit the role.'}
          ${' '}<span class="pj-members-cap">${(members || []).length}/${org.maxMembers || 500}</span></div>
        ${canManage ? html`<div class="pj-invite-btns">
          <button class="btn-primary btn-sm" onClick=${() => setShowInvite(s => !s)}>${'+ '}${t('organisms.addPeople') || 'Add people'}</button>
        </div>` : null}
      </div>

      ${canManage && showInvite ? html`
        <${InvitePanel} orgId=${orgId} wsOptions=${wsOptions} showToast=${showToast}
          onChanged=${onPeopleChanged} onClose=${() => setShowInvite(false)} />` : null}

      ${canManage ? html`
        <${PendingInvites} orgId=${orgId} invitations=${invitations} emailInvites=${emailInvites}
          wsOptions=${wsOptions} showToast=${showToast} onChanged=${onPeopleChanged} />` : null}

      ${canManage && pending.length > 0 ? pending.map(r => html`
        <div class="pj-org-row pj-req-row" key=${r.id}>
          <div class="pj-org-avatar" aria-hidden="true">${'🙋'}</div>
          <div class="pj-org-main pj-org-main-static">
            <div class="pj-org-titlerow">
              <span class="pj-org-name">${(r.ghii)}</span>
              <span class="pj-org-desc">${t('organisms.wantsToJoin') || 'wants to join'}${r.createdAt ? ` · ${relTime(r.createdAt)}` : ''}</span>
            </div>
            ${r.message ? html`<div class="pj-org-desc">${(r.message)}</div>` : null}
          </div>
          <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => review(r.id, 'rejected')}>${t('organisms.decline') || 'Decline'}</button>
          <button class="btn-success btn-sm" disabled=${busy} onClick=${() => review(r.id, 'approved')}>${t('organisms.approve') || 'Approve'}</button>
        </div>
      `) : null}

      <div class="pj-org-list">
        ${(members || []).map(m => {
          const acc = accessLine(m);
          const bare = String(m.ghii || '').split('@')[0];
          const menuItems = (canManage && m.role !== 'creator' && m.ghii !== ghii) ? [
            m.role === 'member' && { label: t('organisms.makeAdmin') || 'Make admin', icon: '⭐', onClick: () => makeAdmin(m.ghii) },
            (isCreator && m.role === 'admin') && { label: t('organisms.removeAdmin') || 'Remove admin', onClick: () => demoteAdmin(m.ghii) },
            wsOptions.length > 0 && { label: t('organisms.editAccess') || 'Edit access', icon: '🔑', onClick: () => setAccessEditFor(f => f === bare ? null : bare) },
            isCreator && { label: t('organisms.makeCreator') || 'Make creator', icon: '👑', onClick: () => transfer(m.ghii) },
            { label: t('organisms.remove') || 'Remove', danger: true, onClick: () => remove(m.ghii, false) },
            { label: t('organisms.block') || 'Block', danger: true, onClick: () => remove(m.ghii, true) },
          ].filter(Boolean) : [];
          return html`
            <div key=${m.ghii}>
              <div class="pj-org-row">
                <div class="pj-org-avatar" aria-hidden="true">${orgInitials(m.ghii)}</div>
                <div class="pj-org-main pj-org-main-static">
                  <div class="pj-org-titlerow">
                    <span class="pj-org-name">${(m.ghii)} <${PresenceDot} ghii=${toGhii(m.ghii)} /></span>
                    <span class="badge ${m.role === 'creator' ? 'badge-success' : 'badge-info'}">${(m.role || 'member')}</span>
                  </div>
                  ${(acc || m.joinedAt) ? html`
                    <div class="pj-org-desc">
                      ${acc ? `${t('organisms.accessLabel') || 'Access'}: ${acc}` : ''}${acc && m.joinedAt ? ' · ' : ''}${m.joinedAt ? (t('organisms.joinedDate') || 'joined {date}').replace('{date}', fmtDate(m.joinedAt)) : ''}
                    </div>` : null}
                  ${(m.agents || []).length ? html`
                    <div class="pj-org-desc" title=${t('organisms.memberAgentsHint') || "This member's agents — they inherit the membership and can act in this organism"}>
                      ${'🤖 '}${t('organisms.memberAgents') || 'Agents'}: ${m.agents.map(a => a.name || a.gaii).join(', ')}
                    </div>` : null}
                </div>
                ${menuItems.length ? html`<${KebabMenu} label=${t('organisms.moreActions') || 'More actions'} items=${menuItems} />` : null}
              </div>
              ${canManage && accessEditFor === bare ? html`
                <${MemberAccessEditor} orgId=${orgId} member=${m} wsOptions=${wsOptions} wsAccess=${wsAccess}
                  busy=${busy} setBusy=${setBusy} showToast=${showToast} onChanged=${reloadAccess} />` : null}
            </div>`;
        })}
      </div>

      ${canManage && banned.length > 0 ? html`
        <div class="detail-label">${t('organisms.blockedMembers') || 'Blocked'}</div>
        ${banned.map(m => html`
          <div class="pj-access-row" key=${'ban-' + m.ghii}>
            <span>${(m.ghii)}</span>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => unban(m.ghii)}>${t('organisms.unblock') || 'Unblock'}</button>
          </div>
        `)}
      ` : null}
      ` : null}
    </div>
  `;
}
