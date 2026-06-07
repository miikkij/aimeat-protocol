/**
 * @file organisms.ts
 * @description Generic organism (group/team/club/cooperative/project) routes: CRUD, join/leave,
 *   membership + admin management, join-request review, and the manifest-driven workspace read.
 *   An organism is the one container; a "project" is just `type:'project'` + a `meta.manifest`.
 *   The backend stays protocol-only — object records are read/written via the generic memory API;
 *   this router adds no per-object-type endpoints.
 * @structure
 *   - organismsRouter(config, storage) — POST/GET/PUT/DELETE /v1/organisms (+ :id sub-resources)
 *   - GET /v1/organisms/:id/workspace — manifest-driven, membership-gated workspace aggregation
 * @usage app.use(organismsRouter(config, storage));
 * @version-history
 *   v1.1.0 -- 2026-06-07 -- Phase 3: add the generic GET /:id/workspace read.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { authorizeRead } from '../services/access-guard.js';

export function organismsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── POST /v1/organisms — Create a new organism ── */
  router.post('/v1/organisms', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const { name, description, type, location, interests, join_policy, max_members, visibility } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name is required (min 2 characters)'));
      return;
    }

    const validTypes = ['community', 'team', 'club', 'cooperative', 'project'];
    const orgType = validTypes.includes(type) ? type : 'community';
    const policy = ['open', 'approval_required', 'invite_only'].includes(join_policy) ? join_policy : 'open';
    const vis = ['public', 'listed', 'private'].includes(visibility) ? visibility : 'public';

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
  });

  /* ── GET /v1/organisms — List organisms ── */
  router.get('/v1/organisms', async (req, res) => {
    const { type, city, interest, visibility, member, page, per_page } = req.query;
    const organisms = await storage.listOrganisms({
      type: type as string,
      city: city as string,
      interest: interest as string,
      member: member as string,
      visibility: member ? (visibility as string) : ((visibility as string) || 'public'),
      page: page ? Number(page) : 1,
      perPage: per_page ? Number(per_page) : 20,
    });

    res.json(success(config.nodeId, {
      organisms,
      total: organisms.length,
    }));
  });

  /* ── GET /v1/organisms/:id — Get organism detail ── */
  router.get('/v1/organisms/:id', async (req, res) => {
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

    res.json(success(config.nodeId, {
      organism,
      member_count: members.length,
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

    const { name, description, type, location, interests, join_policy, max_members, visibility } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) updates.type = type;
    if (location !== undefined) updates.location = location;
    if (interests !== undefined) updates.interests = interests;
    if (join_policy !== undefined) updates.joinPolicy = join_policy;
    if (max_members !== undefined) updates.maxMembers = max_members;
    if (visibility !== undefined) updates.visibility = visibility;

    const updated = await storage.updateOrganism(id, updates);
    res.json(success(config.nodeId, { organism: updated }));
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
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER', 'You are already a member'));
      return;
    }
    if (existing && existing.status === 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PENDING', 'You already have a pending join request'));
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

  /* ── GET /v1/organisms/:id/members — List members ── */
  router.get('/v1/organisms/:id/members', async (req, res) => {
    const id = req.params.id as string;
    const { role, status } = req.query;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const members = await storage.listMembers(id, {
      role: role as string,
      status: (status as string) || 'active',
    });

    res.json(success(config.nodeId, { members, total: members.length }));
  });

  /* ── GET /v1/organisms/:id/join-requests — List pending join requests ── */
  router.get('/v1/organisms/:id/join-requests', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { status } = req.query;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can view join requests'));
      return;
    }

    const requests = await storage.listJoinRequests(id, { status: (status as string) || 'pending' });
    res.json(success(config.nodeId, { join_requests: requests, total: requests.length }));
  });

  /* ── POST /v1/organisms/:id/join-requests/:requestId/review — Approve/reject ── */
  router.post('/v1/organisms/:id/join-requests/:requestId/review', requireAuth(), requireRole('agent'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    const { decision } = req.body ?? {};

    if (!['approved', 'rejected'].includes(decision)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Decision must be "approved" or "rejected"'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only admins can review join requests'));
      return;
    }

    const request = await storage.getJoinRequest(requestId);
    if (!request || request.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Join request not found'));
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_REVIEWED', 'This request has already been reviewed'));
      return;
    }

    const now = new Date().toISOString();
    await storage.updateJoinRequest(requestId, {
      status: decision,
      reviewedBy: ghii,
      reviewedAt: now,
    });

    if (decision === 'approved') {
      await storage.createMembership({
        id: uuidv4(),
        organismId: id,
        ghii: request.ghii,
        role: 'member',
        status: 'active',
        joinedAt: now,
      });
      await storage.updateOrganism(id, {
        members: [...organism.members, request.ghii],
        updatedAt: now,
      });
    }

    res.json(success(config.nodeId, { decision, request_id: requestId }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/admins — Add an admin ── */
  router.post('/v1/organisms/:id/admins', requireAuth(), requireRole('agent'), async (req, res) => {
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

    if (organism.creatorGhii !== ghii && !organism.admins.includes(ghii)) {
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
  router.delete('/v1/organisms/:id/admins/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = req.params.ghii as string;

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    if (organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can demote admins'));
      return;
    }

    if (targetGhii === organism.creatorGhii) {
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

  /* ── GET /v1/organisms/:id/workspace — Manifest-driven workspace read ──
   *
   * Generic over ANY manifest: reads `organism.{id}.meta.manifest`, then for each
   * memory-backed `objectTypes[]` it declares, returns the records under that namespace.
   * Works identically for a `kind:'project'` or a `kind:'research-study'` / Finnish
   * `kind:'tutkimus'` manifest — the core enumerates whatever the manifest declares,
   * never a hardcoded type list.
   *
   * Access: the caller must be an active member (or an organism agent) — non-members 403.
   * Each non-owned record is then gated through the shared `authorizeRead` guard, so a
   * member only sees records their consent/visibility allows (own records pass directly).
   */
  router.get('/v1/organisms/:id/workspace', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership gate — an organism agent, or an active member. Memberships are keyed by the
    // BARE owner name (matches organisms.ts join/leave + consent.ts organism resolution).
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) {
      const membership = await storage.getMembership(id, ownerName);
      isMember = !!membership && membership.status === 'active';
    }
    if (!isMember) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const nsRoot = `organism.${id}.`;

    // Enumerate the whole workspace by key prefix across all member identities, then
    // access-filter: own records pass directly; others go through the shared read guard.
    const { items } = await storage.listAllMemory({ prefix: nsRoot, limit: 5000 });
    const readable: MemoryRecord[] = [];
    for (const rec of items) {
      if (rec.ownerGaii === callerGaii) { readable.push(rec); continue; }
      const decision = await authorizeRead(storage, config, {
        ownerGaii: rec.ownerGaii,
        accessorGaii: callerGaii,
        resourceKey: rec.key,
        visibility: rec.visibility,
        groupId: rec.groupId,
        action: 'read',
      });
      if (decision.allowed) readable.push(rec);
    }
    const byKey = new Map(readable.map(r => [r.key, r]));

    const manifestRec = byKey.get(`${nsRoot}meta.manifest`);
    const manifest = (manifestRec?.value as Record<string, unknown> | undefined) ?? null;
    const readme = byKey.get(`${nsRoot}meta.readme`)?.value ?? null;

    // Build the generic objects map from whatever objectTypes the manifest declares.
    const objectTypes = (manifest?.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const memoryBackings = new Set(['memory', 'knowledge', 'storage']);
    const objects: Record<string, unknown[]> = {};
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || !memoryBackings.has(ot.backing as string)) continue;
      const nsPrefix = `${nsRoot}${namespace}.`;
      objects[name] = readable.filter(r => r.key.startsWith(nsPrefix)).map(r => r.value);
    }

    // Convenience aliases — generic, empty when the manifest declares no such type.
    const appendType = objectTypes.find(ot => ot.append === true);
    const decisions = appendType ? (objects[appendType.name as string] ?? []) : [];
    const resourceType = objectTypes.find(ot =>
      ot.name === 'resource' || (typeof ot.namespace === 'string' && ot.namespace.endsWith('resources')));
    const resources = resourceType ? (objects[resourceType.name as string] ?? []) : [];

    // todos — tasks linked to this organism by the memoryPrefix convention (no native
    // organismId on tasks). Best-effort: empty if none match.
    let todos: unknown[] = [];
    try {
      const { tasks } = await storage.listAgentTasksByOwner(callerGaii, { perPage: 200 });
      todos = tasks
        .filter(t => (t.resources?.memoryPrefixes ?? []).some(p => p.startsWith(`organism.${id}`)))
        .map(t => ({ id: t.id, title: t.title, status: t.status, todos: t.todos }));
    } catch {
      /* best-effort: leave todos empty if the task store is unavailable */
    }

    res.json(success(config.nodeId, { manifest, readme, objects, decisions, resources, todos }, [
      { description: 'Read the manifest directly', method: 'GET', url: `/v1/memory/${encodeURIComponent(`${nsRoot}meta.manifest`)}` },
      { description: 'Write a workspace record', method: 'POST', url: '/v1/memory' },
    ]));
  });

  return router;
}
