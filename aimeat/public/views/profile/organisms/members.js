/**
 * @file members.js
 * @description Organism Members tab — roster first (avatar rows with role badge, per-workspace
 *   access line, joined date, "…" menu for make-creator/remove/block), "+ Invite" toggle, and
 *   pending join requests when present. For a regular member it is a read-only roster. Extracted
 *   from organisms-tab.js, no behaviour change.
 * @structure OrgMemberManager
 * @usage import { OrgMemberManager } from '/views/profile/organisms/members.js';
 * @version-history
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

/**
 * Organism member panel. For creator/admin (`canManage`) it is a full manager: approve/reject
 * join requests, invite by name, remove/block members, lift bans, transfer ownership (creator
 * only), and attach/detach agents. For a regular member it renders a read-only roster + agent
 * list. Backend: /:id/{join-requests,invitations,members,transfer,agents}. Refreshes the
 * parent list via onChanged so member counts stay current.
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
  const [inviteName, setInviteName] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wsAccess, setWsAccess] = useState(null);   // bare owner name → [{ ws, role }] (best effort)

  const load = useCallback(async () => {
    const tasks = [orgService.listMembers(orgId).catch(() => null)];
    if (canManage) {
      tasks.push(
        orgService.listJoinRequests(orgId).catch(() => null),
        orgService.listMembers(orgId, 'banned').catch(() => null),
        orgService.listInvitations(orgId).catch(() => null),
      );
    }
    const [mb, rq, bn, inv] = await Promise.all(tasks);
    setMembers(mb?.data?.members || []);
    if (canManage) {
      setRequests(rq?.data?.join_requests || []);
      setBanned(bn?.data?.members || []);
      setInvitations(inv?.data?.invitations || []);
    }
  }, [orgId, canManage]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  // Per-member workspace access (best effort): workspace creators from discovery + access lists of
  // the workspaces the viewer created. Keyed by bare owner name (memberships use bare names too).
  useEffect(() => {
    if (show !== 'members') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const wss = await orgService.discoverWorkspaces(orgId);
        const map = {};
        const add = (who, wsName, role) => {
          const bare = String(who || '').split('@')[0];
          if (!bare) return;
          const list = map[bare] || (map[bare] = []);
          if (!list.some(x => x.ws === wsName)) list.push({ ws: wsName, role });
        };
        for (const w of wss) if (w.created_by) add(w.created_by, w.name || w.id, 'owner');
        await Promise.all(wss.filter(w => w.access === 'owner').map(async (w) => {
          const acc = await orgService.getWorkspaceAccess(orgId, w.id).catch(() => null);
          for (const m of (acc?.members || [])) add(m.owner, w.name || w.id, m.role);
        }));
        if (!cancelled) setWsAccess(map);
      } catch { /* the access line is optional */ }
    })();
    return () => { cancelled = true; };
  }, [orgId, show]);

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

  const invite = () => {
    const name = inviteName.trim();
    if (!name) return;
    setInviteName('');
    run(() => orgService.inviteMember(orgId, name), (t('organisms.invitationSent') || 'Invitation sent'), 'organisms.inviteFailed');
  };

  const remove = (memberGhii, ban) => confirm(
    (ban ? (t('organisms.confirmBlockMember') || 'Block {member} and remove them from this organism?') : (t('organisms.confirmRemoveMember') || 'Revoke {member}’s access to this organism?')).replace('{member}', memberGhii),
    () => run(() => orgService.removeMember(orgId, memberGhii, ban), ban ? (t('organisms.memberBlocked') || 'Member blocked') : (t('organisms.memberRemoved') || 'Member removed'), 'organisms.removeFailed'),
    { danger: true });

  const unban = (memberGhii) => run(() => orgService.unbanMember(orgId, memberGhii), (t('organisms.banLifted') || 'Block lifted'), 'organisms.removeFailed');

  const transfer = (toWhom) => confirm(
    (t('organisms.confirmTransfer') || 'Make {member} the creator? You will become an admin.').replace('{member}', toWhom),
    () => run(() => orgService.transferOwnership(orgId, toWhom), (t('organisms.ownershipTransferred') || 'Ownership transferred'), 'organisms.transferFailed'),
    { danger: true });

  const pending = (requests || []).filter(r => r.status === 'pending');
  const showMembers = show !== 'agents';

  // "Access: Marketing (contributor)" line — creator shows "all workspaces" (mirrors reality:
  // the organism creator governs every workspace it owns; per-ws data may be partial for others).
  const accessLine = (m) => {
    if (m.role === 'creator') return t('organisms.accessAll') || 'all workspaces';
    const list = wsAccess?.[String(m.ghii || '').split('@')[0]] || [];
    if (!list.length) return '';
    return list.map(x => `${x.ws} (${x.role})`).join(', ');
  };

  return html`
    <div class="card-detail">
      ${showMembers ? html`
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.membersDesc') || 'Members can join workspaces; their agents inherit the role.'}
          ${' '}<span class="pj-members-cap">${(members || []).length}/${org.maxMembers || 500}</span></div>
        ${canManage ? html`<button class="btn-primary btn-sm" onClick=${() => setShowInvite(s => !s)}>${'+ '}${t('organisms.invite') || 'Invite'}</button>` : null}
      </div>

      ${canManage && showInvite ? html`
        <div class="flex-row-wrap pj-invite-row">
          <input class="input-field input-sm" autofocus placeholder=${t('organisms.inviteePlaceholder') || 'owner name'} value=${inviteName}
            onInput=${(e) => setInviteName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') invite(); }} />
          <button class="btn-outline btn-sm" disabled=${busy || !inviteName.trim()} onClick=${invite}>${t('organisms.invite') || 'Invite'}</button>
          <button class="btn-ghost btn-sm" onClick=${() => setShowInvite(false)}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>` : null}
      ${canManage && invitations.length > 0 ? html`
        <div class="section-desc">${t('organisms.outstandingInvites') || 'Awaiting acceptance'}: ${invitations.map(m => (m.ghii)).join(', ')}</div>
      ` : null}

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
          const menuItems = (canManage && m.role !== 'creator' && m.ghii !== ghii) ? [
            isCreator && { label: t('organisms.makeCreator') || 'Make creator', icon: '👑', onClick: () => transfer(m.ghii) },
            { label: t('organisms.remove') || 'Remove', danger: true, onClick: () => remove(m.ghii, false) },
            { label: t('organisms.block') || 'Block', danger: true, onClick: () => remove(m.ghii, true) },
          ] : [];
          return html`
            <div class="pj-org-row" key=${m.ghii}>
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
