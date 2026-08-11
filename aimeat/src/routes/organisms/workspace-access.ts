/**
 * @file src/routes/organisms/workspace-access.ts
 * @description Workspace discovery + per-workspace access control (request/list/decision/grant/revoke),
 *   email invitations, provisioned-code ("key") invitations, and the PUBLIC invitation token flow.
 *   Extracted from src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 *   v1.1.0 — 2026-07-15 — Discovery list marks a workspace 'granted' for org managers (creator/admin),
 *     matching their automatic read access (isOrgManager).
 *   v1.2.0 — 2026-07-16 — Discovery access-probe batches every workspace-manifest read into ONE cross-owner
 *     key-IN query (readWsManifests + canReadWsManifest) instead of one canReadWs scan per workspace (N×M).
 *   v1.3.0 — 2026-07-16 — ?all=1 rosters ALL workspaces for an org creator/admin (was caller-owned only);
 *     PATCH email invitation (edit pending orgRole/workspaces); grant-apply loops moved to the shared
 *     applyInvitationWorkspaceGrants core (services/invitations.ts).
 *   v1.4.0 — 2026-07-18 — Email-invitation routes (create/list/edit/cancel) accept an app session (H-2)
 *     holding the owner-granted organism:invite scope via requireRoleOrScope — a published app (the
 *     Experience Center admin pane) invites customers with tier grants in-app. requireOrgAdmin still
 *     gates every path to the organism's creator/admin; agent/owner role callers are unchanged.
 *   v1.5.0 — 2026-07-18 — SECURITY (invite-hijack): the accept path now recipient-binds a signed-in
 *     session — its verified email must match inv.emailHash or 403 EMAIL_MISMATCH (invite NOT consumed);
 *     accept/GET refuse non-'link' invites (defence in depth). Additive: an inviter-pinned, allowlisted
 *     return_url lands the accepter back in the inviting app after join; GET returns a `viewer` verdict
 *     so the page warns about a mismatch before the button.
 *   v1.6.0 — 2026-08-11 — the email-invite cancel route calls cancelEmailInvitation() instead of
 *     flipping the record itself, so it and aimeat_organism_invitation_email_cancel share one write
 *     (August 2026 MCP audit step 8).
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireRoleOrScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity, parseGaiiLoose, isSameOwner, validateOwnerName } from '../../utils/gaii.js';
import { authorizeRead } from '../../services/access-guard.js';
import { emitChange } from '../../services/event-bus.js';
import { notify } from '../../services/notify.js';
import { hashPassword } from '../../services/password.js';
import { provisionOwner, ProvisionEmailTakenError } from '../../services/owner-provisioning.js';
import { getActiveEmailService } from '../../services/email.js';
import { countWorkspaceInstances, latestWorkspaceEvent, aggregateParticipants } from '../../services/workspace-enrichment.js';
import { isOrgManager } from '../../services/workspace-access.js';
import { createEmailInvitation, cancelEmailInvitation, invitePublic, hashInviteToken, inviteEmailHash, normalizeOrgRole, normalizeWorkspaceGrants, applyInvitationWorkspaceGrants, InvitationError, INVITE_CODE_QUOTA_PER_MEMBER, INVITE_DEFAULT_EXPIRY_DAYS, INVITE_MAX_EXPIRY_DAYS } from '../../services/invitations.js';
import type { InvitationRecord } from '../../storage/repositories/invitation.repository.js';
import type { OrganismHelpers } from './shared.js';

export function registerOrganismWorkspaceAccessRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const {
    memberRole, wsRegPrefix, bareOwner, canReadWsManifest, readWsManifests, findWsEntry, ensureConsent,
    memberRolesForWs, setWorkspaceRole, revokeWorkspaceRole,
    requireWsManager, requireOrgAdmin, requireOrgMember, codeInviteGuards,
  } = H;

  /* ── GET /v1/organisms/:id/workspaces — discover every workspace in the org (membership-gated,
   * names + creator + your access status). Discovery is open to members; content stays gated. ── */
  router.get('/v1/organisms/:id/workspaces', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    // An org manager (creator/admin) reads every workspace under the organism → mark them 'granted'
    // without a per-workspace canReadWs probe (resolved once, not per row).
    const manager = await isOrgManager(storage, id, ownerName);
    // `include` so an archived organism's registry (cascade-archived with it) still lists workspaces.
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000, archived: 'include' });
    const seen = new Map<string, { id: string; name: string; created_by: string; created_at?: string; access: 'owner' | 'granted' | 'none'; archived: boolean }>();
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string; archived?: boolean }> } | null)?.workspaces ?? [];
      for (const w of list) {
        if (!w.id || seen.has(w.id)) continue;
        const createdBy = w.createdBy ?? bareOwner(rec.ownerGaii);
        // access resolved in a second pass: owner rows are known now; the rest need a manifest probe,
        // batched into ONE cross-owner read below instead of one canReadWs scan per workspace.
        seen.set(w.id, { id: w.id, name: w.name ?? w.id, created_by: createdBy, created_at: w.createdAt, access: createdBy === ownerName ? 'owner' : 'none', archived: w.archived === true });
      }
    }
    // Non-owner workspaces: a manager reads all (→ 'granted'); everyone else gets a real read-authz probe.
    // Batch the probes' manifest reads into ONE key-IN query, then decide each from its pre-fetched
    // manifest (authorizeRead/eco checks unchanged — identical semantics to per-ws canReadWs).
    const toProbe = manager ? [] : [...seen.values()].filter(w => w.access === 'none').map(w => w.id);
    if (manager) {
      for (const w of seen.values()) if (w.access === 'none') w.access = 'granted';
    } else if (toProbe.length) {
      const manifests = await readWsManifests(id, toProbe);
      for (const wsId of toProbe) {
        if (await canReadWsManifest(callerGaii, `organism.${id}.w.${wsId}.meta.manifest`, manifests.get(wsId) ?? null)) {
          seen.get(wsId)!.access = 'granted';
        }
      }
    }

    // ?include=enrichment — fold the per-workspace getWorkspace+activity+participants fan-out (3N
    // requests, each re-scanning the same prefix) into this ONE response. The three projections keep
    // their EXACT per-endpoint semantics: recs/docs over all records in a readable workspace (= what
    // GET /workspace returns when canReadWs passed); lastEvent over the per-record read-authorized
    // subset (= GET /workspace/activity); participants over the raw bucket (= GET /workspace/participants,
    // counts only — no agent names). Single scan of organism.{id}.w.; a per-ws fallback keeps counts
    // exact above the cap.
    const include = String(req.query.include ?? '').split(',').map(s => s.trim());
    const wantEnrichment = include.includes('enrichment');
    let result: Array<Record<string, unknown>> = [...seen.values()];
    if (wantEnrichment) {
      const ENRICH_SCAN_CAP = 20000;
      const wRoot = `organism.${id}.w.`;
      const buckets = new Map<string, MemoryRecord[]>();
      let perWsScan = false;
      const scan = await storage.listAllMemory({ prefix: wRoot, limit: ENRICH_SCAN_CAP });
      if (scan.total > ENRICH_SCAN_CAP) {
        perWsScan = true;   // org too large for one scan → scoped per-ws scans below (still 1 HTTP request)
      } else {
        for (const r of scan.items) {
          const wsId = r.key.slice(wRoot.length).split('.')[0];
          if (!wsId) continue;
          let arr = buckets.get(wsId);
          if (!arr) { arr = []; buckets.set(wsId, arr); }
          arr.push(r);
        }
      }
      // pending publish-review counts per workspace (folds the frontend's separate listApprovals call in).
      const reviewByWs: Record<string, number> = {};
      for (const a of await storage.listPendingApprovals(id, { status: 'pending' })) {
        const w = (a.arguments as { ws?: string } | undefined)?.ws;
        if (w) reviewByWs[w] = (reviewByWs[w] ?? 0) + 1;
      }
      const enriched: Array<Record<string, unknown>> = [];
      for (const w of seen.values()) {
        if (w.access === 'none') { enriched.push({ ...w }); continue; }
        const root = `organism.${id}.w.${w.id}`;
        const bucket = perWsScan
          ? (await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 })).items
          : (buckets.get(w.id) ?? []);
        const manifestRec = bucket.find(r => r.key === `${root}.meta.manifest`);
        const manifest = (manifestRec?.value as Record<string, unknown> | undefined) ?? null;
        const appsRec = bucket.find(r => r.key === `${root}.meta.apps`);
        // Per-record read-authorization for lastEvent (cross-owner only; same-owner short-circuits) —
        // identical to GET /workspace/activity.
        const readable: MemoryRecord[] = [];
        for (const r of bucket) {
          if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
            const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
            if (!d.allowed) continue;
          }
          readable.push(r);
        }
        const { recs, docs } = countWorkspaceInstances(bucket, manifest, root);
        enriched.push({
          ...w,
          enrichment: {
            hasManifest: !!manifestRec,
            recs, docs,
            lastEvent: latestWorkspaceEvent(readable, manifest, root),
            participants: aggregateParticipants(bucket, { root, members: organism.members ?? [], creator: w.created_by, viewerOwner: ownerName, nodeId: config.nodeId }),
            pendingReviews: reviewByWs[w.id] ?? 0,
            apps: ((appsRec?.value as { apps?: unknown[] } | undefined)?.apps) ?? [],
          },
        });
      }
      result = enriched;
    }
    res.json(success(config.nodeId, { workspaces: result }));
  });

  /* ── POST /v1/organisms/:id/workspace-access — request access to a workspace. Records the request
   * and grants the requester's OWN contributions to the organism, so once approved their additions
   * are visible to the creator + other members. Body: { ws, message? }. ── */
  router.post('/v1/organisms/:id/workspace-access', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, message } = req.body ?? {};
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws || typeof ws !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy === ownerName) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You created this workspace')); return; }
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `organism.${id}.w.${ws}.access.request.${ownerName}`, ownerGaii: callerGaii,
      value: { ws, requester: ownerName, requester_gaii: callerGaii, message: typeof message === 'string' ? message : '', status: 'pending', createdAt: now },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    // Share the requester's own future contributions with the organism (read).
    await ensureConsent(callerGaii, `organism.${id}.w.${ws}.**`, `organism.${id}`, 'workspace-contribution');
    // Notify the workspace creator so the request doesn't go unnoticed. Approve/Deny buttons post the
    // decision endpoint with the clicker's (creator/admin) JWT — the route re-authorizes, so a stale
    // click just 403s/no-ops.
    const wsDecision = `/v1/organisms/${id}/workspace-access/decision`;
    await notify(storage, `${createdBy}@${config.nodeId}`, {
      type: 'workspace_access_request',
      title: `${ownerName} requested access to "${entry.name ?? ws}"`,
      body: typeof message === 'string' ? message : '',
      link: '/v1/profile#organisms',
      actions: [
        { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: wsDecision, body: { ws, requester: ownerName, decision: 'approve' }, style: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'api', method: 'POST', endpoint: wsDecision, body: { ws, requester: ownerName, decision: 'deny' }, style: 'danger', confirm: true },
      ],
    });
    emitChange('notifications');
    res.status(201).json(success(config.nodeId, { status: 'requested', ws, workspace_creator: createdBy }));
  });

  /* ── GET /v1/organisms/:id/workspace-access?ws= — the workspace creator (or org admin) lists the
   * pending/decided access requests for a workspace they own. ── */
  router.get('/v1/organisms/:id/workspace-access', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    // ?all=1 (no ws) — access rosters in one request (replaces the Members tab's per-workspace
    // getWorkspaceAccess fan-out). An org creator/admin manages EVERY workspace (requireWsManager
    // grants them any single ws), so they get every workspace's roster; a plain member still gets
    // only the workspaces they created.
    if (!ws && (req.query.all === '1' || req.query.all === 'true')) {
      const ownerName = req.auth!.owner as string;
      const manager = role === 'creator' || role === 'admin';
      const reg = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
      const manageable: Array<{ id: string; name: string; createdBy: string }> = [];
      const seenWs = new Set<string>();
      for (const rec of reg.items) {
        if (rec.key !== wsRegPrefix(id)) continue;
        for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [])) {
          if (!w.id || seenWs.has(w.id)) continue;
          seenWs.add(w.id);
          const createdBy = w.createdBy ?? bareOwner(rec.ownerGaii);
          if (manager || createdBy === ownerName) manageable.push({ id: w.id, name: w.name ?? w.id, createdBy });
        }
      }
      const workspaces = await Promise.all(manageable.map(async (w) => {
        // Grants are OWNED by each workspace's creator — resolve roles via that creator, not the caller.
        const roles = await memberRolesForWs(`${w.createdBy}@${config.nodeId}`, id, w.id);
        const { items } = await storage.listAllMemory({ prefix: `organism.${id}.w.${w.id}.access.request.`, limit: 1000 });
        const requests = items.map(r => {
          const v = r.value as { requester?: string; message?: string; createdAt?: string };
          const requester = v.requester ?? bareOwner(r.ownerGaii);
          return { requester, message: v.message ?? '', created_at: v.createdAt, status: roles.has(requester) ? 'approved' : 'pending', role: roles.get(requester)?.role ?? null };
        });
        return { ws: w.id, name: w.name, created_by: w.createdBy, requests, members: [...roles.values()].map(m => ({ owner: m.owner, role: m.role, source: m.source ?? null, granted_by: m.grantedBy ?? null })) };
      }));
      res.json(success(config.nodeId, { workspaces }));
      return;
    }

    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== ownerName && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can see access requests')); return;
    }
    const creatorGhii = `${createdBy}@${config.nodeId}`;
    const roles = await memberRolesForWs(creatorGhii, id, ws);   // owner → 'viewer' | 'contributor'
    const { items } = await storage.listAllMemory({ prefix: `organism.${id}.w.${ws}.access.request.`, limit: 1000 });
    const requests = items.map(r => {
      const v = r.value as { requester?: string; message?: string; createdAt?: string };
      const requester = v.requester ?? bareOwner(r.ownerGaii);
      return { requester, message: v.message ?? '', created_at: v.createdAt, status: roles.has(requester) ? 'approved' : 'pending', role: roles.get(requester)?.role ?? null };
    });
    const members = [...roles.values()].map(m => ({ owner: m.owner, role: m.role, source: m.source ?? null, granted_by: m.grantedBy ?? null, granted_at: m.grantedAt ?? null }));
    res.json(success(config.nodeId, { ws, requests, members }));
  });

  /* ── POST /v1/organisms/:id/workspace-access/decision — the workspace creator approves or denies a
   * request. Approve → grant the requester read access to the workspace's content. Body:
   * { ws, requester, decision: 'approve' | 'deny' }. ── */
  router.post('/v1/organisms/:id/workspace-access/decision', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, requester, decision } = req.body ?? {};
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws || !requester || (decision !== 'approve' && decision !== 'deny')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, requester and decision (approve|deny) are required')); return;
    }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const ownerName = req.auth!.owner as string;
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== ownerName && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can decide access')); return;
    }
    // Grants are owned by the WORKSPACE CREATOR (not the deciding admin), so reads resolve via the
    // creator who owns the content. Approve assigns a role (default contributor; the body may ask for
    // 'viewer'); deny revokes every workspace-role grant for the requester.
    const wsCreatorGhii = `${createdBy}@${config.nodeId}`;
    if (decision === 'approve') {
      const role = (req.body?.role === 'viewer' ? 'viewer' : 'contributor') as 'viewer' | 'contributor';
      await setWorkspaceRole(wsCreatorGhii, id, ws, requester, role, 'request', req.auth!.owner as string);
      await notify(storage, `${requester}@${config.nodeId}`, {
        type: 'workspace_access_approved',
        title: `Your access to "${entry.name ?? ws}" was approved (${role})`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
      res.json(success(config.nodeId, { status: 'approved', ws, requester, role }));
    } else {
      await revokeWorkspaceRole(wsCreatorGhii, id, ws, requester);
      await notify(storage, `${requester}@${config.nodeId}`, {
        type: 'workspace_access_denied',
        title: `Your access request to "${entry.name ?? ws}" was declined`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
      res.json(success(config.nodeId, { status: 'denied', ws, requester }));
    }
  });

  /* ── POST /v1/organisms/:id/workspace-access/grant — creator/admin DIRECTLY adds a member with a role
   * (no prior request). Body: { ws, grantee, role: 'viewer' | 'contributor' }. grantee may be an owner
   * name, GHII, or GAII — the grant applies to that OWNER (so all their agents inherit it). ── */
  router.post('/v1/organisms/:id/workspace-access/grant', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, grantee, role } = req.body ?? {};
    if (!grantee || typeof grantee !== 'string' || (role !== 'viewer' && role !== 'contributor')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "grantee and role ('viewer' | 'contributor') are required")); return;
    }
    const createdBy = await requireWsManager(req, res, id, ws);
    if (!createdBy) return;
    const granteeOwnerName = parseGaiiLoose(grantee).owner || grantee;
    if (granteeOwnerName === createdBy) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The creator already has full access to their workspace')); return; }
    await setWorkspaceRole(`${createdBy}@${config.nodeId}`, id, ws as string, grantee, role, 'grant', req.auth!.owner as string);
    await notify(storage, `${granteeOwnerName}@${config.nodeId}`, {
      type: 'workspace_access_granted', title: `You were added to "${ws}" as ${role}`, link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    res.json(success(config.nodeId, { ws, grantee: granteeOwnerName, role }));
  });

  /* ── POST /v1/organisms/:id/workspace-access/revoke — creator/admin removes a member's access.
   * Body: { ws, grantee }. ── */
  router.post('/v1/organisms/:id/workspace-access/revoke', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, grantee } = req.body ?? {};
    if (!grantee || typeof grantee !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'grantee is required')); return; }
    const createdBy = await requireWsManager(req, res, id, ws);
    if (!createdBy) return;
    const revoked = await revokeWorkspaceRole(`${createdBy}@${config.nodeId}`, id, ws as string, grantee);
    res.json(success(config.nodeId, { ws, grantee: parseGaiiLoose(grantee).owner || grantee, revoked }));
  });

  /* ══ Email invitations — invite people NOT yet in the system into this organism (+ workspaces) ══
   * A creator/admin invites an external email; a single-use, time-limited token goes out in an
   * emailed link. On accept the recipient registers a brand-new account (or uses their session) and
   * is joined to the organism + the selected workspaces with the chosen roles. Invites expire and
   * are cancellable before use. The token's raw value lives only in the link; only its hash is stored.
   * Distinct from the name-based /:id/invitations flow above, which targets already-registered owners.
   * The invite-creation core lives in services/invitations.ts (shared with the MCP tools); the accept
   * side stays here — it is session-bound and reuses this router's workspace-role helpers. */

  /* POST /v1/organisms/:id/invitations/email — invite an external email (creator/admin only).
   * Throttle a single inviter to bound outbound email; the per-organism pending cap in
   * createEmailInvitation() is the harder backstop against accumulating spam invites. */
  router.post('/v1/organisms/:id/invitations/email', requireAuth(), requireRoleOrScope('agent', 'organism:invite'), rateLimit({ max: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;

    const { email, orgRole, workspaces, message, expiresInDays, return_url } = req.body ?? {};

    // Normalize + authorize each selected workspace grant (the inviter must be able to manage it).
    const wsGrants = normalizeWorkspaceGrants(workspaces);
    for (const g of wsGrants) {
      const createdBy = await requireWsManager(req, res, id, g.ws);
      if (!createdBy) return; // requireWsManager already responded (ws missing / not permitted)
    }

    try {
      const { invitation, acceptUrl, emailSent } = await createEmailInvitation(storage, config, {
        organism,
        inviterGhii: callerGhii,
        email,
        orgRole: normalizeOrgRole(orgRole),
        workspaces: wsGrants,
        message,
        expiresInDays,
        returnUrl: return_url, // allowlisted in createEmailInvitation (node origin / app subdomains only)
      });
      res.status(201).json(success(config.nodeId, {
        invitation: invitePublic(invitation),
        email_sent: emailSent,
        // Returned to the authorized inviter so they can share the link manually (essential when SMTP is off).
        accept_url: acceptUrl,
      }));
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  /* GET /v1/organisms/:id/invitations/email — list pending email invitations (creator/admin) */
  router.get('/v1/organisms/:id/invitations/email', requireAuth(), requireRoleOrScope('agent', 'organism:invite'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;
    const invitations = (await storage.listInvitationsByOrganism(id, { status: 'pending' })).map(invitePublic);
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* PATCH /v1/organisms/:id/invitations/email/:invId — edit a PENDING email invite's role/workspace
   * grants (rights stay editable until accepted, mirroring the name-invite PATCH). Body: { orgRole?, workspaces? } */
  router.patch('/v1/organisms/:id/invitations/email/:invId', requireAuth(), requireRoleOrScope('agent', 'organism:invite'), async (req, res) => {
    const id = req.params.id as string;
    const invId = req.params.invId as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;
    const inv = await storage.getInvitation(invId);
    if (!inv || inv.organismId !== id) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status !== 'pending') { res.status(409).json(error(config.nodeId, 'INVALID_STATE', `Invitation is already ${inv.status}`)); return; }
    const { orgRole, workspaces } = req.body ?? {};
    if (orgRole === undefined && workspaces === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide "orgRole" and/or "workspaces" to update')); return;
    }
    const updates: Partial<InvitationRecord> = {};
    if (orgRole !== undefined) updates.orgRole = normalizeOrgRole(orgRole);
    if (workspaces !== undefined) {
      const wsGrants = normalizeWorkspaceGrants(workspaces);
      for (const g of wsGrants) {
        const createdBy = await requireWsManager(req, res, id, g.ws);
        if (!createdBy) return; // requireWsManager already responded (ws missing / not permitted)
      }
      updates.workspaces = wsGrants;
    }
    const updated = await storage.updateInvitation(invId, updates);
    res.json(success(config.nodeId, { invitation: invitePublic(updated ?? { ...inv, ...updates }) }));
    emitChange('organisms');
  });

  /* POST /v1/organisms/:id/invitations/email/:invId/cancel — cancel a pending email invite (creator/admin) */
  router.post('/v1/organisms/:id/invitations/email/:invId/cancel', requireAuth(), requireRoleOrScope('agent', 'organism:invite'), async (req, res) => {
    const id = req.params.id as string;
    const invId = req.params.invId as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;
    try {
      // Shared with aimeat_organism_invitation_email_cancel (services/invitations.ts).
      await cancelEmailInvitation(storage, { organismId: id, invitationId: invId });
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
    res.json(success(config.nodeId, { status: 'cancelled' }));
  });

  /* ══ Provisioned-code invitations ("keys") — a second invitation TYPE whose account is created at
   * MINT time and whose emailed code IS the account password. The recipient logs in with the code on
   * the client (no magic-link accept step). A per-inviter quota (INVITE_CODE_QUOTA_PER_MEMBER) makes
   * exclusivity spread virally; the org creator/admin is unlimited. Cancellable while un-activated →
   * deletes the account + frees the slot. Authorized by ORG MEMBERSHIP + the organism:invite scope
   * (not role) via requireExternalPrincipal, so it works from an H-2 app origin (role 'app') for the
   * operator AND for keyholders. Service-specific naming/format/email copy stays in the CLIENT: the
   * caller supplies username + code (its password) + a localized message + landing_url. */

  /* POST /v1/organisms/:id/invitations/code — mint a key (provisions an account, emails the code). */
  router.post('/v1/organisms/:id/invitations/code', ...codeInviteGuards, rateLimit({ max: 30, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const id = req.params.id as string;
    const inviter = req.auth!.owner as string;
    const gate = await requireOrgMember(req, res, id);
    if (!gate) return;
    const { organism, unlimited } = gate;

    const { email, username, code, display_name, locale, message, landing_url, workspaces, org_role, expires_in_days } = req.body ?? {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A valid "email" is required')); return; }
    if (!code || typeof code !== 'string' || code.length < 8) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A "code" (min 8 chars) is required')); return; }
    let uname = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (uname.includes('@')) uname = uname.split('@')[0];
    const nameErr = validateOwnerName(uname);
    if (nameErr) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameErr)); return; }

    // Per-inviter quota (creator/admin exempt): every non-cancelled code key this inviter minted counts
    // (activation does not change the count — only cancelling an un-activated key frees a slot).
    if (!unlimited) {
      const used = await storage.countInvitationsByInviter(inviter, { type: 'code', statuses: ['pending'] });
      if (used >= INVITE_CODE_QUOTA_PER_MEMBER) { res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Key quota reached (${INVITE_CODE_QUOTA_PER_MEMBER}). Cancel an un-activated key to free a slot.`)); return; }
    }
    if (await storage.getOwner(uname)) { res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${uname}" is already registered`)); return; }

    // Provision the guest account: the code IS the password (hashed → a minted high-entropy credential,
    // so the strength validator is intentionally skipped). verifiedEmail lifts the confirmation gate in
    // one step (level 1); provisionOwner throws ProvisionEmailTakenError if it's already taken → 409.
    const passwordHash = await hashPassword(code);
    try {
      await provisionOwner(storage, config, {
        username: uname,
        displayName: (typeof display_name === 'string' && display_name.trim()) ? display_name.trim() : uname,
        passwordHash,
        locale: typeof locale === 'string' ? locale : undefined,
        verifiedEmail: cleanEmail,
        enableMagicLink: false,
      });
    } catch (e) {
      if (!(e instanceof ProvisionEmailTakenError)) throw e;
      res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN', 'That email already belongs to an account on this node.'));
      return;
    }
    emitChange('ghii');

    // Join the organism (mirrors the accept handler: membership row + roster arrays in sync).
    const nowIso = new Date().toISOString();
    const orgRole = normalizeOrgRole(org_role);
    await storage.createMembership({ id: uuidv4(), organismId: id, ghii: uname, role: orgRole, status: 'active', invitedBy: inviter, joinedAt: nowIso });
    await storage.updateOrganism(id, {
      members: [...new Set([...organism.members, uname])],
      admins: orgRole === 'admin' ? [...new Set([...organism.admins, uname])] : organism.admins,
      updatedAt: nowIso,
    });

    // Grant the selected workspaces (creator-owned viewer/contributor consents — shared core).
    const wsGrants = normalizeWorkspaceGrants(workspaces);
    const grantedWs = await applyInvitationWorkspaceGrants(storage, config, { orgId: id, grants: wsGrants, grantee: uname, invitedBy: inviter });

    // Record the invitation (type 'code'; the token is unused — the provisioned account is the artifact).
    // expiresAt is retained for the record but NOT auto-swept: a code key is reclaimed only by an
    // explicit cancel (see the expiry job, which skips type='code').
    const days = Number.isFinite(Number(expires_in_days)) ? Math.min(INVITE_MAX_EXPIRY_DAYS, Math.max(1, Math.floor(Number(expires_in_days)))) : INVITE_DEFAULT_EXPIRY_DAYS;
    const invitation: InvitationRecord = {
      id: uuidv4(),
      tokenHash: hashInviteToken(uuidv4()),
      organismId: id,
      orgRole,
      type: 'code',
      meta: null,
      workspaces: wsGrants,
      email: cleanEmail,
      emailHash: inviteEmailHash(cleanEmail),
      invitedBy: inviter,
      provisionedOwner: uname,
      message: (typeof message === 'string' && message.trim()) ? message.trim().slice(0, 1000) : null,
      status: 'pending',
      createdAt: nowIso,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      acceptedAt: null,
      acceptedBy: null,
      returnUrl: null, // code invites provision an account directly — no accept-page redirect
    };
    await storage.createInvitation(invitation);

    // Email the code + landing link (best-effort; a disabled transport returns false).
    const emailSvc = getActiveEmailService();
    let emailSent = false;
    if (emailSvc?.enabled) {
      emailSent = await emailSvc.sendKeyInvite(cleanEmail, {
        code,
        landingUrl: (typeof landing_url === 'string' && landing_url) ? landing_url : config.baseUrl,
        orgName: organism.name,
        inviterName: inviter,
        message: invitation.message,
      }, typeof locale === 'string' ? locale : undefined);
    }

    emitChange('organisms');
    res.status(201).json(success(config.nodeId, { invitation: invitePublic(invitation), email_sent: emailSent, workspaces: grantedWs }));
  });

  /* GET /v1/organisms/:id/invitations/code — the caller's own keys (creator/admin may pass ?all=1). */
  router.get('/v1/organisms/:id/invitations/code', ...codeInviteGuards, async (req, res) => {
    const id = req.params.id as string;
    const inviter = req.auth!.owner as string;
    const gate = await requireOrgMember(req, res, id);
    if (!gate) return;
    const all = req.query.all === '1' && gate.unlimited;
    const rows = (await storage.listInvitationsByOrganism(id, { status: 'pending' })).filter(v => v.type === 'code' && (all || v.invitedBy === inviter));
    const items: Array<{ id: string; email: string; display: string | null; status: string; activated: boolean; created_at: string; expires_at: string }> = [];
    for (const v of rows) {
      // Activation is derived, not stored: the provisioned account has logged in at least once.
      let activated = false;
      if (v.provisionedOwner) {
        const g = await storage.getGHII(`${v.provisionedOwner}@${config.nodeId}`);
        activated = !!g?.lastLoginAt;
      }
      items.push({
        id: v.id, email: v.email,
        display: v.provisionedOwner ? v.provisionedOwner.toUpperCase() : null,
        status: v.status, activated,
        created_at: v.createdAt, expires_at: v.expiresAt,
      });
    }
    const used = await storage.countInvitationsByInviter(inviter, { type: 'code', statuses: ['pending'] });
    res.json(success(config.nodeId, { items, total: items.length, quota: { used, limit: gate.unlimited ? 'unlimited' : INVITE_CODE_QUOTA_PER_MEMBER } }));
  });

  /* POST /v1/organisms/:id/invitations/code/:invId/cancel — cancel while un-activated (inviter or admin). */
  router.post('/v1/organisms/:id/invitations/code/:invId/cancel', ...codeInviteGuards, async (req, res) => {
    const id = req.params.id as string;
    const invId = req.params.invId as string;
    const inviter = req.auth!.owner as string;
    const gate = await requireOrgMember(req, res, id);
    if (!gate) return;
    const inv = await storage.getInvitation(invId);
    if (!inv || inv.organismId !== id || inv.type !== 'code') { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Key not found')); return; }
    if (inv.invitedBy !== inviter && !gate.unlimited) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the inviter or an org admin can cancel this key')); return; }
    if (inv.status !== 'pending') { res.status(409).json(error(config.nodeId, 'INVALID_STATE', `Key is already ${inv.status}`)); return; }

    // Refuse if the account has already been used (activated) — a live keyholder cannot be cancelled.
    if (inv.provisionedOwner) {
      const g = await storage.getGHII(`${inv.provisionedOwner}@${config.nodeId}`);
      if (g?.lastLoginAt) {
        res.status(409).json(error(config.nodeId, 'ALREADY_ACTIVATED', 'This key has already been used — it can no longer be cancelled'));
        return;
      }
      // Tear down the provisioned account: revoke ws grants, drop membership + roster, delete the account.
      for (const g2 of inv.workspaces) {
        const entry = await findWsEntry(id, g2.ws);
        if (!entry) continue;
        const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
        await revokeWorkspaceRole(`${createdBy}@${config.nodeId}`, id, g2.ws, inv.provisionedOwner);
      }
      const m = await storage.getMembership(id, inv.provisionedOwner);
      if (m) await storage.deleteMembership(m.id);
      await storage.updateOrganism(id, {
        members: gate.organism.members.filter(x => x !== inv.provisionedOwner),
        admins: gate.organism.admins.filter(x => x !== inv.provisionedOwner),
        updatedAt: new Date().toISOString(),
      });
      await storage.deleteOwner(inv.provisionedOwner);
      emitChange('ghii');
    }
    await storage.updateInvitation(invId, { status: 'cancelled' });
    emitChange('organisms');
    res.json(success(config.nodeId, { status: 'cancelled' }));
  });

}
