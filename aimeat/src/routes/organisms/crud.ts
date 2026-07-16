/**
 * @file src/routes/organisms/crud.ts
 * @description Organism CRUD + lifecycle routes: create, list, the "waiting for you" aggregate,
 *   detail, update, delete, join and leave. Extracted from src/routes/organisms.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-07-16 — /waiting batches pending approvals (listPendingApprovalsForOrgs) + ws-name lookups
 *     (workspaceNamesByOrg) across all member orgs, instead of a per-org query loop.
 *   v1.1.0 — 2026-07-16 — ?include=counts uses workspaceCountsByOrg (ONE batched registry read) instead of
 *     a listAllMemory scan per organism.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireRoleOrScope, optionalAuth } from '../../auth/middleware.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { expireOverdueApprovals } from '../../services/gate-expiry.js';
import { notify } from '../../services/notify.js';
import { canSeeMembers, redactOrganism, rosterCallerFromAuth, MEMBER_VISIBILITY_VALUES } from '../../services/organism-privacy.js';
import { getOrganismReadme, setOrganismReadme } from '../../services/organism-readme.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';
import type { OrganismHelpers } from './shared.js';

export function registerOrganismCrudRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { workspaceCountsByOrg, workspaceNamesByOrg } = H;

  /* ── POST /v1/organisms — Create a new organism (agents/owners by role; published apps via the
     organism:write scope, so an app can provision its own structured data space for its owner). ── */
  router.post('/v1/organisms', requireAuth(), requireRoleOrScope('agent', 'organism:write'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const { name, description, type, location, interests, join_policy, max_members, visibility, member_visibility } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name is required (min 2 characters)'));
      return;
    }

    const validTypes = ['community', 'team', 'club', 'cooperative', 'project'];
    const orgType = validTypes.includes(type) ? type : 'community';
    const policy = ['open', 'approval_required', 'invite_only'].includes(join_policy) ? join_policy : 'open';
    const vis = ['public', 'listed', 'private'].includes(visibility) ? visibility : 'public';
    // Roster privacy tier; unset = 'authenticated' (see services/organism-privacy.ts).
    const memberVis = MEMBER_VISIBILITY_VALUES.includes(member_visibility) ? member_visibility : undefined;

    const id = uuidv4();
    const now = new Date().toISOString();
    const boardId = `org-${id}`;

    // Create the organism's discussion board
    await storage.createBoard({
      id: boardId,
      name: `${name.trim()} — Discussion`,
      description: `Discussion board for ${name.trim()}`,
      visibility: vis === 'public' ? 'public' : 'shared',
      ownerGaii: resolveIdentity(req.auth!, config.nodeId),
      allowedGaiis: [],
      createdAt: now,
    });

    const record = await storage.createOrganism({
      id,
      name: name.trim(),
      description: description || '',
      type: orgType,
      location: location || {},
      interests: Array.isArray(interests) ? interests : [],
      creatorGhii: ghii,
      admins: [ghii],
      members: [ghii],
      agentGaiis: [],
      boardId,
      joinPolicy: policy,
      maxMembers: max_members || 500,
      visibility: vis,
      memberVisibility: memberVis,
      moderationConfig: {
        flagsEnabled: true,
        autoHideThreshold: 3,
        appealsEnabled: true,
      },
      memoryNamespace: `organism.${id}`,
      createdAt: now,
      updatedAt: now,
    });

    // Create creator membership
    await storage.createMembership({
      id: uuidv4(),
      organismId: id,
      ghii,
      role: 'creator',
      status: 'active',
      joinedAt: now,
    });

    res.status(201).json(success(config.nodeId, { organism: record }, [
      { description: 'View organism', method: 'GET', url: `/v1/organisms/${id}` },
      { description: 'List members', method: 'GET', url: `/v1/organisms/${id}/members` },
    ]));
    emitChange('organisms');
    void updateOrganismStructure(storage, config, id, { event: 'organism created', actor: ghii }).catch(() => { /* timeline best-effort */ });
    // Public landing feed — only public organisms are discoverable, so only they announce.
    if (vis === 'public') {
      void recordPublicActivity(storage, config, {
        category: 'organisms',
        actor: ghii,
        summary: `Organism "${name.trim()}" created`,
        detail: description || '',
        link: `/v1/organisms/${id}`,
      }).catch(() => { /* feed is best-effort */ });
    }
  });

  /* ── GET /v1/organisms — List organisms ── */
  router.get('/v1/organisms', optionalAuth(), async (req, res) => {
    const { type, city, interest, visibility, member, page, per_page } = req.query;
    // ?member=<owner> lists that owner's organisms INCLUDING private ones — which must only be
    // enumerable by the member themself (their agents share the bare owner name) or an operator.
    // Anyone else asking about someone's memberships degrades to public-only instead of leaking
    // private organisms. Memberships are keyed by the BARE owner name, so normalize GHII/GAII.
    const memberBare = member ? ((member as string).includes('#') ? (member as string).split('#')[1] : (member as string)).split('@')[0] : undefined;
    const selfOrOperator = !!req.auth && (req.auth.owner === memberBare || req.auth.roles.includes('operator'));
    const organisms = await storage.listOrganisms({
      type: type as string,
      city: city as string,
      interest: interest as string,
      member: memberBare,
      visibility: member ? (selfOrOperator ? (visibility as string) : 'public') : ((visibility as string) || 'public'),
      page: page ? Number(page) : 1,
      perPage: per_page ? Number(per_page) : 20,
      // The owner's OWN list includes archived (the client splits them into an "Archived" section);
      // browsing/discovery (anyone else, or no member filter) excludes archived — retired organisms
      // are read-only and not discoverable.
      archived: (member && selfOrOperator) ? 'include' : 'exclude',
    });

    // ?include=counts — attach workspace_count per org (distinct ids in the registry across all
    // members' registry records), so the list view doesn't fan out one discoverWorkspaces per org.
    const include = String(req.query.include ?? '').split(',').map(s => s.trim());
    let payload: unknown[] = organisms;
    if (include.includes('counts')) {
      // ONE cross-owner key-IN read of every org's registry record → distinct workspace count per org,
      // instead of a listAllMemory scan per organism.
      const counts = await workspaceCountsByOrg(organisms.map(o => o.id));
      payload = organisms.map(o => ({ ...o, workspace_count: counts.get(o.id) ?? 0 }));
    }

    // Roster privacy: per-organism memberVisibility decides whether THIS caller gets the
    // members[]/agentGaiis fields. member_count is computed pre-redaction (a count is not an
    // identity) so list cards keep working when the roster itself is hidden. The shared anonymous
    // identity is treated as unauthenticated (rosterCallerFromAuth).
    const listCaller = rosterCallerFromAuth(req.auth);
    payload = await Promise.all((payload as Array<OrganismRecord & { workspace_count?: number }>).map(async (o) => {
      const canSee = await canSeeMembers(storage, o, listCaller);
      return { ...redactOrganism(o, canSee), member_count: o.members.length, members_hidden: !canSee };
    }));

    res.json(success(config.nodeId, {
      organisms: payload,
      total: payload.length,
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
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) updates.type = type;
    if (location !== undefined) updates.location = location;
    if (interests !== undefined) updates.interests = interests;
    if (member_visibility !== undefined) {
      if (!MEMBER_VISIBILITY_VALUES.includes(member_visibility)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `member_visibility must be one of: ${MEMBER_VISIBILITY_VALUES.join(', ')}`));
        return;
      }
      updates.memberVisibility = member_visibility;
    }
    if (join_policy !== undefined) updates.joinPolicy = join_policy;
    if (max_members !== undefined) updates.maxMembers = max_members;
    if (visibility !== undefined) updates.visibility = visibility;

    // README is a free-form markdown body stored as a creator-owned memory key (not an OrganismRecord
    // column) — written separately. Owned by the organism's creator so it stays stable across admins.
    if (typeof readme === 'string') await setOrganismReadme(storage, config, id, readme, organism.creatorGhii);

    const updated = await storage.updateOrganism(id, updates);
    const readmeOut = await getOrganismReadme(storage, id);
    res.json(success(config.nodeId, { organism: updated, readme: readmeOut }));
    emitChange('organisms');
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

    // Check if already a member
    const existing = await storage.getMembership(id, ghii);
    if (existing && existing.status === 'banned') {
      res.status(403).json(error(config.nodeId, 'BANNED', 'You have been blocked from this organism'));
      return;
    }
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER', 'You are already a member'));
      return;
    }
    if (existing && existing.status === 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PENDING', 'You already have a pending join request'));
      return;
    }
    if (existing && existing.status === 'invited') {
      res.status(409).json(error(config.nodeId, 'ALREADY_INVITED', 'You have a pending invitation — accept it instead of requesting to join'));
      return;
    }

    // Check capacity
    const members = await storage.listMembers(id, { status: 'active' });
    if (members.length >= organism.maxMembers) {
      res.status(409).json(error(config.nodeId, 'CAPACITY_FULL', 'Organism has reached maximum members'));
      return;
    }

    const now = new Date().toISOString();

    if (organism.joinPolicy === 'open') {
      // Direct join
      const membership = await storage.createMembership({
        id: uuidv4(),
        organismId: id,
        ghii,
        role: 'member',
        status: 'active',
        joinedAt: now,
      });

      // Update organism members list
      await storage.updateOrganism(id, {
        members: [...organism.members, ghii],
        updatedAt: now,
      });

      res.status(201).json(success(config.nodeId, { membership, status: 'joined' }));
      emitChange('organisms');
    } else if (organism.joinPolicy === 'approval_required') {
      // Create join request
      const request = await storage.createJoinRequest({
        id: uuidv4(),
        organismId: id,
        ghii,
        message: message || undefined,
        status: 'pending',
        createdAt: now,
      });

      // Notify the creator + admins so the request doesn't go unnoticed (mirrors the
      // workspace-access request path). admins includes the creator, so dedupe.
      const approvers = [...new Set([organism.creatorGhii, ...organism.admins])];
      for (const approver of approvers) {
        await notify(storage, `${approver}@${config.nodeId}`, {
          type: 'organism_join_request',
          title: `${ghii} requested to join "${organism.name}"`,
          body: typeof message === 'string' ? message : '',
          link: '/v1/profile#organisms',
        });
      }
      emitChange('notifications');

      res.status(202).json(success(config.nodeId, { join_request: request, status: 'pending' }));
      emitChange('organisms');
    } else {
      // invite_only
      res.status(403).json(error(config.nodeId, 'INVITE_ONLY', 'This organism requires an invitation to join'));
    }
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

    if (organism.creatorGhii === ghii) {
      res.status(400).json(error(config.nodeId, 'CREATOR_CANNOT_LEAVE', 'Creator cannot leave. Delete the organism instead.'));
      return;
    }

    const membership = await storage.getMembership(id, ghii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member'));
      return;
    }

    await storage.deleteMembership(membership.id);

    // Update organism members + admins lists
    const updates: Record<string, unknown> = {
      members: organism.members.filter(m => m !== ghii),
      updatedAt: new Date().toISOString(),
    };
    if (organism.admins.includes(ghii)) {
      updates.admins = organism.admins.filter(a => a !== ghii);
    }
    await storage.updateOrganism(id, updates);

    res.json(success(config.nodeId, { left: true }));
    emitChange('organisms');
  });
}
