/**
 * @file src/routes/organisms/crud.ts
 * @description Organism CRUD + lifecycle routes: create, list, the "waiting for you" aggregate,
 *   detail, update, delete, join and leave. Extracted from src/routes/organisms.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.5.0 — 2026-08-11 — create/update/join/leave call services/organism-lifecycle.ts, the one copy
 *     of those writes shared with the MCP organism tools (August 2026 MCP audit step 8). The routes
 *     keep their gate and their envelope; the record build, the validation and the side effects moved.
 *   v1.4.0 — 2026-07-23 — buildOrganismList no longer forces perPage=20: a member-scoped list (the owner's own
 *     organisms, e.g. the /tab "mine" list and /waiting) returns ALL matches so old organisms stop dropping into
 *     Discover once the owner belongs to 20+. Discovery (no member filter) still page-caps at the storage default.
 *   v1.3.0 — 2026-07-16 — Add GET /v1/organisms/tab composite (my orgs + counts + public + list-order prefs);
 *     extracted buildOrganismList shared with GET /v1/organisms (redaction chain unchanged, Rule 10 preserved).
 *   v1.2.0 — 2026-07-16 — /waiting batches pending approvals (listPendingApprovalsForOrgs) + ws-name lookups
 *     (workspaceNamesByOrg) across all member orgs, instead of a per-org query loop.
 *   v1.1.0 — 2026-07-16 — ?include=counts uses workspaceCountsByOrg (ONE batched registry read) instead of
 *     a listAllMemory scan per organism.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireRoleOrScope, optionalAuth } from '../../auth/middleware.js';
import { emitChange } from '../../services/event-bus.js';
import { expireOverdueApprovals } from '../../services/gate-expiry.js';
import { canSeeMembers, redactOrganism, rosterCallerFromAuth } from '../../services/organism-privacy.js';
import { getOrganismReadme } from '../../services/organism-readme.js';
import { createOrganismRecord, updateOrganismRecord, joinOrganism, leaveOrganism } from '../../services/organism-lifecycle.js';
import type { OrganismHelpers } from './shared.js';

export function registerOrganismCrudRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { workspaceCountsByOrg, workspaceNamesByOrg } = H;

  /* ── POST /v1/organisms — Create a new organism (agents/owners by role; published apps via the
     organism:write scope, so an app can provision its own structured data space for its owner). ── */
  router.post('/v1/organisms', requireAuth(), requireRoleOrScope('agent', 'organism:write'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const { name, description, type, location, interests, join_policy, max_members, visibility, member_visibility } = req.body ?? {};

    // The record, the board, the creator membership and the feed/timeline side effects live in
    // services/organism-lifecycle.ts, shared with aimeat_organism_create.
    const result = await createOrganismRecord({ storage, config }, ghii, {
      name, description, type, location, interests,
      joinPolicy: join_policy, maxMembers: max_members, visibility, memberVisibility: member_visibility,
    });
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }

    res.status(201).json(success(config.nodeId, { organism: result.organism }, [
      { description: 'View organism', method: 'GET', url: `/v1/organisms/${result.organism.id}` },
      { description: 'List members', method: 'GET', url: `/v1/organisms/${result.organism.id}/members` },
    ]));
  });

  /* ── GET /v1/organisms — List organisms ── */
  // Shared list builder for GET /v1/organisms and the /v1/organisms/tab composite — applies the member
  // privacy rule (a member's private orgs are enumerable only by the member or an operator), the optional
  // ?include=counts workspace count, and the per-organism roster redaction. Semantics identical to the
  // original inline handler (Rule 10 preserved: same selfOrOperator gate + rosterCallerFromAuth +
  // canSeeMembers + redactOrganism).
  async function buildOrganismList(
    auth: Express.Request['auth'],
    params: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; include?: string },
  ): Promise<{ organisms: unknown[]; total: number }> {
    const memberBare = params.member ? (params.member.includes('#') ? params.member.split('#')[1] : params.member).split('@')[0] : undefined;
    const selfOrOperator = !!auth && (auth.owner === memberBare || auth.roles.includes('operator'));
    const organisms = await storage.listOrganisms({
      type: params.type,
      city: params.city,
      interest: params.interest,
      member: memberBare,
      visibility: params.member ? (selfOrOperator ? params.visibility : 'public') : (params.visibility || 'public'),
      // Pass pagination through untouched: a member-scoped list (the owner's own organisms) must return ALL
      // of them — the storage layer only page-caps browse/discovery (no member filter). Forcing perPage here
      // silently dropped the owner's oldest organisms out of "My Organisms" once they belonged to 20+.
      page: params.page,
      perPage: params.perPage,
      // The owner's OWN list includes archived (the client splits them into an "Archived" section);
      // browsing/discovery excludes archived — retired organisms are read-only and not discoverable.
      archived: (params.member && selfOrOperator) ? 'include' : 'exclude',
    });

    // ?include=counts — attach workspace_count per org via ONE batched registry read.
    const include = String(params.include ?? '').split(',').map(s => s.trim());
    let payload: unknown[] = organisms;
    if (include.includes('counts')) {
      const counts = await workspaceCountsByOrg(organisms.map(o => o.id));
      payload = organisms.map(o => ({ ...o, workspace_count: counts.get(o.id) ?? 0 }));
    }

    // Roster privacy: per-organism memberVisibility decides whether THIS caller gets the members[]/
    // agentGaiis fields. member_count is pre-redaction (a count is not an identity). The shared anonymous
    // identity is treated as unauthenticated (rosterCallerFromAuth).
    const listCaller = rosterCallerFromAuth(auth);
    payload = await Promise.all((payload as Array<OrganismRecord & { workspace_count?: number }>).map(async (o) => {
      const canSee = await canSeeMembers(storage, o, listCaller);
      return { ...redactOrganism(o, canSee), member_count: o.members.length, members_hidden: !canSee };
    }));

    return { organisms: payload, total: payload.length };
  }

  router.get('/v1/organisms', optionalAuth(), async (req, res) => {
    const { type, city, interest, visibility, member, page, per_page } = req.query;
    const result = await buildOrganismList(req.auth, {
      type: type as string, city: city as string, interest: interest as string,
      visibility: visibility as string, member: member as string,
      page: page ? Number(page) : undefined, perPage: per_page ? Number(per_page) : undefined,
      include: req.query.include as string,
    });
    res.json(success(config.nodeId, result));
  });

  // GET /v1/organisms/tab — the Organisms tab mount in ONE call: the owner's organisms (with workspace
  // counts) + the public discovery list + the saved list-order prefs. Folds the two GET /v1/organisms
  // reads (member+counts, public) + GET /v1/memory/organisms.ui. Owner. MUST be registered before the
  // /v1/organisms/:id captures (a literal 'tab' would otherwise match :id).
  router.get('/v1/organisms/tab', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const [mine, pub, uiRec] = await Promise.all([
      buildOrganismList(req.auth, { member: owner, include: 'counts' }),
      buildOrganismList(req.auth, { visibility: 'public' }),
      storage.getMemory(ownerGhii, 'organisms.ui'),
    ]);
    res.json(success(config.nodeId, {
      mine: mine.organisms,
      public: pub.organisms,
      uiPrefs: uiRec?.value ?? null,
    }));
  });

  /* ── GET /v1/organisms/waiting — everything across the caller's member organisms that needs their
   * decision, aggregated server-side: pending publish reviews (per workspace), pending join-requests
   * (orgs they manage), and incoming invitations. Replaces the home "Waiting for you" widget's per-org
   * 2–3N fan-out (listApprovals + listJoinRequests + listWorkspaces × O orgs). MUST be registered
   * before GET /:id so ':id' doesn't capture 'waiting'. ── */
  router.get('/v1/organisms/waiting', requireAuth(), requireRole('agent'), async (req, res) => {
    const owner = req.auth!.owner as string;
    await expireOverdueApprovals(storage, new Date().toISOString());
    const orgs = await storage.listOrganisms({ member: owner });
    const reviews: Array<{ kind: 'review'; n: number; orgId: string; orgName: string; wsId: string; wsName: string }> = [];
    const joinRequests: Array<{ kind: 'join'; n: number; orgId: string; orgName: string }> = [];

    // Pending approvals for EVERY member org in one batched read (was listPendingApprovals per org), then
    // the ws-name registry lookup for just the orgs that have approvals in one batched cross-owner read.
    const orgIds = orgs.map(o => o.id);
    const apsByOrg = storage.listPendingApprovalsForOrgs
      ? await storage.listPendingApprovalsForOrgs(orgIds, { status: 'pending' })
      : Object.fromEntries(await Promise.all(orgs.map(async o => [o.id, await storage.listPendingApprovals(o.id, { status: 'pending' })] as const)));
    const namesByOrg = await workspaceNamesByOrg(orgs.filter(o => (apsByOrg[o.id]?.length)).map(o => o.id));
    for (const org of orgs) {
      const aps = apsByOrg[org.id] ?? [];
      if (aps.length) {
        const byWs: Record<string, number> = {};
        for (const a of aps) { const w = (a.arguments as { ws?: string } | undefined)?.ws ?? ''; byWs[w] = (byWs[w] ?? 0) + 1; }
        const names = namesByOrg.get(org.id);
        for (const [wsId, n] of Object.entries(byWs)) reviews.push({ kind: 'review', n, orgId: org.id, orgName: org.name, wsId, wsName: names?.get(wsId) || wsId });
      }
    }
    // Join requests only for orgs the caller manages (creator/admin) — kept per-org (typically few managed).
    const managed = orgs.filter(org => org.creatorGhii === owner || (org.admins ?? []).includes(owner));
    await Promise.all(managed.map(async (org) => {
      const jr = await storage.listJoinRequests(org.id, { status: 'pending' });
      if (jr.length) joinRequests.push({ kind: 'join', n: jr.length, orgId: org.id, orgName: org.name });
    }));
    const invited = (await storage.listMembershipsByGhii(owner)).filter(m => m.status === 'invited');
    const invitations: Array<{ kind: 'invite'; orgName: string; organismId: string }> = [];
    for (const m of invited) {
      const org = await storage.getOrganism(m.organismId);
      if (org) invitations.push({ kind: 'invite', orgName: org.name, organismId: org.id });
    }
    // Flat `items` array in the exact shape the home widget renders (review | join | invite).
    res.json(success(config.nodeId, { items: [...reviews, ...joinRequests, ...invitations] }));
  });

  /* ── GET /v1/organisms/:id — Get organism detail ── */
  router.get('/v1/organisms/:id', optionalAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Check visibility
    if (organism.visibility === 'private') {
      const ghii = req.auth?.owner;
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
      const membership = await storage.getMembership(id, ghii);
      if (!membership || membership.status !== 'active') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
        return;
      }
    }

    const members = await storage.listMembers(id, { status: 'active' });
    const readme = await getOrganismReadme(storage, id);

    // Roster privacy (memberVisibility): redact members[]/agentGaiis for callers below the tier.
    // your_membership keeps "am I a member / what's my role" answerable for the SPA even when the
    // roster arrays are hidden; member_count stays (a count is not an identity). The shared
    // anonymous identity is treated as unauthenticated (rosterCallerFromAuth).
    const detailCaller = rosterCallerFromAuth(req.auth);
    const canSeeRoster = await canSeeMembers(storage, organism, detailCaller);
    const yourMembership = detailCaller.ownerName ? await storage.getMembership(id, detailCaller.ownerName) : null;

    res.json(success(config.nodeId, {
      organism: redactOrganism(organism, canSeeRoster),
      member_count: members.length,
      readme,
      members_hidden: !canSeeRoster,
      your_membership: yourMembership ? { role: yourMembership.role, status: yourMembership.status } : null,
    }));
  });

  /* ── PUT /v1/organisms/:id — Update organism ── */
  router.put('/v1/organisms/:id', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Only creator or admin can update
    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only creator or admin can update'));
      return;
    }

    const { name, description, type, location, interests, join_policy, max_members, visibility, readme, member_visibility } = req.body ?? {};

    // Field validation, the update itself and the README memory key live in
    // services/organism-lifecycle.ts, shared with aimeat_organism_update.
    const result = await updateOrganismRecord({ storage, config }, organism, {
      name, description, type, location, interests, readme,
      joinPolicy: join_policy, maxMembers: max_members, visibility, memberVisibility: member_visibility,
    });
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    res.json(success(config.nodeId, { organism: result.organism, readme: result.readme }));
  });

  /* ── DELETE /v1/organisms/:id — Delete organism ── */
  router.delete('/v1/organisms/:id', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can delete'));
      return;
    }

    await storage.deleteOrganism(id);
    res.json(success(config.nodeId, { deleted: true }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/join — Join an organism ── */
  router.post('/v1/organisms/:id/join', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { message } = req.body ?? {};

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership checks, capacity, the policy branch and the approver notifications live in
    // services/organism-lifecycle.ts, shared with aimeat_organism_join.
    const result = await joinOrganism({ storage, config }, organism, ghii, message);
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    if (result.outcome === 'joined') {
      res.status(201).json(success(config.nodeId, { membership: result.membership, status: 'joined' }));
      return;
    }
    res.status(202).json(success(config.nodeId, { join_request: result.joinRequest, status: 'pending' }));
  });

  /* ── POST /v1/organisms/:id/leave — Leave an organism ── */
  router.post('/v1/organisms/:id/leave', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership removal + the roster/admin sync live in services/organism-lifecycle.ts, shared
    // with aimeat_organism_leave.
    const result = await leaveOrganism({ storage, config }, organism, ghii);
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    res.json(success(config.nodeId, { left: true }));
  });
}
