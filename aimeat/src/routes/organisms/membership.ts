/**
 * @file src/routes/organisms/membership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism membership + roster routes: members listing, join-request review, admin
 *   promote/demote, member removal/ban/unban, ownership transfer, name-based invitations (with
 *   invite-time role + workspace grants, pending-invite edit/cancel), DIRECT member add, and agent
 *   attach/detach. Extracted from src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   2026-11-13 — The invite-admin gate, the two owner routes, GET /invitations/mine and POST
 *     /:id/invitations/accept read through services/organism-read/manager.ts and name-invitations.ts,
 *     which the name invitation tools ask too; the answers are unchanged (structure programme 2026-11,
 *     unit 2b).
 *   2026-11-13 — GET /v1/organisms/:id/members takes the agents it names from rosterAgentsFor
 *     (services/organism-privacy.ts), the rule aimeat_organism_members asks too; its answer is
 *     unchanged (structure programme 2026-11, unit 7).
 *   2026-11-12 — GET /v1/organisms/:id/join-requests and POST …/join-requests/:requestId/review call
 *     readJoinRequests and decideJoinRequest (services/organism-join-requests/requests.ts), which
 *     the MCP tools call too: the open list leaves out a request whose person is a member by now, a person who became a member
 *     in the meantime is approved without a second membership, an access request's answer names the
 *     app or page, and every approver's notice is marked answered.
 *   2026-11-11 — POST and DELETE /v1/organisms/:id/agents call services/organism-agents/attach.ts,
 *     which the MCP tools aimeat_organism_agent_attach and _detach call too. The rules are unchanged;
 *     the listed-mode refusal names account:security, the permission that lets an agent add one.
 *   2026-10-27 — GET /v1/organisms/:id/members answers a private organism's roster only to an active
 *     member (or an agent of one), an agent attached to it and the operator, and 404 to everyone else,
 *     as GET /v1/organisms/:id and aimeat_organism_members do (secaudit2026oct26,
 *     GET-members:private-organism-without-visibility-gate).
 *   2026-10-19 — Each member's agents on GET /v1/organisms/:id/members carry `avatar` (services/agent-avatar.ts), one batched read for every listed agent.
 *   2026-10-15 — POST /:id/invitations/accept accepts only for the person in person (isOwnerPrincipal),
 *     as the emailed link does (feature-list audit #57). POST /:id/agents on an organism that admits only
 *     listed agents is the owner's or an admin's alone; a member no longer lists their own agent
 *     (feature-list audit #58).
 *   v1.7.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): organism:read on GET /v1/organisms/:id/join-requests, GET /v1/organisms/:id/invitations, GET /v1/organisms/invitations/mine; organism:invite on POST /v1/organisms/:id/join-requests/:requestId/review, POST /v1/organisms/:id/admins, DELETE /v1/organisms/:id/admins/:ghii, DELETE /v1/organisms/:id/members/:ghii, POST /v1/organisms/:id/members/:ghii/unban, POST /v1/organisms/:id/transfer, POST /v1/organisms/:id/owners, DELETE /v1/organisms/:id/owners/:ghii, POST /v1/organisms/:id/invitations, POST /v1/organisms/:id/members, PATCH /v1/organisms/:id/invitations/:ghii, DELETE /v1/organisms/:id/invitations/:ghii, POST /v1/organisms/:id/agents, DELETE /v1/organisms/:id/agents/:gaii; organism:write on POST /v1/organisms/:id/invitations/accept, POST /v1/organisms/:id/invitations/decline. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   v1.6.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   2026-09-28 — The member list names only the agents the organism admits (agentAccess), and says which
 *     setting is in force; an owner or admin can attach any active member's agent, and where only listed
 *     agents are admitted, only a person signed in can attach one.
 *   v1.5.1 — 2026-09-26 — The member and agent owner names come from localAccountName (utils/gaii.ts),
 *     which keeps an identity of another node whole, so it never names the local namesake
 *     (secaudit 2026-09, F-1).
 *   v1.5.0 — 2026-08-25 — The member-removal rules move to services/organism-member-remove.ts so the
 *     MCP surfaces can remove a member through the same refusals, agent detach, grant revoke and
 *     notice. The route keeps its gate and its envelope and decides nothing else.
 *   v1.4.0 — 2026-08-15 — The transfer route's three writes moved into
 *     services/organism-ownership.ts, which the operator's break-glass repair also calls. It had one
 *     caller until an organism arrived whose creator account was unreachable and nothing on any
 *     surface could put it back; a second copy of the sequence is how the two would drift.
 *   v1.3.0 — 2026-08-11 — SECURITY (H-29): removing or banning a member also detaches their agents
 *     from organism.agentGaiis and revokes their workspace-role consents
 *     (revokeDepartedMemberAccess) — an ejected person kept full access through their own agent token.
 *   v1.2.0 — 2026-08-11 — the decline route calls declineNameInvitation() instead of deleting the
 *     membership row itself, so it and aimeat_organism_invitation_respond share one write
 *     (August 2026 MCP audit step 8).
 *   v1.1.0 — 2026-07-16 — Name-invites carry role + workspaces (services/invitations.ts core); new
 *     POST /members (direct add), PATCH + DELETE /invitations/:ghii (edit/cancel pending).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, optionalAuth } from '../../auth/middleware.js';
import { localAccountName, resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { canSeeMembers, rosterAgentsFor, rosterCallerFromAuth } from '../../services/organism-privacy.js';
import { handOverOwnership, addOrganismOwner, removeOrganismOwner, isOrganismOwner } from '../../services/organism-ownership.js';
import { organismForManager, organismForOwner } from '../../services/organism-read/manager.js';
import { nameInvitationsOf, nameInvitationTo } from '../../services/organism-read/name-invitations.js';
import { removeOrganismMember, MemberRemoveError } from '../../services/organism-member-remove.js';
import {
  InvitationError, createNameInvitation, updateNameInvitation, cancelNameInvitation,
  acceptNameInvitation, declineNameInvitation, addOrganismMember, NAMED_INVITE_ACCEPT_REFUSAL,
} from '../../services/invitations.js';
import { agentAccessOf } from '../../services/organism-agent-access.js';
import { attachOrganismAgent, detachOrganismAgent, AgentListError } from '../../services/organism-agents/attach.js';
import { isOwnerPrincipal } from '../../auth/account-security.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { readAvatarsOrEmpty } from '../../services/agent/avatar.js';
import { readJoinRequests, decideJoinRequest } from '../../services/organism-join-requests/requests.js';
import { logger } from '../../utils/logger.js';

export function registerOrganismMembershipRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  /* ── GET /v1/organisms/:id/members — List members ── */
  router.get('/v1/organisms/:id/members', optionalAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { role, status } = req.query;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // The shared anonymous identity is treated as unauthenticated (rosterCallerFromAuth).
    const rosterCaller = await rosterCallerFromAuth(storage, req.auth);

    // A private organism is not there for a caller who is not in it, here as on GET /v1/organisms/:id
    // and aimeat_organism_members: an active member (an agent of one by its owner's name), an agent
    // attached to the organism, or the operator. The roster tier below decides only how much of the
    // roster a caller who may see the organism reads.
    if (organism.visibility === 'private' && !rosterCaller.isOperator) {
      const membership = rosterCaller.ownerName ? await storage.getMembership(id, rosterCaller.ownerName) : null;
      const attached = !!req.auth && organism.agentGaiis.includes(resolveIdentity(req.auth, config.nodeId));
      if (membership?.status !== 'active' && !attached) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
    }

    const members = await storage.listMembers(id, {
      role: role as string,
      status: (status as string) || 'active',
    });

    // Roster privacy (memberVisibility): below the tier the listing shrinks to the accountability
    // rows — creator/admins + the caller's own row — while the TRUE total stays (count ≠ identity).
    const canSeeRoster = await canSeeMembers(storage, organism, rosterCaller);
    if (!canSeeRoster) {
      const visible = members.filter(m => m.role === 'creator' || m.role === 'admin'
        || isOrganismOwner(organism, m.ghii) || organism.admins.includes(m.ghii)
        || (rosterCaller.ownerName && m.ghii === rosterCaller.ownerName));
      res.json(success(config.nodeId, { members: visible, total: members.length, members_hidden: true }));
      return;
    }

    // A member's agents inherit access implicitly (same-owner: join answers ALREADY_MEMBER), so
    // "who can touch this organism" must be enumerable — an unlisted actor with access is an
    // audit gap. Each member row carries its owner's agents for ACTIVE members (or an operator)
    // only; outsiders/public callers get the legacy shape (agent rosters are not public data).
    // Who is shown them and which ones (the organism's admitted agents) is rosterAgentsFor
    // (services/organism-privacy.ts), which aimeat_organism_members asks too. rosterCaller.isOperator
    // is isOperatorCaller's answer (the operator, or the operator's agent holding operator:admin).
    // ONE `owner IN (…)` query for every member's agents, not one getAgentsByOwner per member.
    const ownerNames = members.map(m => localAccountName(m.ghii));
    const agentsByOwner = await rosterAgentsFor(storage, organism, rosterCaller, canSeeRoster, ownerNames);
    if (agentsByOwner) {
      const admitted = ownerNames.map(o => agentsByOwner.get(o) ?? []);
      const avatars = await readAvatarsOrEmpty(storage, admitted.flat().map(a => a.gaii), logger.warn.bind(logger), 'GET /v1/organisms/:id/members');
      const enriched = members.map((m, i) => ({
        ...m,
        agents: admitted[i].map(a => ({ gaii: a.gaii, name: a.name, avatar: avatars.get(a.gaii) ?? null })),
      }));
      res.json(success(config.nodeId, { members: enriched, total: enriched.length, agents_included: true, agent_access: agentAccessOf(organism) }));
      return;
    }

    res.json(success(config.nodeId, { members, total: members.length }));
  });

  /* ── GET /v1/organisms/:id/join-requests — List pending join requests ── */
  router.get('/v1/organisms/:id/join-requests', requireAuth(), requireRestScope('organism:read'), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    // Who may read them and which ones are open: services/organism-join-requests/requests.ts
    // readJoinRequests, which aimeat_organism_join_requests calls too. Each request carries `via`
    // when it was asked from an app's or a page's refusal.
    const result = await readJoinRequests({ storage, config }, id, ghii, req.query.status);
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    res.json(success(config.nodeId, { join_requests: result.requests, total: result.requests.length }));
  });

  /* ── POST /v1/organisms/:id/join-requests/:requestId/review — Approve/reject ── */
  router.post('/v1/organisms/:id/join-requests/:requestId/review', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    const { decision } = req.body ?? {};

    // Who may decide, the verdict, the membership, the answer to the requester and the approvers'
    // answered notices are services/organism-join-requests/requests.ts, which
    // aimeat_organism_join_request_review calls too.
    const result = await decideJoinRequest({ storage, config }, id, requestId, decision,
      { owner: ghii, principal: resolveIdentity(req.auth!, config.nodeId) });
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    res.json(success(config.nodeId, { decision: result.decision, request_id: requestId }));
  });

  /* ── POST /v1/organisms/:id/admins — Add an admin ── */
  router.post('/v1/organisms/:id/admins', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { target_ghii } = req.body ?? {};

    if (!target_ghii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_ghii is required'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (!isOrganismOwner(organism, ghii) && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can promote members'));
      return;
    }

    const membership = await storage.getMembership(id, target_ghii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target is not an active member'));
      return;
    }

    if (organism.admins.includes(target_ghii)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_ADMIN', 'Target is already an admin'));
      return;
    }

    await storage.updateMembership(membership.id, { role: 'admin' });
    await storage.updateOrganism(id, {
      admins: [...organism.admins, target_ghii],
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { promoted: target_ghii, role: 'admin' }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/admins/:ghii — Remove admin role ── */
  router.delete('/v1/organisms/:id/admins/:ghii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = req.params.ghii as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can demote admins'));
      return;
    }

    if (isOrganismOwner(organism, targetGhii)) {
      res.status(400).json(error(config.nodeId, 'CANNOT_DEMOTE_CREATOR', 'Cannot remove admin from creator'));
      return;
    }

    const membership = await storage.getMembership(id, targetGhii);
    if (!membership) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Member not found'));
      return;
    }

    await storage.updateMembership(membership.id, { role: 'member' });
    await storage.updateOrganism(id, {
      admins: organism.admins.filter(a => a !== targetGhii),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { demoted: targetGhii, role: 'member' }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/members/:ghii — Remove (revoke) a member ──
   * Creator/admin removes another member's organism access entirely: deletes the
   * membership and drops them from members[] (+ admins[] if applicable). The creator
   * cannot be removed (they must delete the organism); an admin can only be removed by
   * the creator. The removed member is notified. To leave voluntarily, use /leave. */
  router.delete('/v1/organisms/:id/members/:ghii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // `?ban=1` (or body { ban: true }) blocks the member from re-joining / being re-invited:
    // keep the membership row but flip it to `banned` instead of deleting it. Plain remove just
    // deletes the row (they can request to join again). The rules, the access revoke and the
    // notice live in services/organism-member-remove.ts, which the MCP tool calls as well.
    const ban = req.query.ban === '1' || req.query.ban === 'true' || req.body?.ban === true;
    try {
      const out = await removeOrganismMember(storage, config, {
        organism, callerOwner: callerGhii, targetRaw: targetGhii, ban,
      });
      res.json(success(config.nodeId, out));
    } catch (e) {
      if (e instanceof MemberRemoveError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      throw e;
    }
  });

  /* ── POST /v1/organisms/:id/members/:ghii/unban — Lift a ban ──
   * Creator/admin removes the block on a previously-banned owner by deleting the banned
   * membership row, so they can request to join (or be invited) again. */
  router.post('/v1/organisms/:id/members/:ghii/unban', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!isOrganismOwner(organism, callerGhii) && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can lift a block'));
      return;
    }
    const membership = await storage.getMembership(id, targetGhii);
    if (!membership || membership.status !== 'banned') {
      res.status(404).json(error(config.nodeId, 'NOT_BANNED', 'Target is not blocked'));
      return;
    }
    await storage.deleteMembership(membership.id);
    res.json(success(config.nodeId, { unbanned: targetGhii }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/transfer — Transfer ownership ──
   * The creator hands the organism to an existing active member: the target becomes `creator`,
   * the previous creator is demoted to `admin` (kept as a member). Only the current creator may
   * call this. The new creator is notified. */
  router.post('/v1/organisms/:id/transfer', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { to } = req.body ?? {};
    if (!to || typeof to !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "to" (an active member) is required'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!isOrganismOwner(organism, callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can transfer ownership'));
      return;
    }
    if (to === callerGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You are already the creator'));
      return;
    }
    // The three writes, the membership checks and both notifications live in the service, because
    // the operator's break-glass repair (POST /v1/admin/organisms/:id/ownership) performs the same
    // transition and a second copy of it would drift. `seatNonMember` stays off here: a creator hands
    // the organism to somebody already in it.
    const outcome = await handOverOwnership(storage, config, organism, to, callerGhii);
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');

    // `creator`/`previousCreator` are the v4 words for what is now one add and one remove. Kept for
    // clients built against them; `owners` is the field to read.
    res.json(success(config.nodeId, {
      creator: outcome.added, previousCreator: outcome.removed, owners: outcome.owners,
    }));
    emitChange('organisms');
  });

  /* Reading who owns an organism has no route of its own: GET /v1/organisms/:id already returns the
   * record, and `owners` + `createdBy` are fields on it. A wrapper would be a second answer to the
   * same question, subject to a second set of visibility rules. */

  /* ── POST /v1/organisms/:id/owners — { ghii } — ADD an owner ──
   * Additive on purpose. Ownership used to move in one irreversible step, so bringing in a second
   * pair of hands cost the first pair everything, and an organism whose single owner went unreachable
   * could not be recovered by anyone. Adding costs the adder nothing; the handover is this plus the
   * DELETE below, with a look in between. The target must already be an active member. ── */
  router.post('/v1/organisms/:id/owners', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const callerGhii = req.auth!.owner as string;
    const { ghii } = req.body ?? {};
    if (!ghii || typeof ghii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "ghii" (an active member) is required'));
      return;
    }
    // The read and the owner rule are services/organism-read/manager.ts, which aimeat_organism_owner_add asks too.
    const gate = await organismForOwner(storage, id, { owner: callerGhii });
    if (!gate.ok) {
      if (gate.code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      else res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can add an owner'));
      return;
    }
    const organism = gate.organism;
    const outcome = await addOrganismOwner(storage, config, organism, ghii, { performedBy: callerGhii });
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');
    res.json(success(config.nodeId, { owners: outcome.owners, added: outcome.added }));
    emitChange('organisms');
  });

  /* ── DELETE /v1/organisms/:id/owners/:ghii — step down, or remove a co-owner ──
   * The departing owner stays as an admin. The LAST owner cannot be removed: an organism with no
   * owner is the one state nobody inside it can repair. ── */
  router.delete('/v1/organisms/:id/owners/:ghii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const callerGhii = req.auth!.owner as string;
    const targetGhii = req.params.ghii as string;
    // The read and the owner rule are services/organism-read/manager.ts, which aimeat_organism_owner_remove asks too.
    const gate = await organismForOwner(storage, id, { owner: callerGhii });
    if (!gate.ok) {
      if (gate.code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      else res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an owner can remove an owner'));
      return;
    }
    const organism = gate.organism;
    const outcome = await removeOrganismOwner(storage, config, organism, targetGhii, { performedBy: callerGhii });
    if (!outcome.ok) {
      res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    emitChange('notifications');
    res.json(success(config.nodeId, { owners: outcome.owners, removed: outcome.removed }));
    emitChange('organisms');
  });

  /* ── Invitations (invite_only flow; works for any policy) ──
   * A creator/admin invites an owner by bare name. The invite is a membership row with
   * status `invited` + `invitedBy`. The invitee is notified and accepts/declines. */

  /** Creator/admin gate shared by the invite/add/edit routes — the organism, or null (responded). */
  const requireInviteAdmin = async (req: Request, res: Response) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    // The read and the owner-or-admin rule are services/organism-read/manager.ts, which the invite tools ask too.
    const gate = await organismForManager(storage, id, { owner: callerGhii });
    if (gate.ok) return gate.organism;
    if (gate.code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
    else res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can manage members and invitations'));
    return null;
  };

  /* POST /v1/organisms/:id/invitations — invite an owner, optionally with an org role and
   * invite-time workspace grants applied when they accept.
   * Body: { invitee, role?: 'member'|'admin', workspaces?: [{ws, role: 'viewer'|'contributor'}] } */
  router.post('/v1/organisms/:id/invitations', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const { invitee, role, workspaces } = req.body ?? {};
    if (!invitee || typeof invitee !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "invitee" (an owner name) is required'));
      return;
    }
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      const membership = await createNameInvitation(storage, config, {
        organism, inviterGhii: req.auth!.owner as string, inviteeRaw: invitee, role, workspaces,
      });
      res.status(201).json(success(config.nodeId, { invitation: membership, status: 'invited' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* POST /v1/organisms/:id/members — DIRECT ADD: creator/admin adds an existing local owner as an
   * ACTIVE member, role + workspace grants applied immediately (no accept round-trip; the invitee is
   * notified and can leave). Body: { ghii, role?, workspaces? } */
  router.post('/v1/organisms/:id/members', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const { ghii, role, workspaces } = req.body ?? {};
    if (!ghii || typeof ghii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "ghii" (an owner name) is required'));
      return;
    }
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      const { membership, grantedWorkspaces } = await addOrganismMember(storage, config, {
        organism, inviterGhii: req.auth!.owner as string, inviteeRaw: ghii, role, workspaces,
      });
      res.status(201).json(success(config.nodeId, { member: membership, workspaces: grantedWorkspaces, status: 'added' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* PATCH /v1/organisms/:id/invitations/:ghii — edit a PENDING invitation's role/workspace grants
   * (rights stay editable until the invitee accepts). Body: { role?, workspaces? } */
  router.patch('/v1/organisms/:id/invitations/:ghii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    const { role, workspaces } = req.body ?? {};
    if (role === undefined && workspaces === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide "role" and/or "workspaces" to update'));
      return;
    }
    try {
      const membership = await updateNameInvitation(storage, config, {
        organism, inviteeRaw: req.params.ghii as string, role, workspaces,
      });
      res.json(success(config.nodeId, { invitation: membership }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* DELETE /v1/organisms/:id/invitations/:ghii — cancel a PENDING name invitation (creator/admin). */
  router.delete('/v1/organisms/:id/invitations/:ghii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    const organism = await requireInviteAdmin(req, res);
    if (!organism) return;
    try {
      await cancelNameInvitation(storage, config, {
        organism, cancellerGhii: req.auth!.owner as string, inviteeRaw: req.params.ghii as string,
      });
      res.json(success(config.nodeId, { status: 'cancelled' }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* GET /v1/organisms/:id/invitations — list outstanding invitations (creator/admin) */
  router.get('/v1/organisms/:id/invitations', requireAuth(), requireRestScope('organism:read'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!isOrganismOwner(organism, callerGhii) && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can view invitations'));
      return;
    }
    const invitations = await storage.listMembers(id, { status: 'invited' });
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* GET /v1/organisms/invitations/mine — the caller's own pending invitations (across organisms) */
  router.get('/v1/organisms/invitations/mine', requireAuth(), requireRestScope('organism:read'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    // services/organism-read/name-invitations.ts, which aimeat_organism_invitations asks too.
    const invitations = (await nameInvitationsOf(storage, { owner: callerGhii })).map(({ membership: m, organism: org }) =>
      ({ membership: m, organism: { id: org.id, name: org.name, description: org.description, type: org.type, visibility: org.visibility } }));
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* POST /v1/organisms/:id/invitations/accept — the invitee accepts */
  router.post('/v1/organisms/:id/invitations/accept', requireAuth(), requireRestScope('organism:write'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    // The organism and the pending invitation: services/organism-read/name-invitations.ts, which
    // aimeat_organism_invitation_respond asks too.
    const inv = await nameInvitationTo(storage, id, { owner: callerGhii });
    if (!inv.ok) {
      if (inv.code === 'NOT_FOUND') res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      else res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have not been invited to this space. Ask somebody who is already in it to invite you.'));
      return;
    }
    const { organism, membership } = inv;
    // The person accepts in person, as on the emailed link (routes/invite-accept.ts) and the MCP tool:
    // an agent, an app grant or an ecosystem token acts in the account's name and is refused here.
    // Checked after the invitation lookup, so a refusal says nothing a 404 would not (feature-list audit #57).
    if (!isOwnerPrincipal(req.auth)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', NAMED_INVITE_ACCEPT_REFUSAL));
      return;
    }
    // Shared accept core: activates the row, syncs members/admins, applies invite-time ws grants.
    const workspaces = await acceptNameInvitation(storage, config, { organism, membership });
    res.json(success(config.nodeId, { status: 'joined', role: membership.role, workspaces }));
  });

  /* POST /v1/organisms/:id/invitations/decline — the invitee declines */
  router.post('/v1/organisms/:id/invitations/decline', requireAuth(), requireRestScope('organism:write'), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    try {
      // Shared with aimeat_organism_invitation_respond (services/invitations.ts).
      await declineNameInvitation(storage, { organismId: id, inviteeOwner: callerGhii });
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
    res.json(success(config.nodeId, { status: 'declined' }));
  });

  /* ── Agent attachment (manage organism.agentGaiis) ──
   * An owner attaches one of their OWN agents to an organism they belong to, so the agent shows
   * as an organism participant and passes the workspace membership gate in its own right. An owner
   * or admin of the organism may also attach an agent of any active member. Where the organism admits
   * only listed agents (agentAccess 'listed'), this list is who gets in, so adding to it is a grant
   * the organism makes: only its owner or an admin, signed in in person, adds an agent. An agent could
   * otherwise list itself and its siblings, and a member could admit their own agent alone. */

  /* POST /v1/organisms/:id/agents — attach an agent GAII (the agent's owner as a member, or an organism owner/admin) */
  // The rules live in services/organism-agents/attach.ts, shared with aimeat_organism_agent_attach and
  // aimeat_organism_agent_detach. `mayActAsPerson` is isOwnerPrincipal: the person signed in, or a
  // session holding account:security.
  router.post('/v1/organisms/:id/agents', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    try {
      const out = await attachOrganismAgent(storage, config, {
        organismId: req.params.id as string, callerOwner: req.auth!.owner as string,
        mayActAsPerson: isOwnerPrincipal(req.auth), agentGaii: (req.body ?? {}).agent_gaii,
      });
      res.status(201).json(success(config.nodeId, out));
    } catch (e) {
      if (!(e instanceof AgentListError)) throw e;
      res.status(e.status).json(error(config.nodeId, e.code, e.message));
    }
  });

  /* DELETE /v1/organisms/:id/agents/:gaii — detach an agent (its owner, or creator/admin) */
  router.delete('/v1/organisms/:id/agents/:gaii', requireAuth(), requireRestScope('organism:invite'), requireRole('agent'), async (req, res) => {
    try {
      const out = await detachOrganismAgent(storage, {
        organismId: req.params.id as string, callerOwner: req.auth!.owner as string,
        agentGaii: decodeURIComponent(req.params.gaii as string),
      });
      res.json(success(config.nodeId, out));
    } catch (e) {
      if (!(e instanceof AgentListError)) throw e;
      res.status(e.status).json(error(config.nodeId, e.code, e.message));
    }
  });
}
