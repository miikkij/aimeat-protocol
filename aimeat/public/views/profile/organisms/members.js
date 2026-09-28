/**
 * @file members.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism Members tab — roster first (avatar rows with role badge, per-workspace
 *   access line, joined date, "…" menu for admin-promote/demote, access editing, make-creator,
 *   remove, block), a unified "+ Add people" panel (direct add / invitation / email invitation,
 *   all with role + workspace grants — see invite-panel.js), manageable pending-invitation rows,
 *   and pending join requests when present. For a regular member it is a read-only roster.
 * @structure OrgMemberManager; MemberAccessEditor (inline per-member workspace-role editor)
 * @usage import { OrgMemberManager } from '/views/profile/organisms/members.js';
 * @version-history
 *   2026-09-28 — The agents tooltip says when the organism admits only listed agents (the list then names only those).
 *   v2.14.1 -- 2026-09-26 -- The owner tag in the roster and the workspace creator in the access
 *     editor are green again, as main drew them (.badge-success: Mark tone="fine"; fix pass).
 *   v2.14.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the head is a Row of the description with the count and the Loud action; the join requests, the roster and the blocked members are the List (a request waits on the warn rail, a member's access editor opens as the row's panel, its ⋯ menu the row's menu), the access editor a Field group of Selects. The owner tag is the ink tone, where main drew it green; the dashed line on top is the Split's hairline. The page writes no class.
 *   v2.13.0 -- 2026-09-26 -- The lines under a member's or a request's name are the Listing's typewriter line (.listing-meta); a request's own message keeps its look (a unification: Jouni's decision "Meta line").
 *   v2.12.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v2.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.10.0 -- 2026-09-25 -- The label over a member's workspace access is the row label (.poster-label) (Jouni's decision "Row label", a unification).
 *   v2.9.0 -- 2026-09-25 -- The blocked members are the Listing (css/components/listing.css), a unification: the look most tabs use. The roster and the join requests stay: the line under a name is in the body face, an open conflict.
 *   v2.8.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.7.0 -- 2026-09-25 -- A picture of a person or a thing is the Object box's avatar cut (.poster-box--avatar), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v2.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.5.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v2.1.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
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
import { PresenceDot } from '/components/PresenceDot.js';
import { List, Row as ListRow, Lead, Name, Doors, Group } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Field } from '/components/Field.js';
import { Select } from '/components/Select.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Row, Stack, Split } from '/components/Layout.js';
import * as orgService from '/js/services/organisms.js';
import { fmtDate, orgInitials, relTime } from '/views/profile/organisms/helpers.js';
import { InvitePanel, PendingInvites } from '/views/profile/organisms/invite-panel.js';
import { swallowed } from '/js/swallowed.js';
import { getGhii } from '/js/services/auth.js';

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
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.accessUpdateFailed') || 'Access update failed'), true);
      else showToast(t('organisms.accessUpdated') || 'Access updated');
      onChanged?.();
    } catch (e) { showToast((e && e.message) || (t('organisms.accessUpdateFailed') || 'Access update failed'), true); }
    finally { setBusy(false); }
  };
  return html`
    <${Field} label=${(t('organisms.editAccessFor') || 'Workspace access for {member}').replace('{member}', bare)} group>
      <${Stack}>
        ${wsOptions.map(w => {
          const owned = (wsAccess?.[bare] || []).some(x => x.id === w.id && x.role === 'owner');
          return html`
            <${Row} key=${w.id} justify="between">
              <span>${w.name}</span>
              ${owned ? html`<${Mark} tone="fine">${t('organisms.wsCreator') || 'creator'}<//>` : html`
                <${Select} fit disabled=${busy} value=${current[w.id] || 'none'} ariaLabel=${w.name}
                  onChange=${(v) => apply(w.id, v)} options=${[
                    ['none', t('organisms.accessNone') || 'No access'],
                    ['viewer', t('organisms.roleViewer') || 'Viewer'],
                    ['contributor', t('organisms.roleContributor') || 'Contributor'],
                  ]} />`}
            <//>`;
        })}
      <//>
    <//>`;
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
  const myNode = (getGhii() || '').split('@')[1] || '';
  const toGhii = (id) => (id && !id.includes('@')) ? (myNode ? `${id}@${myNode}` : '') : (id || '');
  const [requests, setRequests] = useState(null);
  const [members, setMembers] = useState(null);
  const [agentAccess, setAgentAccess] = useState('all'); // which agents the organism admits (the server lists only those)
  const [banned, setBanned] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailInvites, setEmailInvites] = useState([]);
  const [wsOptions, setWsOptions] = useState([]);      // [{ id, name }] workspaces available to grant
  const [wsAccess, setWsAccess] = useState(null);       // bare owner name → [{ id, name, role }]
  const [accessEditFor, setAccessEditFor] = useState(null); // bare owner name whose access panel is open

  const load = useCallback(async () => {
    const tasks = [orgService.listMembers(orgId).catch(err => { swallowed('members: toGhii', err); return null; })];
    if (canManage) {
      tasks.push(
        orgService.listJoinRequests(orgId).catch(err => { swallowed('members: toGhii', err); return null; }),
        orgService.listMembers(orgId, 'banned').catch(err => { swallowed('members: toGhii', err); return null; }),
        orgService.listInvitations(orgId).catch(err => { swallowed('members: toGhii', err); return null; }),
        orgService.listEmailInvitations(orgId).catch(err => { swallowed('members: toGhii', err); return null; }),
      );
    }
    const [mb, rq, bn, inv, eminv] = await Promise.all(tasks);
    setMembers(mb?.data?.members || []);
    setAgentAccess(mb?.data?.agent_access === 'listed' ? 'listed' : 'all');
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
      } catch (err) { swallowed('members: add', err); }
    })();
    return () => { cancelled = true; };
  }, [orgId, show, accessTick]);
  const reloadAccess = () => setAccessTick(n => n + 1);

  const run = async (fn, okMsg, failKey) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) showToast(r?.error?.message || (t(failKey) || 'Failed'), true);
      else if (okMsg) showToast(okMsg);
      await load(); onChanged?.();
    } catch (e) { showToast((e && e.message) || (t(failKey) || 'Failed'), true); }
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

  // Additive, and that is the whole point: bringing in a second owner used to cost the first one
  // everything, and an organism whose single owner went unreachable could not be recovered at all.
  const addOwner = (toWhom) => confirm(
    (t('organisms.confirmAddOwner') || 'Make {member} an owner too? They get everything you can do, and you keep it.').replace('{member}', toWhom),
    () => run(() => orgService.addOwner(orgId, toWhom), (t('organisms.ownerAdded') || 'Owner added'), 'organisms.transferFailed'));

  const removeOwner = (fromWhom) => confirm(
    (t('organisms.confirmRemoveOwner') || 'Take {member} off the owners? They stay as an admin.').replace('{member}', fromWhom),
    () => run(() => orgService.removeOwner(orgId, fromWhom), (t('organisms.ownerRemoved') || 'Owner removed'), 'organisms.transferFailed'),
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
    <${Split}>
      ${showMembers ? html`
      <${Row} align="start" justify="between" gap="medium">
        <${HeadDesc}>${t('organisms.membersDesc') || 'Members can join workspaces; their agents inherit the role.'}
          ${' '}<${Note} kind="meta" inline>${(members || []).length}/${org.maxMembers || 500}<//><//>
        ${canManage ? html`
          <${Loud} control expanded=${showInvite} onClick=${() => setShowInvite(s => !s)}>${'+ '}${t('organisms.addPeople') || 'Add people'}<//>` : null}
      <//>

      ${canManage && showInvite ? html`
        <${InvitePanel} orgId=${orgId} wsOptions=${wsOptions} showToast=${showToast}
          onChanged=${onPeopleChanged} onClose=${() => setShowInvite(false)} />` : null}

      ${canManage ? html`
        <${PendingInvites} orgId=${orgId} invitations=${invitations} emailInvites=${emailInvites}
          wsOptions=${wsOptions} showToast=${showToast} onChanged=${onPeopleChanged} />` : null}

      ${canManage && pending.length > 0 ? html`
        <${List} cols="mark-name-doors" keepCols>
          ${pending.map(r => html`
            <${ListRow} key=${r.id} rail="warn">
              <${Lead} text=${'🙋'} />
              <${Name} meta=${`${t('organisms.wantsToJoin') || 'wants to join'}${r.createdAt ? ` · ${relTime(r.createdAt)}` : ''}`}
                desc=${r.message ? (r.message) : null}>${(r.ghii)}<//>
              <${Doors}>
                <${Action} small disabled=${busy} onClick=${() => review(r.id, 'rejected')}>${t('organisms.decline') || 'Decline'}<//>
                <${Action} small disabled=${busy} onClick=${() => review(r.id, 'approved')}>${t('organisms.approve') || 'Approve'}<//>
              <//>
            <//>
          `)}
        <//>` : null}

      <${List} cols="mark-name-doors" keepCols>
        ${(members || []).map(m => {
          const acc = accessLine(m);
          const bare = String(m.ghii || '').split('@')[0];
          // An owner row used to carry no menu at all, so an organism could be handed away and never
          // handed back: the only person who could undo it was the one who no longer had the button.
          // Another owner can now take a co-owner off, and nobody can take off the last one.
          const isOwnerRow = m.role === 'creator';
          const ownerCount = (members || []).filter(x => x.role === 'creator').length;
          const menuItems = !canManage ? [] : (isOwnerRow ? [
            (isCreator && m.ghii !== ghii && ownerCount > 1)
              && { label: t('organisms.removeOwner') || 'Remove owner', danger: true, onClick: () => removeOwner(m.ghii) },
          ].filter(Boolean) : (m.ghii !== ghii ? [
            m.role === 'member' && { label: t('organisms.makeAdmin') || 'Make admin', icon: '⭐', onClick: () => makeAdmin(m.ghii) },
            (isCreator && m.role === 'admin') && { label: t('organisms.removeAdmin') || 'Remove admin', onClick: () => demoteAdmin(m.ghii) },
            wsOptions.length > 0 && { label: t('organisms.editAccess') || 'Edit access', icon: '🔑', onClick: () => setAccessEditFor(f => f === bare ? null : bare) },
            isCreator && { label: t('organisms.addOwner') || 'Make owner too', icon: '👑', onClick: () => addOwner(m.ghii) },
            isCreator && { label: t('organisms.makeCreator') || 'Hand over and step back', onClick: () => transfer(m.ghii) },
            { label: t('organisms.remove') || 'Remove', danger: true, onClick: () => remove(m.ghii, false) },
            { label: t('organisms.block') || 'Block', danger: true, onClick: () => remove(m.ghii, true) },
          ].filter(Boolean) : []));
          // The lines under the name: the access and the join date, then the member's agents (with the
          // tooltip that says what they are).
          const line = (acc || m.joinedAt)
            ? `${acc ? `${t('organisms.accessLabel') || 'Access'}: ${acc}` : ''}${acc && m.joinedAt ? ' · ' : ''}${m.joinedAt ? (t('organisms.joinedDate') || 'joined {date}').replace('{date}', fmtDate(m.joinedAt)) : ''}`
            : null;
          const agentsLine = (m.agents || []).length
            ? html`<span title=${agentAccess === 'listed'
              ? (t('organisms.memberAgentsHintListed') || "This member's agents that the organism admits. They act with the member's rights.")
              : (t('organisms.memberAgentsHint') || "This member's agents — they inherit the membership and can act in this organism")}>${'🤖 '}${t('organisms.memberAgents') || 'Agents'}: ${m.agents.map(a => a.name || a.gaii).join(', ')}</span>`
            : null;
          const accessOpen = canManage && accessEditFor === bare;
          return html`
            <${ListRow} key=${m.ghii} open=${accessOpen} panel=${accessOpen ? html`
              <${MemberAccessEditor} orgId=${orgId} member=${m} wsOptions=${wsOptions} wsAccess=${wsAccess}
                busy=${busy} setBusy=${setBusy} showToast=${showToast} onChanged=${reloadAccess} />` : null}>
              <${Lead} text=${orgInitials(m.ghii)} />
              <!-- The stored role is still 'creator', and several members can hold it now, so
                   the badge says what it means: owner. Two rows both reading "creator" asks
                   the viewer which one really made the organism. -->
              <${Name} after=${html` <${PresenceDot} ghii=${toGhii(m.ghii)} /> <${Mark} tone=${isOwnerRow ? 'fine' : undefined}>${isOwnerRow ? (t('organisms.roleOwner') || 'owner') : (m.role || 'member')}<//>`}
                meta=${line || agentsLine ? html`${line}${line && agentsLine ? html`<br />` : null}${agentsLine}` : null}>${(m.ghii)}<//>
              <${Doors} menu=${menuItems.length ? menuItems : null} menuLabel=${t('organisms.moreActions') || 'More actions'} />
            <//>`;
        })}
      <//>

      ${canManage && banned.length > 0 ? html`
        <${Group} title=${t('organisms.blockedMembers') || 'Blocked'}>
          <${List} cols="name-doors" keepCols>
            ${banned.map(m => html`
              <${ListRow} key=${'ban-' + m.ghii}>
                <${Name}>${(m.ghii)}<//>
                <${Doors}><${Action} small row disabled=${busy} onClick=${() => unban(m.ghii)}>${t('organisms.unblock') || 'Unblock'}<//><//>
              <//>
            `)}
          <//>
        <//>
      ` : null}
      ` : null}
    <//>
  `;
}
