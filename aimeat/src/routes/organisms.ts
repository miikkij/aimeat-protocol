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
 *   v1.2.0 -- 2026-06-07 -- Phase 4: gate primitive (approvals) + draft/publish/versioning + publish-gate.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, PendingApprovalRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { authorizeRead } from '../services/access-guard.js';
import { shouldGate, gatePolicyFromManifest, type Risk } from '../services/gate-policy.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { expireOverdueApprovals, isOverdue } from '../services/gate-expiry.js';

/** Whether a membership role satisfies an approval's required approverRole. */
function roleSatisfies(approverRole: string, membershipRole: string): boolean {
  if (approverRole === 'member') return true;                                  // any active member
  if (approverRole === 'admin') return membershipRole === 'creator' || membershipRole === 'admin';
  if (approverRole === 'owner') return membershipRole === 'creator';           // the organism owner
  return false;
}

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
    // Versioning convention: each instance is one key, optionally suffixed `.draft` (working
    // copy), `.latest` (published), or `.version.N` (history). The current value is `.latest`
    // (falling back to a bare unsuffixed write); drafts are surfaced separately; versions are
    // history (hidden here — list `…{instance}.version.*` via the memory API to read them).
    const objectTypes = (manifest?.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const memoryBackings = new Set(['memory', 'knowledge', 'storage']);
    const objects: Record<string, unknown[]> = {};
    const drafts: Record<string, unknown[]> = {};
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || !memoryBackings.has(ot.backing as string)) continue;
      const nsPrefix = `${nsRoot}${namespace}.`;
      const instances = new Map<string, { bare?: unknown; latest?: unknown; draft?: unknown }>();
      for (const r of readable) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const instanceId = parts[0];
        const role = parts.slice(1).join('.');
        const slot = instances.get(instanceId) ?? {};
        if (role === '') slot.bare = r.value;
        else if (role === 'draft') slot.draft = r.value;
        else if (role === 'latest') slot.latest = r.value;
        // role startsWith 'version.' → history, skip
        instances.set(instanceId, slot);
      }
      const current: unknown[] = [];
      const draftList: unknown[] = [];
      for (const slot of instances.values()) {
        const c = slot.latest ?? slot.bare;
        if (c !== undefined) current.push(c);
        if (slot.draft !== undefined) draftList.push(slot.draft);
      }
      objects[name] = current;
      if (draftList.length) drafts[name] = draftList;
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

    res.json(success(config.nodeId, { manifest, readme, objects, drafts, decisions, resources, todos }, [
      { description: 'Read the manifest directly', method: 'GET', url: `/v1/memory/${encodeURIComponent(`${nsRoot}meta.manifest`)}` },
      { description: 'Write a draft record', method: 'POST', url: '/v1/memory' },
      { description: 'Publish a draft', method: 'POST', url: `/v1/organisms/${id}/publish` },
    ]));
  });

  /* ── Gate primitive (Phase 4) — PendingApproval ──
   *
   * Generic over any organism/manifest. The gate ENGINE is here; the gate CONDITIONS are data
   * (the manifest's policy.agentAutonomy / policy.alwaysGate, via gate-policy.ts). Creating an
   * approval evaluates that policy: a consequential action pauses as `pending`; everything else
   * auto-runs (audited as a decision). Resolution is human-only (a pending approval, by
   * definition, escaped auto-run) and role-gated by the approval's approverRole.
   */

  // Active membership keyed by bare owner name (or org agent) — returns { role } or null.
  const memberRole = async (req: Express.Request, organism: { agentGaiis: string[] }, id: string): Promise<string | null> => {
    if (req.auth!.sub && organism.agentGaiis.includes(req.auth!.sub)) return 'member';
    const ownerName = req.auth!.owner;
    if (!ownerName) return null;
    const m = await storage.getMembership(id, ownerName);
    return m && m.status === 'active' ? m.role : null;
  };

  // Read the organism's manifest value (for gate policy).
  const readManifest = async (id: string): Promise<unknown> => {
    const key = `organism.${id}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return items.find(r => r.key === key)?.value ?? null;
  };

  // Append a signed-by-convention decision-log entry (the audit/Prove trail).
  const writeDecision = async (organismId: string, by: string, summary: string, refs: string[]): Promise<void> => {
    const did = uuidv4();
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `organism.${organismId}.meta.decisions.${did}`,
      ownerGaii: by,
      value: { ts: now, kind: 'decision', by, summary, refs },
      visibility: 'private', tags: ['gate'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
  };

  // Read the organism's runtime config entry (organism.{id}.meta.config) — UI-editable; absent = defaults.
  const readConfig = async (organismId: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${organismId}.meta.config`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  // meta.* writes require admin/creator; shared.* (and others) need only membership.
  const canWriteNamespace = (role: string, namespace: string): boolean =>
    namespace.startsWith('meta.') ? (role === 'creator' || role === 'admin') : true;

  // Publish a draft: snapshot organism.{id}.{ns}.{instance}.draft → a new .version.N and .latest.
  // Schema-validated (the draft must be a valid object). Returns the new version number.
  const publishDraft = async (
    organismId: string, namespace: string, instance: string, publisher: string,
  ): Promise<{ ok: true; version: number } | { ok: false; code: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> => {
    const base = `organism.${organismId}.${namespace}.${instance}`;
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
    const draft = items.find(r => r.key === `${base}.draft`);
    if (!draft) return { ok: false, code: 'NO_DRAFT' };

    const validation = await validateMemoryWrite(`${base}.latest`, draft.value, storage);
    if (!validation.valid) return { ok: false, code: 'INVALID', violations: validation.errors };

    let maxN = 0;
    const vPrefix = `${base}.version.`;
    for (const r of items) {
      if (r.key.startsWith(vPrefix)) {
        const suffix = r.key.slice(vPrefix.length);
        if (/^\d+$/.test(suffix)) maxN = Math.max(maxN, parseInt(suffix, 10));
      }
    }
    const n = maxN + 1;
    const now = new Date().toISOString();
    const vis = draft.visibility;
    const tags = draft.tags ?? [];

    await storage.setMemory({
      key: `${base}.version.${n}`, ownerGaii: publisher, value: draft.value,
      visibility: vis, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    const existingLatest = items.find(r => r.key === `${base}.latest`);
    await storage.setMemory({
      key: `${base}.latest`, ownerGaii: publisher, value: draft.value,
      visibility: vis, tags, ttlHours: null,
      version: (existingLatest?.version ?? 0) + 1,
      createdAt: existingLatest?.createdAt ?? now, updatedAt: now,
    });
    return { ok: true, version: n };
  };

  // POST /v1/organisms/:id/approvals — request approval for an action (gate or auto-run).
  router.post('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    // `arguments` is reserved in ESM strict mode — destructure it under a new name.
    const { action, arguments: actionArgs, risk, rule, stageId, flowGateId, approverRole, prompt, deadline } = req.body ?? {};
    if (!action || typeof action !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action is required'));
      return;
    }
    const riskVal: Risk = ['low', 'medium', 'high'].includes(risk) ? risk : 'medium';
    const approverRoleVal = ['owner', 'admin', 'member'].includes(approverRole) ? approverRole : 'owner';

    const policy = gatePolicyFromManifest(await readManifest(id));
    const decision = shouldGate({ action, risk: riskVal, rule, policy });

    const actor = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();
    const aid = uuidv4();
    const record: PendingApprovalRecord = {
      id: aid, organismId: id, actor, action,
      ...(actionArgs !== undefined ? { arguments: actionArgs } : {}),
      risk: riskVal, approverRole: approverRoleVal as PendingApprovalRecord['approverRole'],
      ...(typeof prompt === 'string' ? { prompt } : {}),
      ...(typeof stageId === 'string' ? { stageId } : {}),
      ...(typeof flowGateId === 'string' ? { flowGateId } : {}),
      ...(typeof deadline === 'string' ? { deadline } : {}),
      status: decision.gate ? 'pending' : 'approved',
      ...(decision.gate ? {} : { decidedBy: 'system', decidedAt: now, resolutionNote: `auto: ${decision.reason}` }),
      createdAt: now, updatedAt: now,
    };
    await storage.createPendingApproval(record);
    if (!decision.gate) {
      await writeDecision(id, actor, `auto-approved action: ${action}`, [aid]);
    }

    res.status(201).json(success(config.nodeId, { approval: record, gated: decision.gate, reason: decision.reason }, [
      { description: 'List pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
      ...(decision.gate ? [{ description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` }] : []),
    ]));
    emitChange('organisms');
  });

  // GET /v1/organisms/:id/approvals — the approval inbox (members).
  router.get('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    // Durable pause: lazily abort any overdue pending approvals before listing.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const status = req.query.status as string | undefined;
    const approvals = await storage.listPendingApprovals(id, status ? { status } : undefined);
    res.json(success(config.nodeId, { approvals, total: approvals.length }));
  });

  // POST /v1/organisms/:id/publish — snapshot a draft into a new version + latest (or gate it).
  router.post('/v1/organisms/:id/publish', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const role = await memberRole(req, organism, id);
    if (!role) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    const { namespace, id: instance } = req.body ?? {};
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin/creator role required to publish in a meta.* namespace'));
      return;
    }

    const publisher = resolveIdentity(req.auth!, config.nodeId);

    // Config decides whether publishing needs a review gate. Absent / disabled = publish now.
    const cfg = await readConfig(id);
    const pg = (cfg?.gates as Record<string, { enabled?: boolean; approverRole?: string }> | undefined)?.publish;
    if (pg?.enabled === true) {
      const approverRole = ['owner', 'admin', 'member'].includes(pg.approverRole as string) ? pg.approverRole! : 'owner';
      const now = new Date().toISOString();
      const aid = uuidv4();
      const record: PendingApprovalRecord = {
        id: aid, organismId: id, actor: publisher, action: 'publish',
        arguments: { namespace, instance }, risk: 'medium',
        approverRole: approverRole as PendingApprovalRecord['approverRole'],
        prompt: `Publish ${namespace}.${instance}?`, status: 'pending', createdAt: now, updatedAt: now,
      };
      await storage.createPendingApproval(record);
      res.status(202).json(success(config.nodeId, { gated: true, approval: record }, [
        { description: 'Review pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
        { description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` },
      ]));
      emitChange('organisms');
      return;
    }

    const result = await publishDraft(id, namespace, instance, publisher);
    if (!result.ok) {
      if (result.code === 'NO_DRAFT') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${namespace}.${instance}`));
      } else {
        res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: result.violations }));
      }
      return;
    }
    await writeDecision(id, publisher, `published ${namespace}.${instance} v${result.version}`, [`${namespace}.${instance}`]);
    res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'List version history', method: 'GET', url: `/v1/memory?prefix=${encodeURIComponent(`organism.${id}.${namespace}.${instance}.version.`)}` },
    ]));
    emitChange('organisms');
  });

  // POST /v1/organisms/:id/approvals/:aid — resolve (approve | reject | edit). Human-only, role-gated.
  router.post('/v1/organisms/:id/approvals/:aid', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const aid = req.params.aid as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    // Durable pause: abort overdue approvals first, so a resolve of an expired one 409s below.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const approval = await storage.getPendingApproval(aid);
    if (!approval || approval.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Approval not found'));
      return;
    }
    if (approval.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_RESOLVED', `Approval already ${approval.status}`));
      return;
    }

    // Approver must be an active member whose role satisfies the approval's approverRole.
    const role = await memberRole(req, organism, id);
    if (!role || !roleSatisfies(approval.approverRole, role)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', `Resolving this approval requires role "${approval.approverRole}"`));
      return;
    }

    const { decision: d, note, editedArguments } = req.body ?? {};
    if (!['approve', 'reject', 'edit'].includes(d)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'decision must be "approve", "reject", or "edit"'));
      return;
    }

    const decider = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();

    // A publish gate executes the publish on approve/edit BEFORE the decision is recorded, so a
    // failed publish (no draft / invalid) leaves the approval pending rather than falsely approved.
    if (approval.action === 'publish' && d !== 'reject') {
      const pargs = approval.arguments as Record<string, unknown> | undefined;
      const ns = typeof pargs?.namespace === 'string' ? pargs.namespace : undefined;
      const inst = typeof pargs?.instance === 'string' ? pargs.instance : undefined;
      if (ns && inst) {
        const pub = await publishDraft(id, ns, inst, decider);
        if (!pub.ok) {
          if (pub.code === 'NO_DRAFT') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${ns}.${inst}`));
          } else {
            res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: pub.violations }));
          }
          return;
        }
      }
    }

    const newStatus: PendingApprovalRecord['status'] = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited';
    const updates: Partial<PendingApprovalRecord> = { status: newStatus, decidedBy: decider, decidedAt: now, updatedAt: now };
    if (typeof note === 'string') updates.resolutionNote = note;
    if (d === 'edit' && editedArguments !== undefined) updates.arguments = editedArguments;

    const updated = await storage.updatePendingApproval(aid, updates);
    const verb = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited & approved';
    await writeDecision(id, decider, `${verb} gate: ${approval.action}`, [aid]);

    res.json(success(config.nodeId, { approval: updated, decision: d }, [
      { description: 'View the decision log', method: 'GET', url: `/v1/organisms/${id}/workspace` },
    ]));
    emitChange('organisms');
  });

  return router;
}
