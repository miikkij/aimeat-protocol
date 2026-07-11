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
 *   - Email invitations: POST/GET/cancel /:id/invitations/email + PUBLIC GET/POST /v1/invitations/:token[/accept]
 *   - Provisioned-code invitations ("keys"): POST/GET/cancel /:id/invitations/code (account provisioned at
 *     mint, emailed code = its password; per-inviter quota; app-origin callable via organism:invite scope)
 * @usage app.use(organismsRouter(config, storage));
 * @version-history
 *   v1.x -- 2026-07-11 -- Referential-integrity scan: GET /:id/workspace/dangling-refs flags reference
 *     fields (must_read/refs/born_from.docs/parent_id/target_id/card_id/release_id) + document prose
 *     mentions that point to a missing or archived id in the SAME workspace — read-only, never blocks a
 *     write (the anomaly-watch pattern). See services/dangling-refs.ts.
 *   v1.x -- 2026-07-05 -- Provisioned-code invitations: POST/GET/cancel /:id/invitations/code. A member
 *     provisions a numbered guest account whose emailed code IS its password; per-inviter quota
 *     (INVITE_CODE_QUOTA_PER_MEMBER, org creator/admin unlimited); cancel while un-activated deletes the
 *     account + frees the slot. Authorized by membership + organism:invite scope (requireExternalPrincipal)
 *     so it works from an H-2 app origin. Adds sendKeyInvite email template.
 *   v1.x -- 2026-07-04 -- Email invitations for unregistered users: creator/admin invites an external
 *     email into an organism (+ selected workspaces w/ viewer|contributor); the emailed single-use,
 *     expiring, cancellable token lets the recipient register + join in one step. Public accept
 *     endpoints; new invitations storage repo + inviteEmailHtml/sendInvite + provisionOwner service.
 *   v1.x -- 2026-07-03 -- Contract engagements: POST/GET /:id/workspace/engagements + /retire (first-class
 *     agent×contract×workspace lifecycle; see src/services/workspace-engagements.ts).
 *   v1.1.0 -- 2026-06-07 -- Phase 3: add the generic GET /:id/workspace read.
 *   v1.2.0 -- 2026-06-07 -- Phase 4: gate primitive (approvals) + draft/publish/versioning + publish-gate.
 *   v1.3.0 -- 2026-06-08 -- Multi-workspace: one organism holds many workspaces under
 *     organism.{id}.w.{ws}.*. Workspace read (?ws), publish (body.ws), and DELETE (?ws) are all
 *     workspace-scoped; the registry lives at organism.{id}.meta.workspaces (client-managed).
 *   v1.4.0 -- 2026-06-08 -- Per-workspace access control: GET /:id/workspaces (membership-gated
 *     discovery + access status), POST /:id/workspace-access (request), GET (list requests), and
 *     POST /:id/workspace-access/decision (creator approves/denies → consent grant). Content stays
 *     gated by the workspace creator; org membership only grants discovery.
 *   v1.5.0 -- 2026-06-08 -- Access request + approve/deny now drop an in-app notification (notify())
 *     to the creator / requester, so decisions surface in the header bell instead of being guesswork.
 *   v1.6.0 -- 2026-06-09 -- Workspace backup/portability: GET /:id/workspace/export (full-fidelity
 *     ZIP, ?format=base64) + POST /:id/workspace/import (restore as a new workspace, raw ZIP or
 *     { zip_base64 }). See services/workspace-export.ts + workspace-import.ts.
 *   v1.7.0 -- 2026-06-09 -- Organism-level bundle: GET /:id/export (whole organism + all workspaces)
 *     + POST /organisms/import (restore as a NEW organism). See services/organism-export+import.ts.
 *   v1.8.0 -- 2026-06-09 -- Document-space public sharing: meta.share record + GET/PUT
 *     /:id/workspace/share (member reads, creator/admin writes) and NO-AUTH GET
 *     /:id/workspace/public/documents + /public/document (?format=md), serving only PUBLISHED docs
 *     the share meta marks public. Backs the public HTML markdown viewer.
 *   v1.9.0 -- 2026-06-09 -- Creator-managed workspace member roles: viewer (read) | contributor
 *     (read+write), as creator-owned consents. POST /:id/workspace-access/grant + /revoke; decide now
 *     assigns a role; GET /:id/workspace-access returns members + roles. Write requires the contributor
 *     role (revocable), so a creator can manage who writes.
 *   v1.10.0 -- 2026-06-09 -- Workspace-level read: GET /:id/workspace authorizes once on the manifest
 *     (creator / same-owner / a viewer|contributor grant) and then returns ALL content, not per record —
 *     so a contributor's writes are visible to the creator + every member of a shared workspace.
 *   v1.11.0 -- 2026-06-09 -- Organism-level member management: a join request now notifies the
 *     creator/admins (and the requester on review decision); new DELETE /:id/members/:ghii lets a
 *     creator/admin revoke a member's access (notifies the removed member).
 *   v1.12.0 -- 2026-06-10 -- Workspace read uses the shared isMemoryBackedSpace() predicate (was a
 *     local {memory,knowledge,storage} set — one of three divergent backing filters that let
 *     published content go invisible). Non-memory spaces are creation-gated now; legacy ones render
 *     as a placeholder in the UI until their manifest is repaired to backing:'memory'.
 *   v1.13.0 -- 2026-06-13 -- OKF-style structure overview: GET /:id/overview (whole organism, shallow)
 *     and GET /:id/workspace/overview?ws= (one workspace, deep) return a deterministic Markdown map
 *     (Open Knowledge Format: body + YAML frontmatter), ?format=md for raw text. See
 *     services/structure-overview.ts.
 *   v1.14.0 -- 2026-06-16 -- Record public-activity-feed events: on public organism
 *     create, and on the private→public edge of a workspace share (whole/space/doc).
 *   v1.15.0 -- 2026-06-22 -- Organism-level free-form README: GET /:id returns `readme` and PUT /:id
 *     accepts `readme` (creator-owned memory key organism.{id}.meta.readme). See services/organism-readme.ts.
 *   v1.16.0 -- 2026-06-22 -- Interactive mindmap data: GET /:id/graph (organism → workspaces → spaces +
 *     members/agents) and GET /:id/workspace/graph?ws= (one workspace). Deterministic JSON the client
 *     renders as a clickable Mermaid diagram. See services/structure-graph.ts.
 *   v1.17.0 -- 2026-06-22 -- Structure timeline: GET /:id/structure/history returns the trackable
 *     structure fingerprint's history (organism growth over time). Structural mutations (create,
 *     workspace create/update/delete, publish) record a snapshot via services/structure-snapshot.ts.
 *   v1.18.0 -- 2026-06-23 -- GET /workspace/activity now derives events via the shared
 *     deriveWorkspaceEvents helper (was an inline copy), so direct writes (`.latest`/bare with no
 *     `.version.N`) surface as publish events instead of going unnoticed in the feed/heatmap.
 *   v1.19.0 -- 2026-07-01 -- publishDraft change-guard + versioned flag: an unchanged re-publish
 *     returns { skipped:true } (consumes the draft, no new .version.N, no decision/structure churn)
 *     instead of appending a byte-identical version; publish honours the objectType's `versioned`
 *     flag (default true) so a `versioned:false` space keeps only .latest. Mirrors mcp/workspaces.ts.
 *   v1.20.0 -- 2026-07-10 -- TARGET-025: share access modes. meta.share gains access
 *     ('open'|'password'|'account', default open) + a server-only scrypt passwordHash; the NO-AUTH
 *     public-document reads gate on it (401 SHARE_PASSWORD_REQUIRED / SHARE_ACCOUNT_REQUIRED with an
 *     explicit anonymous!==true check — anonymous mode injects a truthy req.auth). New NO-AUTH
 *     POST /:id/workspace/share/unlock (per-IP rate-limited, timing-uniform) exchanges the password
 *     for a 24 h EdDSA share token carried in X-Share-Token. GET/PUT share responses are redacted
 *     (has_password, never the hash). Member reads via authenticated routes are unaffected.
 *   v1.21.0 -- 2026-07-11 -- publishDraft normalizes embedded document image URLs (raw /v1/storage →
 *     owner-addressed /v1/pub) and scopes those files to the workspace (members-only) via
 *     services/doc-images, so a published doc's images load for members without going public.
 */
import { Router, raw, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, PendingApprovalRecord, OrganismRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, optionalAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { generateShareToken, verifyShareToken, SHARE_TOKEN_TTL_SECONDS } from '../services/share-token.js';
import { validatePasswordStrength } from '../utils/password-validation.js';
import { provisionOwner } from '../services/owner-provisioning.js';
import { establishOwnerSession } from '../services/owner-session.js';
import { emitChange, emitMemoryWritten } from '../services/event-bus.js';
import { recordPublicActivity } from '../services/public-activity.js';
import { normalizeDocValueImages } from '../services/doc-images.js';
import { resolveIdentity, parseGaiiLoose, isSameOwner, isGEAI, validateOwnerName } from '../utils/gaii.js';
import { authorizeRead } from '../services/access-guard.js';
import { ecoMayReadKey } from '../services/ecosystem-access.js';
import { shouldGate, gatePolicyFromManifest, type Risk } from '../services/gate-policy.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { expireOverdueApprovals, isOverdue } from '../services/gate-expiry.js';
import { notify } from '../services/notify.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { isMemoryBackedSpace } from '../services/workspace-meta.js';
import { importWorkspace } from '../services/workspace-import.js';
import { exportOrganism } from '../services/organism-export.js';
import { importOrganism } from '../services/organism-import.js';
import { searchOrganismContent } from '../services/organism-search.js';
import { scanOrganismDanglingRefs } from '../services/dangling-refs.js';
import { canAccessWorkspaceComments, addComment, listComments, commentPrefix, type WorkspaceComment } from '../services/organism-comments.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { updateWorkspaceMeta, WorkspaceMetaError } from '../services/workspace-meta.js';
import { canSeeMembers, redactOrganism, rosterCallerFromAuth, MEMBER_VISIBILITY_VALUES } from '../services/organism-privacy.js';
import { countWorkspaceInstances, latestWorkspaceEvent, deriveWorkspaceEvents, aggregateParticipants } from '../services/workspace-enrichment.js';
import { activateEngagement, retireEngagement, listByWorkspace as listEngagementsByWorkspace } from '../services/workspace-engagements.js';
import { buildOrganismOverview, buildWorkspaceOverview } from '../services/structure-overview.js';
import { archiveTarget, unarchiveTarget, isKeyArchived, type ArchiveLevel } from '../services/archive.js';
import { getOrganismReadme, setOrganismReadme } from '../services/organism-readme.js';
import { collectOrganismGraph, collectWorkspaceGraph } from '../services/structure-graph.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { createEmailInvitation, invitePublic, hashInviteToken, inviteEmailHash, normalizeInviteeName, normalizeOrgRole, normalizeWorkspaceGrants, InvitationError, INVITE_CODE_QUOTA_PER_MEMBER, INVITE_DEFAULT_EXPIRY_DAYS, INVITE_MAX_EXPIRY_DAYS } from '../services/invitations.js';
import { getActiveEmailService } from '../services/email.js';
import type { InvitationRecord } from '../storage/repositories/invitation.repository.js';

/** Whether a membership role satisfies an approval's required approverRole. */
function roleSatisfies(approverRole: string, membershipRole: string): boolean {
  if (approverRole === 'member') return true;                                  // any active member
  if (approverRole === 'admin') return membershipRole === 'creator' || membershipRole === 'admin';
  if (approverRole === 'owner') return membershipRole === 'creator';           // the organism owner
  return false;
}

/** Freshest of two records for the same key: higher version wins, then newer updatedAt. Guards workspace
 *  reads/writes against a key that has forked into duplicate-owner copies (a GHII + a legacy agent GAII). */
function fresherRec(a: MemoryRecord | null | undefined, b: MemoryRecord): MemoryRecord {
  if (!a) return b;
  if (b.version !== a.version) return b.version > a.version ? b : a;
  return (b.updatedAt ?? '') >= (a.updatedAt ?? '') ? b : a;
}
/** The member GHII behind any identity: `agent#owner@node` → `owner@node`; a bare GHII is returned as-is.
 *  Workspace current-state records (.draft/.latest) are owned by this so a key never forks per-agent. */
function ownerGhiiOf(identity: string): string {
  return identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity;
}
/** Delete every copy of `key` NOT owned by `keepOwner` — collapses a forked key back to a single owner. */
async function collapseKeyTo(storage: Storage, key: string, keepOwner: string): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  await Promise.all(items
    .filter(r => r.key === key && r.ownerGaii !== keepOwner)
    .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(() => { /* best-effort collapse */ })));
}

export function organismsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── POST /v1/organisms — Create a new organism ── */
  router.post('/v1/organisms', requireAuth(), requireRole('agent'), async (req, res) => {
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
      payload = await Promise.all(organisms.map(async (o) => {
        const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(o.id), limit: 1000 });
        const ids = new Set<string>();
        for (const rec of items) {
          if (rec.key !== wsRegPrefix(o.id)) continue;
          for (const w of ((rec.value as { workspaces?: Array<{ id?: string }> } | null)?.workspaces ?? [])) {
            if (w.id) ids.add(w.id);
          }
        }
        return { ...o, workspace_count: ids.size };
      }));
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
    await Promise.all(orgs.map(async (org) => {
      const aps = await storage.listPendingApprovals(org.id, { status: 'pending' });
      if (aps.length) {
        const byWs: Record<string, number> = {};
        for (const a of aps) { const w = (a.arguments as { ws?: string } | undefined)?.ws ?? ''; byWs[w] = (byWs[w] ?? 0) + 1; }
        const names: Record<string, string> = {};   // ws id → name from the registry (names only, one scan/org)
        const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(org.id), limit: 1000 });
        for (const rec of items) {
          if (rec.key !== wsRegPrefix(org.id)) continue;
          for (const w of ((rec.value as { workspaces?: Array<{ id: string; name?: string }> } | null)?.workspaces ?? [])) {
            if (w.id && !(w.id in names)) names[w.id] = w.name ?? w.id;
          }
        }
        for (const [wsId, n] of Object.entries(byWs)) reviews.push({ kind: 'review', n, orgId: org.id, orgName: org.name, wsId, wsName: names[wsId] || wsId });
      }
      const canManage = org.creatorGhii === owner || (org.admins ?? []).includes(owner);
      if (canManage) {
        const jr = await storage.listJoinRequests(org.id, { status: 'pending' });
        if (jr.length) joinRequests.push({ kind: 'join', n: jr.length, orgId: org.id, orgName: org.name });
      }
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

  /* ── GET /v1/organisms/:id/members — List members ── */
  router.get('/v1/organisms/:id/members', optionalAuth(), async (req, res) => {
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

    // Roster privacy (memberVisibility): below the tier the listing shrinks to the accountability
    // rows — creator/admins + the caller's own row — while the TRUE total stays (count ≠ identity).
    // The shared anonymous identity is treated as unauthenticated (rosterCallerFromAuth).
    const rosterCaller = rosterCallerFromAuth(req.auth);
    const canSeeRoster = await canSeeMembers(storage, organism, rosterCaller);
    if (!canSeeRoster) {
      const visible = members.filter(m => m.role === 'creator' || m.role === 'admin'
        || m.ghii === organism.creatorGhii || organism.admins.includes(m.ghii)
        || (rosterCaller.ownerName && m.ghii === rosterCaller.ownerName));
      res.json(success(config.nodeId, { members: visible, total: members.length, members_hidden: true }));
      return;
    }

    // A member's agents inherit access implicitly (same-owner: join answers ALREADY_MEMBER), so
    // "who can touch this organism" must be enumerable — an unlisted actor with access is an
    // audit gap. Each member row carries its owner's agents for ACTIVE members (or an operator)
    // only; outsiders/public callers get the legacy shape (agent rosters are not public data).
    const callerOwner = req.auth?.owner;
    const callerMembership = callerOwner ? await storage.getMembership(id, callerOwner) : null;
    const canSeeAgents = (callerMembership?.status === 'active') || !!req.auth?.roles.includes('operator');
    if (canSeeAgents) {
      const enriched = await Promise.all(members.map(async m => {
        const ownerName = (m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0];
        const agents = await storage.getAgentsByOwner(ownerName);
        return { ...m, agents: agents.map(a => ({ gaii: a.gaii, name: a.name })) };
      }));
      res.json(success(config.nodeId, { members: enriched, total: enriched.length, agents_included: true }));
      return;
    }

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

    // Notify the requester of the decision so it surfaces in their bell.
    await notify(storage, `${request.ghii}@${config.nodeId}`, {
      type: decision === 'approved' ? 'organism_join_approved' : 'organism_join_rejected',
      title: decision === 'approved'
        ? `You were approved to join "${organism.name}"`
        : `Your request to join "${organism.name}" was declined`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

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

  /* ── DELETE /v1/organisms/:id/members/:ghii — Remove (revoke) a member ──
   * Creator/admin removes another member's organism access entirely: deletes the
   * membership and drops them from members[] (+ admins[] if applicable). The creator
   * cannot be removed (they must delete the organism); an admin can only be removed by
   * the creator. The removed member is notified. To leave voluntarily, use /leave. */
  router.delete('/v1/organisms/:id/members/:ghii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const callerIsCreator = organism.creatorGhii === callerGhii;
    const callerIsAdmin = callerIsCreator || organism.admins.includes(callerGhii);
    if (!callerIsAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can remove members'));
      return;
    }

    if (targetGhii === organism.creatorGhii) {
      res.status(400).json(error(config.nodeId, 'CANNOT_REMOVE_CREATOR', 'The creator cannot be removed. Delete the organism instead.'));
      return;
    }

    // Only the creator can remove an admin.
    if (organism.admins.includes(targetGhii) && !callerIsCreator) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator can remove an admin'));
      return;
    }

    const membership = await storage.getMembership(id, targetGhii);
    if (!membership || membership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target is not an active member'));
      return;
    }

    // `?ban=1` (or body { ban: true }) blocks the member from re-joining / being re-invited:
    // keep the membership row but flip it to `banned` instead of deleting it. Plain remove just
    // deletes the row (they can request to join again).
    const ban = req.query.ban === '1' || req.query.ban === 'true' || req.body?.ban === true;
    const now = new Date().toISOString();
    if (ban) {
      await storage.updateMembership(membership.id, { status: 'banned', role: 'member' });
    } else {
      await storage.deleteMembership(membership.id);
    }
    await storage.updateOrganism(id, {
      members: organism.members.filter(m => m !== targetGhii),
      admins: organism.admins.filter(a => a !== targetGhii),
      updatedAt: now,
    });

    // Let the removed member know their access was revoked.
    await notify(storage, `${targetGhii}@${config.nodeId}`, {
      type: ban ? 'organism_member_banned' : 'organism_member_removed',
      title: ban
        ? `You were blocked from "${organism.name}"`
        : `Your access to "${organism.name}" was revoked`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.json(success(config.nodeId, { removed: targetGhii, banned: ban }));
    emitChange('organisms');
  });

  /* ── POST /v1/organisms/:id/members/:ghii/unban — Lift a ban ──
   * Creator/admin removes the block on a previously-banned owner by deleting the banned
   * membership row, so they can request to join (or be invited) again. */
  router.post('/v1/organisms/:id/members/:ghii/unban', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const targetGhii = decodeURIComponent(req.params.ghii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
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
  router.post('/v1/organisms/:id/transfer', requireAuth(), requireRole('agent'), async (req, res) => {
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
    if (organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the current creator can transfer ownership'));
      return;
    }
    if (to === callerGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'You are already the creator'));
      return;
    }
    const targetMembership = await storage.getMembership(id, to);
    if (!targetMembership || targetMembership.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_MEMBER', 'Target must be an active member of this organism'));
      return;
    }

    const callerMembership = await storage.getMembership(id, callerGhii);
    const now = new Date().toISOString();
    // Promote the new creator, demote the old one to admin.
    await storage.updateMembership(targetMembership.id, { role: 'creator' });
    if (callerMembership) await storage.updateMembership(callerMembership.id, { role: 'admin' });
    const admins = [...new Set([...organism.admins.filter(a => a !== to), callerGhii])];
    await storage.updateOrganism(id, { creatorGhii: to, admins, updatedAt: now });

    await notify(storage, `${to}@${config.nodeId}`, {
      type: 'organism_ownership_transferred',
      title: `You are now the creator of "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');

    res.json(success(config.nodeId, { creator: to, previousCreator: callerGhii }));
    emitChange('organisms');
  });

  /* ── Invitations (invite_only flow; works for any policy) ──
   * A creator/admin invites an owner by bare name. The invite is a membership row with
   * status `invited` + `invitedBy`. The invitee is notified and accepts/declines. */

  /* POST /v1/organisms/:id/invitations — invite an owner */
  router.post('/v1/organisms/:id/invitations', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { invitee: inviteeRaw } = req.body ?? {};
    if (!inviteeRaw || typeof inviteeRaw !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "invitee" (an owner name) is required'));
      return;
    }
    const invitee = normalizeInviteeName(inviteeRaw, config.nodeId);
    if (!invitee) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invitee belongs to another node — name-invites work for local owners only'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can invite members'));
      return;
    }
    if (!(await storage.getOwner(invitee))) {
      res.status(404).json(error(config.nodeId, 'OWNER_NOT_FOUND', `No owner named "${invitee}" on this node`));
      return;
    }

    const existing = await storage.getMembership(id, invitee);
    if (existing && existing.status === 'active') {
      res.status(409).json(error(config.nodeId, 'ALREADY_MEMBER', 'That owner is already a member'));
      return;
    }
    if (existing && existing.status === 'invited') {
      res.status(409).json(error(config.nodeId, 'ALREADY_INVITED', 'That owner already has a pending invitation'));
      return;
    }
    if (existing && existing.status === 'banned') {
      res.status(409).json(error(config.nodeId, 'BANNED', 'That owner is blocked — lift the block before inviting'));
      return;
    }

    const now = new Date().toISOString();
    const membership = await storage.createMembership({
      id: uuidv4(),
      organismId: id,
      ghii: invitee,
      role: 'member',
      status: 'invited',
      invitedBy: callerGhii,
      joinedAt: now,
    });
    await notify(storage, `${invitee}@${config.nodeId}`, {
      type: 'organism_invitation',
      title: `${callerGhii} invited you to join "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications', `${invitee}@${config.nodeId}`);

    res.status(201).json(success(config.nodeId, { invitation: membership, status: 'invited' }));
    emitChange('organisms');
  });

  /* GET /v1/organisms/:id/invitations — list outstanding invitations (creator/admin) */
  router.get('/v1/organisms/:id/invitations', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can view invitations'));
      return;
    }
    const invitations = await storage.listMembers(id, { status: 'invited' });
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* GET /v1/organisms/invitations/mine — the caller's own pending invitations (across organisms) */
  router.get('/v1/organisms/invitations/mine', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const memberships = (await storage.listMembershipsByGhii(callerGhii)).filter(m => m.status === 'invited');
    const invitations = [];
    for (const m of memberships) {
      const org = await storage.getOrganism(m.organismId);
      if (org) invitations.push({ membership: m, organism: { id: org.id, name: org.name, description: org.description, type: org.type, visibility: org.visibility } });
    }
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* POST /v1/organisms/:id/invitations/accept — the invitee accepts */
  router.post('/v1/organisms/:id/invitations/accept', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const membership = await storage.getMembership(id, callerGhii);
    if (!membership || membership.status !== 'invited') {
      res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have no pending invitation to this organism'));
      return;
    }
    const now = new Date().toISOString();
    await storage.updateMembership(membership.id, { status: 'active', joinedAt: now });
    await storage.updateOrganism(id, { members: [...new Set([...organism.members, callerGhii])], updatedAt: now });
    // Notify the inviter that the invitation was accepted.
    if (membership.invitedBy) {
      await notify(storage, `${membership.invitedBy}@${config.nodeId}`, {
        type: 'organism_invitation_accepted',
        title: `${callerGhii} accepted your invitation to "${organism.name}"`,
        link: '/v1/profile#organisms',
      });
      emitChange('notifications');
    }
    res.json(success(config.nodeId, { status: 'joined' }));
    emitChange('organisms');
  });

  /* POST /v1/organisms/:id/invitations/decline — the invitee declines */
  router.post('/v1/organisms/:id/invitations/decline', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const membership = await storage.getMembership(id, callerGhii);
    if (!membership || membership.status !== 'invited') {
      res.status(404).json(error(config.nodeId, 'NO_INVITATION', 'You have no pending invitation to this organism'));
      return;
    }
    await storage.deleteMembership(membership.id);
    res.json(success(config.nodeId, { status: 'declined' }));
    emitChange('organisms');
  });

  /* ── Agent attachment (manage organism.agentGaiis) ──
   * An owner attaches one of their OWN agents to an organism they belong to, so the agent shows
   * as an organism participant and passes the workspace membership gate in its own right. */

  /* POST /v1/organisms/:id/agents — attach an agent GAII (caller must own it + be a member) */
  router.post('/v1/organisms/:id/agents', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const { agent_gaii } = req.body ?? {};
    if (!agent_gaii || typeof agent_gaii !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "agent_gaii" is required'));
      return;
    }
    const parsed = parseGaiiLoose(agent_gaii);
    if (!parsed.agent || parsed.owner !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only attach your own agents'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const membership = await storage.getMembership(id, callerGhii);
    const isMember = !!membership && membership.status === 'active';
    if (!isMember && organism.creatorGhii !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You must be a member to attach an agent'));
      return;
    }
    if (organism.agentGaiis.includes(agent_gaii)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_ATTACHED', 'That agent is already attached'));
      return;
    }
    await storage.updateOrganism(id, { agentGaiis: [...organism.agentGaiis, agent_gaii], updatedAt: new Date().toISOString() });
    res.status(201).json(success(config.nodeId, { attached: agent_gaii }));
    emitChange('organisms');
  });

  /* DELETE /v1/organisms/:id/agents/:gaii — detach an agent (its owner, or creator/admin) */
  router.delete('/v1/organisms/:id/agents/:gaii', requireAuth(), requireRole('agent'), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const agentGaii = decodeURIComponent(req.params.gaii as string);

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const parsed = parseGaiiLoose(agentGaii);
    const ownsAgent = parsed.owner === callerGhii;
    const isAdmin = organism.creatorGhii === callerGhii || organism.admins.includes(callerGhii);
    if (!ownsAgent && !isAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the agent owner or an organism admin can detach it'));
      return;
    }
    if (!organism.agentGaiis.includes(agentGaii)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'That agent is not attached'));
      return;
    }
    await storage.updateOrganism(id, { agentGaiis: organism.agentGaiis.filter(g => g !== agentGaii), updatedAt: new Date().toISOString() });
    res.json(success(config.nodeId, { detached: agentGaii }));
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
    // A workspace is scoped under organism.{id}.w.{ws}. — one organism holds many workspaces.
    // (No ws → legacy organism-level root, kept only so an un-scoped call still reads something.)
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const nsRoot = ws ? `organism.${id}.w.${ws}.` : `organism.${id}.`;
    // Archived content is excluded by default (the AI working set); ?includeArchived=true surfaces it
    // — the explicit "look in archive" escape hatch. ?archived=only reads ONLY archived content.
    const archived = req.query.archived === 'only' ? 'only' : (req.query.includeArchived === 'true' ? 'include' : undefined);

    // A workspace is SHARED: authorization is at the workspace level, not per record. If the caller can
    // read the manifest (they created it, are a same-owner agent, or hold a viewer/contributor grant —
    // see authorizeRead/the workspace-role consents), they see ALL of the workspace's content, whoever
    // wrote it — so a contributor's writes are visible to the creator + other members. If not, they see
    // nothing (org membership alone is discovery-only). The manifest is the single gate record.
    // For the archived views we must still surface the (active) manifest/readme so the workspace can
    // render — otherwise `archived=only` would drop the manifest and the whole workspace reads empty.
    // So: include everything, then filter CONTENT by the requested view using each record's own flag
    // while always keeping the workspace's own meta.* (manifest/readme). Default (active) keeps the
    // efficient storage-level exclude.
    let items: MemoryRecord[];
    if (archived === 'only' || archived === 'include') {
      const all = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000, archived: 'include' })).items;
      // Keep ONLY the manifest + readme (so the workspace shell renders) plus the archived content.
      // NB: must match the manifest/readme EXACTLY, not a `meta.` prefix — an objectType namespace can
      // itself start with `meta.` (e.g. `meta.goals`), and a prefix filter would leak ACTIVE content
      // from those spaces into the archived-only view.
      items = archived === 'only'
        ? all.filter(r => r.archived || r.key === `${nsRoot}meta.manifest` || r.key === `${nsRoot}meta.readme`)
        : all;
    } else {
      items = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000 })).items;
    }
    const manRec = items.find(r => r.key === `${nsRoot}meta.manifest`);
    let canReadWorkspace = false;
    if (manRec) {
      canReadWorkspace = manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
      if (!canReadWorkspace) {
        const decision = await authorizeRead(storage, config, {
          ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
          visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
        });
        canReadWorkspace = decision.allowed;
      }
    }
    // Ecosystem (GEAI) data-area allowlist (model A / strict): a GEAI rides its owner's membership, so
    // require a matching owner-granted 'read' area for this workspace's organism — same allowlist the
    // write path enforces. Flat/own-namespace access is unaffected (the key here is always organism.*).
    if (canReadWorkspace && manRec && isGEAI(req.auth!.sub) && !(await ecoMayReadKey(storage, req.auth!.sub, manRec.key))) {
      canReadWorkspace = false;
    }
    const readable: MemoryRecord[] = canReadWorkspace ? items : [];
    const byKey = new Map(readable.map(r => [r.key, r]));

    const manifestRec = byKey.get(`${nsRoot}meta.manifest`);
    const manifest = (manifestRec?.value as Record<string, unknown> | undefined) ?? null;
    const readme = byKey.get(`${nsRoot}meta.readme`)?.value ?? null;
    // Apps pinned to this workspace (meta.apps binding record) — presentation/launch-context only.
    const apps = ((byKey.get(`${nsRoot}meta.apps`)?.value as { apps?: unknown[] } | undefined)?.apps) ?? [];

    // Build the generic objects map from whatever objectTypes the manifest declares.
    // Versioning convention: each instance is one key, optionally suffixed `.draft` (working
    // copy), `.latest` (published), or `.version.N` (history). The current value is `.latest`
    // (falling back to a bare unsuffixed write); drafts are surfaced separately; versions are
    // history (hidden here — list `…{instance}.version.*` via the memory API to read them).
    const objectTypes = (manifest?.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const objects: Record<string, unknown[]> = {};
    const drafts: Record<string, unknown[]> = {};
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || !isMemoryBackedSpace(ot)) continue;
      const nsPrefix = `${nsRoot}${namespace}.`;
      const instances = new Map<string, { bare?: MemoryRecord; latest?: MemoryRecord; draft?: MemoryRecord }>();
      for (const r of readable) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const instanceId = parts[0];
        const role = parts.slice(1).join('.');
        const slot = instances.get(instanceId) ?? {};
        // Keep the FRESHEST per (instance, role): a key forked into duplicate-owner copies (a GHII + a
        // legacy agent GAII) must surface the current value, never a stale lower-version duplicate.
        if (role === '') slot.bare = fresherRec(slot.bare, r);
        else if (role === 'draft') slot.draft = fresherRec(slot.draft, r);
        else if (role === 'latest') slot.latest = fresherRec(slot.latest, r);
        // role startsWith 'version.' → history, skip
        instances.set(instanceId, slot);
      }
      // Surface the record's timestamps on the returned value (when it's an object) as `_createdAt`/
      // `_updatedAt`/`_version` — so a client can show "created / last saved / published" without an
      // extra read. Underscore-prefixed so they never collide with manifest-declared fields; the
      // write paths re-pick {id,title,markdown}/form fields, so these are never persisted back.
      const withMeta = (rec: MemoryRecord): unknown => {
        const v = rec.value;
        return (v && typeof v === 'object' && !Array.isArray(v))
          ? { ...(v as Record<string, unknown>), _createdAt: rec.createdAt, _updatedAt: rec.updatedAt, _version: rec.version }
          : v;
      };
      const current: unknown[] = [];
      const draftList: unknown[] = [];
      for (const slot of instances.values()) {
        const pub = slot.latest ?? slot.bare;
        if (pub !== undefined) current.push(withMeta(pub));
        if (slot.draft !== undefined) draftList.push(withMeta(slot.draft));
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

    res.json(success(config.nodeId, { manifest, readme, apps, objects, drafts, decisions, resources, todos }, [
      { description: 'Read the manifest directly', method: 'GET', url: `/v1/memory/${encodeURIComponent(`${nsRoot}meta.manifest`)}` },
      { description: 'Write a draft record', method: 'POST', url: '/v1/memory' },
      { description: 'Publish a draft', method: 'POST', url: `/v1/organisms/${id}/publish` },
    ]));
  });

  /* ── GET /v1/organisms/:id/overview — OKF-style structure overview (Markdown) ──
   * A deterministic, size-bounded map of the whole organism: each workspace's space breakdown,
   * per-space counts and totals. Membership-gated; a workspace the caller can't read is listed by
   * name only. Generic: any client (an AI agent wanting a fast structural map, the portal UI) renders
   * the returned Markdown. ?format=md returns raw text/markdown; default returns the envelope. */
  router.get('/v1/organisms/:id/overview', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
    const includeArchived = req.query.includeArchived === 'true';
    const { markdown, workspaces, archivedWorkspaces } = await buildOrganismOverview(storage, config, { orgId: id, viewerGaii, includeArchived });
    if (req.query.format === 'md') { res.type('text/markdown').send(markdown); return; }
    res.json(success(config.nodeId, { markdown, workspaces, archivedWorkspaces }, [
      { description: 'Drill into one workspace', method: 'GET', url: `/v1/organisms/${id}/workspace/overview?ws=<ws>` },
      ...(archivedWorkspaces && !includeArchived ? [{ description: 'Include archived workspaces', method: 'GET', url: `/v1/organisms/${id}/overview?includeArchived=true` }] : []),
    ]));
  });

  /* ── GET /v1/organisms/:id/workspace/overview — OKF-style overview of ONE workspace (Markdown) ──
   * DEEP: per space the last N record/document titles + ids + counts (total always shown), so the
   * next targeted read goes straight to the id. Same workspace-level read gate as GET /:id/workspace.
   * Registered BEFORE /:id/workspace would be a concern, but that route has no extra path segment, so
   * the literal `/workspace/overview` is matched here first by Express. ?format=md → raw markdown. */
  router.get('/v1/organisms/:id/workspace/overview', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    if (!ws) { res.status(400).json(error(config.nodeId, 'MISSING_WS', 'Provide ?ws=<workspace id> (list them with GET /v1/organisms/:id/workspaces)')); return; }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
    const { markdown, readable, summary } = await buildWorkspaceOverview(storage, config, { orgId: id, ws, viewerGaii });
    if (req.query.format === 'md') { res.type('text/markdown').send(markdown); return; }
    // `objectives` carries the measurability KPIs with their resolved `current` (computed from records
    // where source:from='records', else declared) so a consumer can check targets without parsing markdown.
    res.json(success(config.nodeId, { markdown, ws, readable, objectives: readable ? summary.objectives : [] }, [
      { description: 'Read the full workspace', method: 'GET', url: `/v1/organisms/${id}/workspace?ws=${encodeURIComponent(ws)}` },
    ]));
  });

  /* ── GET /v1/organisms/:id/graph — structured graph for the interactive mindmap ──
   * Deterministic JSON (organism → workspaces → spaces + members/agents) the client renders as a
   * clickable Mermaid diagram. Membership-gated like the overview; unreadable workspaces appear with
   * readable:false (name only). Generic projection of live state, never persisted. */
  router.get('/v1/organisms/:id/graph', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
    const graph = await collectOrganismGraph(storage, config, { orgId: id, viewerGaii });
    res.json(success(config.nodeId, { graph }, [
      { description: 'Graph one workspace', method: 'GET', url: `/v1/organisms/${id}/workspace/graph?ws=<ws>` },
    ]));
  });

  /* ── GET /v1/organisms/:id/workspace/graph — graph of ONE workspace (root = workspace) ──
   * Same workspace-level read gate as GET /:id/workspace. Registered before the bare /:id/workspace
   * so Express matches the literal `/workspace/graph` first. */
  router.get('/v1/organisms/:id/workspace/graph', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    if (!ws) { res.status(400).json(error(config.nodeId, 'MISSING_WS', 'Provide ?ws=<workspace id>')); return; }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
    const node = await collectWorkspaceGraph(storage, config, { orgId: id, ws, viewerGaii });
    res.json(success(config.nodeId, { graph: node }));
  });

  /* ── GET /v1/organisms/:id/workspace/dangling-refs — referential-integrity scan ──
   * Read-only: finds reference fields (must_read, refs, born_from.docs, parent_id, target_id,
   * card_id, release_id) and document prose mentions that point to an id which is missing — or only
   * archived — in the SAME workspace. The anomaliavahti pattern (TARGET-009 family): it flags, it
   * never blocks a write. Optional ?ws=<id> limits the scan to one workspace; otherwise every
   * registered workspace the caller can read. Same membership + manifest read gate as GET
   * /:id/workspace. Generic across every organism (peer of /overview, /graph, /search). */
  router.get('/v1/organisms/:id/workspace/dangling-refs', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const onlyWs = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const { findings, scannedWorkspaces, truncated } = await scanOrganismDanglingRefs(storage, config, organism, callerGaii, onlyWs);
    res.json(success(config.nodeId, { findings, total: findings.length, scannedWorkspaces, truncated }));
  });

  /* ── GET /v1/organisms/:id/structure/history — the structure TIMELINE ──
   * The current structural fingerprint + its archived prior versions (newest first), each with the
   * `_event`/`_diff`/`_recordedAt` it carried. Backed by the trackable memory key
   * organism.{id}.meta.structure + memory_history (Osa D). Captures the current state first (safety
   * net for any structural change that no explicit trigger recorded), then returns the timeline. */
  router.get('/v1/organisms/:id/structure/history', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    // Safety net: record the current structure if it changed since the last snapshot (no-op via dedup).
    await updateOrganismStructure(storage, config, id, { event: 'viewed', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(() => { /* best-effort */ });

    const creatorGhii = organism.creatorGhii.includes('@') ? organism.creatorGhii : `${organism.creatorGhii}@${config.nodeId}`;
    const key = `organism.${id}.meta.structure`;
    const curRec = (await storage.listAllMemory({ prefix: key, limit: 5 })).items.find(r => r.key === key) ?? null;
    const owner = curRec?.ownerGaii ?? creatorGhii;
    const history = await storage.listMemoryHistory(owner, key, { limit: 500 });
    const current = curRec
      ? { version: curRec.version, value: curRec.value, recordedAt: curRec.updatedAt }
      : null;
    res.json(success(config.nodeId, { current, history }));
  });

  /* ── GET /v1/organisms/:id/search — Search organism / workspace content ──
   * Full-text-ish (case-insensitive substring) search across the records + documents of every
   * workspace the caller can read (or one workspace if ?ws=). Returns matches with the workspace,
   * space (objectType), instance id, a title, and a snippet around the hit. Honours the same
   * workspace-level read authorization as GET /:id/workspace (manifest gate) — a member only
   * searches workspaces they may read; drafts, version history and meta records are skipped. */
  router.get('/v1/organisms/:id/search', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    const onlyWs = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    if (q.length < 2) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query "q" must be at least 2 characters'));
      return;
    }

    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    // Membership gate (same as workspace read): an org agent or an active member.
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) {
      const m = await storage.getMembership(id, ownerName);
      isMember = !!m && m.status === 'active';
    }
    if (!isMember) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // Default excludes archived; ?archived=only is "archive search"; ?includeArchived=true searches both.
    const archived = req.query.archived === 'only' ? 'only' : (req.query.includeArchived === 'true' ? 'include' : undefined);
    const { results, truncated } = await searchOrganismContent(storage, config, organism, callerGaii, q, onlyWs, { archived });
    res.json(success(config.nodeId, { query: q, results, total: results.length, truncated, archived: archived ?? 'exclude' }));
  });

  /* ── Comments / threads on workspace records + documents ──
   * A comment targets one workspace object (record or document) by (ws, space, instance_id), can be
   * anchored to a part of a document (anchor.section or anchor.quote) or left general (no anchor),
   * and can reply to another comment (parent_id) to form threads. Comments are memory-backed under
   * `organism.{id}.w.{ws}.meta.comments.{space}~{instance}.{commentId}` — the meta.* prefix keeps
   * them OUT of the workspace read + content search. Authoring is open to any member or organism
   * agent (so agents can comment); read requires the same workspace-read authorization as the
   * content; a comment can be deleted by its author or a creator/admin. */

  /* POST /v1/organisms/:id/comments — add a comment */
  router.post('/v1/organisms/:id/comments', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, space, instance_id, body, anchor, parent_id } = req.body ?? {};
    if (!ws || !space || !instance_id || typeof body !== 'string' || !body.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space, instance_id and a non-empty body are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    if (!(await canAccessWorkspaceComments(storage, config, organism, req.auth!.sub, req.auth!.owner, callerGaii, ws))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You cannot comment in this workspace')); return;
    }
    const comment = await addComment(storage, id, callerGaii, { ws, space, instanceId: instance_id, body, anchor, parentId: parent_id });
    emitChange('organisms');
    res.status(201).json(success(config.nodeId, { comment }));
  });

  /* GET /v1/organisms/:id/comments?ws=&space=&instance_id= — list a target's thread */
  router.get('/v1/organisms/:id/comments', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = req.query.ws as string;
    const space = req.query.space as string;
    const instanceId = req.query.instance_id as string;
    if (!ws || !space || !instanceId) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space and instance_id query params are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    if (!(await canAccessWorkspaceComments(storage, config, organism, req.auth!.sub, req.auth!.owner, callerGaii, ws))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You cannot read this workspace')); return;
    }
    const comments = await listComments(storage, id, ws, space, instanceId);
    res.json(success(config.nodeId, { comments, total: comments.length }));
  });

  /* ── POST /v1/organisms/:id/comments/batch — comments (or counts) for MANY (ws,space,instance)
   * targets in one request, replacing the per-document `GET /comments` fan-out when many threads are
   * visible at once. Body { instances:[{ws,space,instance_id}], countsOnly? } (POST body, so a large
   * target list never bloats the URL). Each ws is gated ONCE with the same canAccessWorkspaceComments
   * as the single GET; instances in a workspace the caller can't read are simply OMITTED (the batch is
   * not 403'd). Per readable ws, ONE scan of its comments subtree buckets every thread. Response is a
   * map keyed by a stable composite "ws\0space\0instance_id". ── */
  router.post('/v1/organisms/:id/comments/batch', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const instances = Array.isArray(req.body?.instances) ? req.body.instances : null;
    const countsOnly = req.body?.countsOnly === true;
    if (!instances) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'instances[] is required')); return; }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const byWs = new Map<string, Array<{ space: string; instance_id: string }>>();
    for (const it of instances) {
      const ws = typeof it?.ws === 'string' ? it.ws : '';
      const space = typeof it?.space === 'string' ? it.space : '';
      const instance_id = typeof it?.instance_id === 'string' ? it.instance_id : '';
      if (!ws || !space || !instance_id) continue;
      const arr = byWs.get(ws) ?? [];
      arr.push({ space, instance_id });
      byWs.set(ws, arr);
    }
    const SEP = '\u0000';
    const out: Record<string, { comments?: WorkspaceComment[]; total: number }> = {};
    for (const [ws, targets] of byWs) {
      if (!(await canAccessWorkspaceComments(storage, config, organism, req.auth!.sub, req.auth!.owner, callerGaii, ws))) continue;   // omit unreadable ws
      const { items } = await storage.listAllMemory({ prefix: `organism.${id}.w.${ws}.meta.comments.`, limit: 5000 });
      const wanted = new Set(targets.map(t => `${t.space}~${t.instance_id}`));
      const threads = new Map<string, WorkspaceComment[]>();
      for (const r of items) {
        const v = r.value as WorkspaceComment | undefined;
        if (!v || typeof v !== 'object') continue;
        const k = `${v.space}~${v.instanceId}`;
        if (!wanted.has(k)) continue;
        const arr = threads.get(k) ?? [];
        arr.push(v);
        threads.set(k, arr);
      }
      for (const t of targets) {
        const list = (threads.get(`${t.space}~${t.instance_id}`) ?? []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        out[`${ws}${SEP}${t.space}${SEP}${t.instance_id}`] = countsOnly ? { total: list.length } : { comments: list, total: list.length };
      }
    }
    res.json(success(config.nodeId, { comments: out }));
  });

  /* DELETE /v1/organisms/:id/comments/:commentId?ws=&space=&instance_id= — delete (author or creator/admin) */
  router.delete('/v1/organisms/:id/comments/:commentId', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const commentId = req.params.commentId as string;
    const ws = req.query.ws as string;
    const space = req.query.space as string;
    const instanceId = req.query.instance_id as string;
    if (!ws || !space || !instanceId) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws, space and instance_id query params are required'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const callerOwner = req.auth!.owner as string;
    const key = `${commentPrefix(id, ws, space, instanceId)}${commentId}`;
    const scan = await storage.listAllMemory({ prefix: key, limit: 5 });
    const rec = scan.items.find(r => r.key === key);
    if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Comment not found')); return; }
    const isAuthor = rec.ownerGaii === callerGaii;
    const isAdmin = organism.creatorGhii === callerOwner || organism.admins.includes(callerOwner);
    if (!isAuthor && !isAdmin) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the comment author or an organism admin can delete it')); return;
    }
    await storage.deleteMemory(rec.ownerGaii, key);
    emitChange('organisms');
    res.json(success(config.nodeId, { deleted: commentId }));
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
  // TARGET-009 S1: expectedVersion carries the publisher's optimistic lock into the write guards
  // (a namespace with requires_expected_version refuses a publish over a version it didn't read).
  const publishDraft = async (
    organismId: string, ws: string | undefined, namespace: string, instance: string, publisher: string,
    expectedVersion?: number | null,
  ): Promise<{ ok: true; version: number; skipped?: boolean } | { ok: false; code: 'NO_DRAFT' | 'INVALID'; violations?: unknown }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    const ownerGhii = ownerGhiiOf(publisher);
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
    const draft = items.filter(r => r.key === `${base}.draft`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);
    if (!draft) return { ok: false, code: 'NO_DRAFT' };

    // Scope embedded document images to this workspace (members-only) + rewrite to /v1/pub before the
    // draft becomes the published copy — so a shared doc's images load for members without going public.
    const draftValue = await normalizeDocValueImages(storage, config, draft.value, ownerGhii.split('@')[0], ws ? `${organismId}/${ws}` : undefined);

    const validation = await validateMemoryWrite(`${base}.latest`, draftValue, storage, { viaPublish: true, expectedVersion });
    if (!validation.valid) return { ok: false, code: 'INVALID', violations: validation.errors };

    let maxN = 0;
    const vPrefix = `${base}.version.`;
    for (const r of items) {
      if (r.key.startsWith(vPrefix)) {
        const suffix = r.key.slice(vPrefix.length);
        if (/^\d+$/.test(suffix)) maxN = Math.max(maxN, parseInt(suffix, 10));
      }
    }
    const now = new Date().toISOString();
    const vis = draft.visibility;
    const tags = draft.tags ?? [];
    const existingLatest = items.filter(r => r.key === `${base}.latest`).reduce<MemoryRecord | null>((best, r) => fresherRec(best, r), null);

    // Change-guard: an unchanged re-publish (contract agents re-publish the same draft on every poll
    // cycle) must NOT append a byte-identical .version.N. Consume the draft and return without touching
    // .latest or firing the Tracked-Response side effect.
    if (existingLatest && JSON.stringify(existingLatest.value) === JSON.stringify(draftValue)) {
      await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
      return { ok: true, version: maxN, skipped: true };
    }
    // Honour the manifest's `versioned` flag (default true): a `versioned:false` space (e.g. a request
    // queue) keeps only .latest — no immutable per-publish history.
    const mkey = `${wsRoot}.meta.manifest`;
    const manRec = (await storage.listAllMemory({ prefix: mkey, limit: 10 })).items.find(r => r.key === mkey);
    const pubOt = ((manRec?.value as { objectTypes?: Array<{ namespace?: string; versioned?: boolean }> } | undefined)?.objectTypes ?? []).find(o => o.namespace === namespace);
    const versioned = pubOt?.versioned !== false;
    const n = maxN + 1;

    if (versioned) await storage.setMemory({
      key: `${base}.version.${n}`, ownerGaii: publisher, value: draftValue,
      visibility: vis, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    // .latest (current state) is owned by a member's GHII — ONE owner per key, so it never forks into
    // per-agent duplicates a read then has to disambiguate. Preserve the record's existing owner
    // (normalised to their GHII — never a raw agent GAII); a brand-new record is owned by the publisher's
    // GHII. The immutable .version.N above keeps the publisher's attribution. collapseKeyTo removes any
    // copy of .latest left under another identity.
    const latestOwner = existingLatest ? ownerGhiiOf(existingLatest.ownerGaii) : ownerGhii;
    await storage.setMemory({
      key: `${base}.latest`, ownerGaii: latestOwner, value: draftValue,
      visibility: vis, tags, ttlHours: null,
      version: (existingLatest?.version ?? 0) + 1,
      createdAt: existingLatest?.createdAt ?? now, updatedAt: now,
    });
    await collapseKeyTo(storage, `${base}.latest`, latestOwner);
    // Memory Contracts (reactive): publishing a watched record fires Tracked Response evaluation
    // (gated O(1) on the track-registry in the subscriber).
    emitMemoryWritten(latestOwner, `${base}.latest`);
    // Consume the draft — it was the proposal-for-publishing; now it's a frozen version + the new
    // .latest. Re-editing the published instance starts a fresh draft. (Without this the workspace
    // shows a stale draft alongside the identical published copy.)
    await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
    return { ok: true, version: n };
  };

  // Reopen a published record for editing: copy organism.{id}.{ns}.{instance}.latest → .draft so the
  // existing edit → publish flow applies. The published .latest stays live (and keeps serving readers)
  // until the edited draft is re-published. Refuses to clobber an in-progress draft.
  const revertToDraft = async (
    organismId: string, ws: string | undefined, namespace: string, instance: string, reverter: string,
  ): Promise<{ ok: true } | { ok: false; code: 'NO_LATEST' | 'DRAFT_EXISTS' }> => {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
    if (items.find(r => r.key === `${base}.draft`)) return { ok: false, code: 'DRAFT_EXISTS' };
    // Mirror the workspace read: the published current state is .latest, or the bare key as fallback.
    const latest = items.find(r => r.key === `${base}.latest`) ?? items.find(r => r.key === base);
    if (!latest) return { ok: false, code: 'NO_LATEST' };
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `${base}.draft`, ownerGaii: reverter, value: latest.value,
      visibility: latest.visibility, tags: latest.tags ?? [], ttlHours: null,
      version: 1, createdAt: now, updatedAt: now,
    });
    return { ok: true };
  };

  /* ══ Workspace access (per-workspace, creator-controlled, consent-backed) ══
   * Organism membership lets you SEE the workspace LIST (names + who made each); reading/writing a
   * workspace's CONTENT needs the workspace creator's consent. Flow: discover → request → the
   * workspace creator approves → a consent grant is created. Each workspace's creator owns its
   * access — if another member makes their own workspace, THEY consent to it, not the organism owner. */

  const wsRegPrefix = (id: string) => `organism.${id}.meta.workspaces`;
  const bareOwner = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];

  /** Find a workspace's registry entry across every member's registry (one key per owner). */
  const findWsEntry = async (id: string, ws: string): Promise<{ id: string; name?: string; createdBy?: string; createdAt?: string; ownerGaii: string } | null> => {
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string }> } | null)?.workspaces ?? [];
      const entry = list.find(w => w.id === ws);
      if (entry) return { ...entry, ownerGaii: rec.ownerGaii };
    }
    return null;
  };

  /** Can this accessor read the workspace's content (i.e. its manifest)? For a GEAI (callerGaii is the
   *  eco: sub, unchanged by resolveIdentity) a matching 'read' data-area grant is also required — model
   *  A / strict, so a GEAI riding its owner's membership honours the owner-selected read scope. */
  const canReadWs = async (id: string, ws: string, callerGaii: string): Promise<boolean> => {
    const mkey = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: mkey, limit: 10 });
    const man = items.find(r => r.key === mkey);
    if (!man) return false;
    let allowed: boolean;
    if (man.ownerGaii === callerGaii || isSameOwner(man.ownerGaii, callerGaii)) {
      allowed = true;
    } else {
      const d = await authorizeRead(storage, config, { ownerGaii: man.ownerGaii, accessorGaii: callerGaii, resourceKey: man.key, visibility: man.visibility, groupId: man.groupId, action: 'read' });
      allowed = d.allowed;
    }
    if (allowed && isGEAI(callerGaii)) allowed = await ecoMayReadKey(storage, callerGaii, mkey);
    return allowed;
  };

  /** Create a consent grant if an equivalent active one doesn't already exist (idempotent). */
  const ensureConsent = async (ownerGaii: string, dataPattern: string, recipient: string, purpose: string): Promise<void> => {
    const existing = await storage.listConsents(ownerGaii, { status: 'active' });
    if (existing.some(c => c.dataPattern === dataPattern && c.recipient === recipient)) return;
    const now = new Date().toISOString();
    await storage.createConsent({ id: uuidv4(), ownerGaii, dataPattern, recipient, purpose, scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
  };

  /* ══ Workspace member roles (creator-managed) ══
   * A workspace creator grants approved members one of two roles, as a consent the creator OWNS on
   * organism.{id}.w.{ws}.** (so reads resolve via the creator + revoking is clean):
   *   - viewer       → read only          (purpose 'workspace-viewer')
   *   - contributor  → read + write       (purpose 'workspace-contributor')
   * Reads honor ANY grant (viewer/contributor + the legacy 'workspace-access'); writes honor contributor
   * (the write gate also accepts the legacy requester-owned 'workspace-contribution'). Members are an
   * OWNER (+ their agents): the recipient is `ghii:owner@node`, so all the owner's agents inherit. */
  const WS_ROLE_PURPOSES = ['workspace-viewer', 'workspace-contributor', 'workspace-access'];
  const wsPattern = (id: string, ws: string) => `organism.${id}.w.${ws}.**`;
  const recipientOf = (grantee: string) => `ghii:${parseGaiiLoose(grantee).owner || grantee}@${config.nodeId}`;
  /** Set a member's role: revoke any prior workspace-role consent for them, then grant the new one. */
  const setWorkspaceRole = async (creatorGhii: string, id: string, ws: string, grantee: string, role: 'viewer' | 'contributor'): Promise<string> => {
    const recipient = recipientOf(grantee);
    const pattern = wsPattern(id, ws);
    const now = new Date().toISOString();
    const prior = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
    for (const g of prior) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
    await storage.createConsent({ id: uuidv4(), ownerGaii: creatorGhii, dataPattern: pattern, recipient, purpose: role === 'contributor' ? 'workspace-contributor' : 'workspace-viewer', scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
    return recipient;
  };
  const revokeWorkspaceRole = async (creatorGhii: string, id: string, ws: string, grantee: string): Promise<number> => {
    const recipient = recipientOf(grantee);
    const pattern = wsPattern(id, ws);
    const now = new Date().toISOString();
    const grants = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
    for (const g of grants) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
    return grants.length;
  };
  /** Map the creator's active grants → each member's current role for a workspace. */
  const memberRolesForWs = async (creatorGhii: string, id: string, ws: string): Promise<Map<string, 'viewer' | 'contributor'>> => {
    const pattern = wsPattern(id, ws);
    const byOwner = new Map<string, 'viewer' | 'contributor'>();
    for (const c of await storage.listConsents(creatorGhii, { status: 'active' })) {
      if (c.dataPattern !== pattern || !WS_ROLE_PURPOSES.includes(c.purpose)) continue;
      const owner = c.recipient.replace(/^ghii:/, '').split('@')[0];
      if (c.purpose === 'workspace-contributor') byOwner.set(owner, 'contributor');
      else if (!byOwner.has(owner)) byOwner.set(owner, 'viewer');
    }
    return byOwner;
  };

  /* ══ Document-space public sharing (meta.share) ══
   * A workspace's document-space content can be shared read-only without login. The single source of
   * truth is one record per workspace, organism.{id}.w.{ws}.meta.share, with shape
   *   { public?: boolean, spaces?: { [typeName]: boolean }, docs?: { [`${typeName}/${id}`]: boolean },
   *     access?: 'open'|'password'|'account', passwordHash?: string|null }.
   * Resolution for "is doc D in space S public?": docs[`${S}/${D}`] if set, else spaces[S] if set,
   * else public. Only PUBLISHED (.latest) docs are ever served publicly — drafts never leak.
   * `access` gates the whole shared set of the workspace on the NO-AUTH public read path:
   * 'open' (default, link only), 'password' (unlock endpoint mints an X-Share-Token JWT), 'account'
   * (any authenticated NON-ANONYMOUS session — anonymous mode injects a truthy req.auth, so the
   * check must be `req.auth.anonymous !== true`, never `if (req.auth)`). Member/owner reads via the
   * authenticated workspace routes are never affected. passwordHash (scrypt, services/password.ts)
   * never leaves the server — API responses carry only `has_password`. */
  type ShareAccess = 'open' | 'password' | 'account';
  type ShareMeta = {
    public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean>;
    access?: ShareAccess; passwordHash?: string | null;
  };
  type ResolvedShare = {
    public: boolean; spaces: Record<string, boolean>; docs: Record<string, boolean>;
    access: ShareAccess; passwordHash: string | null;
  };

  const readShareMeta = async (id: string, ws: string): Promise<ResolvedShare> => {
    const key = `organism.${id}.w.${ws}.meta.share`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    const v = (items.find(r => r.key === key)?.value as ShareMeta | undefined) ?? {};
    const access: ShareAccess = v.access === 'password' || v.access === 'account' ? v.access : 'open';
    return {
      public: !!v.public, spaces: v.spaces ?? {}, docs: v.docs ?? {},
      access, passwordHash: typeof v.passwordHash === 'string' ? v.passwordHash : null,
    };
  };

  /** The share state as the API is allowed to show it — the password hash NEVER leaves the server. */
  const redactShare = (share: ResolvedShare): Record<string, unknown> => ({
    public: share.public, spaces: share.spaces, docs: share.docs,
    access: share.access, has_password: !!share.passwordHash,
  });

  /** Gate the NO-AUTH public read path by the share's access mode. Returns null when allowed,
   *  else the 401 error code + message the caller should send. Assumes the caller has already
   *  established that something IS shared (404 no-disclosure runs first). */
  const shareGateDenied = async (
    req: Request, organism: { agentGaiis: string[] }, id: string, ws: string, share: ResolvedShare,
  ): Promise<{ code: string; message: string } | null> => {
    if (share.access === 'open') return null;
    const authed = !!req.auth && req.auth.anonymous !== true;
    if (share.access === 'account') {
      return authed ? null : { code: 'SHARE_ACCOUNT_REQUIRED', message: 'Sign in to view these shared documents' };
    }
    // access === 'password': a valid share token for THIS org+ws, or an authenticated org member.
    const rawToken = req.headers['x-share-token'];
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    if (token) {
      try {
        const v = await verifyShareToken(token);
        if (v.org === id && v.ws === ws) return null;
      } catch { /* invalid/expired token falls through to the 401 */ }
    }
    if (authed && await memberRole(req, organism, id)) return null;
    return { code: 'SHARE_PASSWORD_REQUIRED', message: 'This share is password-protected' };
  };

  const isDocPublic = (share: ResolvedShare, typeName: string, docId: string): boolean => {
    const docKey = `${typeName}/${docId}`;
    if (docKey in share.docs) return !!share.docs[docKey];
    if (typeName in share.spaces) return !!share.spaces[typeName];
    return !!share.public;
  };

  /** Read a workspace's manifest value regardless of which member owns it (public path — no auth). */
  const readWsManifestValue = async (id: string, ws: string): Promise<Record<string, unknown> | null> => {
    const key = `organism.${id}.w.${ws}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 10 });
    return (items.find(r => r.key === key)?.value as Record<string, unknown> | undefined) ?? null;
  };

  type PublicDoc = { type: string; id: string; title: string; markdown: string };
  /** Collect the PUBLISHED (.latest) document-space pages that the share meta marks public. An optional
   *  filter narrows to one {type,id}. Drafts/versions are never included. */
  const collectPublicDocs = async (
    id: string, ws: string, share: ResolvedShare, filter?: { type: string; id: string },
  ): Promise<PublicDoc[]> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const out: PublicDoc[] = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'document') continue;
      if (filter && filter.type !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const docId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        if (filter && filter.id !== docId) continue;
        if (!isDocPublic(share, name, docId)) continue;
        const v = r.value as Record<string, unknown> | null;
        out.push({
          type: name, id: docId,
          title: (v && typeof v.title === 'string') ? v.title : docId,
          markdown: (v && typeof v.markdown === 'string') ? v.markdown : '',
        });
      }
    }
    return out;
  };

  /** Render a list of public docs as a single markdown document (for ?format=md). */
  const docsToMarkdown = (wsName: string | undefined, docs: PublicDoc[]): string => {
    const parts: string[] = [];
    if (wsName) parts.push(`# ${wsName}\n`);
    for (const d of docs) { parts.push(`## ${d.title}\n`); parts.push(d.markdown.trim()); parts.push('\n---\n'); }
    return parts.join('\n');
  };

  /* ── GET /v1/organisms/:id/workspaces — discover every workspace in the org (membership-gated,
   * names + creator + your access status). Discovery is open to members; content stays gated. ── */
  router.get('/v1/organisms/:id/workspaces', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    // `include` so an archived organism's registry (cascade-archived with it) still lists workspaces.
    const { items } = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000, archived: 'include' });
    const seen = new Map<string, { id: string; name: string; created_by: string; created_at?: string; access: 'owner' | 'granted' | 'none'; archived: boolean }>();
    for (const rec of items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string; createdAt?: string; archived?: boolean }> } | null)?.workspaces ?? [];
      for (const w of list) {
        if (!w.id || seen.has(w.id)) continue;
        const createdBy = w.createdBy ?? bareOwner(rec.ownerGaii);
        let access: 'owner' | 'granted' | 'none' = 'none';
        if (createdBy === ownerName) access = 'owner';
        else if (await canReadWs(id, w.id, callerGaii)) access = 'granted';
        seen.set(w.id, { id: w.id, name: w.name ?? w.id, created_by: createdBy, created_at: w.createdAt, access, archived: w.archived === true });
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
    // Notify the workspace creator so the request doesn't go unnoticed.
    await notify(storage, `${createdBy}@${config.nodeId}`, {
      type: 'workspace_access_request',
      title: `${ownerName} requested access to "${entry.name ?? ws}"`,
      body: typeof message === 'string' ? message : '',
      link: '/v1/profile#organisms',
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

    // ?all=1 (no ws) — access rosters for ALL of the caller's OWNED workspaces in one request
    // (replaces the Members tab's per-owned-workspace getWorkspaceAccess fan-out). Only own workspaces,
    // so the creator gate is satisfied by construction.
    if (!ws && (req.query.all === '1' || req.query.all === 'true')) {
      const ownerName = req.auth!.owner as string;
      const creatorGhii = `${ownerName}@${config.nodeId}`;
      const reg = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
      const owned: Array<{ id: string; name: string }> = [];
      const seenWs = new Set<string>();
      for (const rec of reg.items) {
        if (rec.key !== wsRegPrefix(id)) continue;
        for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [])) {
          if (!w.id || seenWs.has(w.id)) continue;
          seenWs.add(w.id);
          if ((w.createdBy ?? bareOwner(rec.ownerGaii)) === ownerName) owned.push({ id: w.id, name: w.name ?? w.id });
        }
      }
      const workspaces = await Promise.all(owned.map(async (w) => {
        const roles = await memberRolesForWs(creatorGhii, id, w.id);
        const { items } = await storage.listAllMemory({ prefix: `organism.${id}.w.${w.id}.access.request.`, limit: 1000 });
        const requests = items.map(r => {
          const v = r.value as { requester?: string; message?: string; createdAt?: string };
          const requester = v.requester ?? bareOwner(r.ownerGaii);
          return { requester, message: v.message ?? '', created_at: v.createdAt, status: roles.has(requester) ? 'approved' : 'pending', role: roles.get(requester) ?? null };
        });
        return { ws: w.id, name: w.name, requests, members: [...roles.entries()].map(([owner, r]) => ({ owner, role: r })) };
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
      return { requester, message: v.message ?? '', created_at: v.createdAt, status: roles.has(requester) ? 'approved' : 'pending', role: roles.get(requester) ?? null };
    });
    const members = [...roles.entries()].map(([owner, role]) => ({ owner, role }));
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
      await setWorkspaceRole(wsCreatorGhii, id, ws, requester, role);
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

  /** Shared gate for the grant/revoke routes — returns the workspace creator's name, or sends the
   *  error response and returns null. Only the workspace creator or an org admin may manage access. */
  const requireWsManager = async (req: Request, res: Response, id: string, ws: unknown): Promise<string | null> => {
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    const callerRole = await memberRole(req, organism, id);
    if (!callerRole) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return null; }
    if (!ws || typeof ws !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return null; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return null; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== req.auth!.owner && callerRole !== 'creator' && callerRole !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can manage access')); return null;
    }
    return createdBy;
  };

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
    const granteeOwner = parseGaiiLoose(grantee).owner || grantee;
    if (granteeOwner === createdBy) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The creator already has full access to their workspace')); return; }
    await setWorkspaceRole(`${createdBy}@${config.nodeId}`, id, ws as string, grantee, role);
    await notify(storage, `${granteeOwner}@${config.nodeId}`, {
      type: 'workspace_access_granted', title: `You were added to "${ws}" as ${role}`, link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    res.json(success(config.nodeId, { ws, grantee: granteeOwner, role }));
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
  /** Creator/admin gate shared by the email-invite management routes. */
  const requireOrgAdmin = async (req: Request, res: Response, id: string): Promise<OrganismRecord | null> => {
    const callerGhii = req.auth!.owner as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    if (organism.creatorGhii !== callerGhii && !organism.admins.includes(callerGhii)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can manage invitations'));
      return null;
    }
    return organism;
  };

  /* POST /v1/organisms/:id/invitations/email — invite an external email (creator/admin only).
   * Throttle a single inviter to bound outbound email; the per-organism pending cap in
   * createEmailInvitation() is the harder backstop against accumulating spam invites. */
  router.post('/v1/organisms/:id/invitations/email', requireAuth(), requireRole('agent'), rateLimit({ max: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const callerGhii = req.auth!.owner as string;
    const id = req.params.id as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;

    const { email, orgRole, workspaces, message, expiresInDays } = req.body ?? {};

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
  router.get('/v1/organisms/:id/invitations/email', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;
    const invitations = (await storage.listInvitationsByOrganism(id, { status: 'pending' })).map(invitePublic);
    res.json(success(config.nodeId, { invitations, total: invitations.length }));
  });

  /* POST /v1/organisms/:id/invitations/email/:invId/cancel — cancel a pending email invite (creator/admin) */
  router.post('/v1/organisms/:id/invitations/email/:invId/cancel', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const invId = req.params.invId as string;
    const organism = await requireOrgAdmin(req, res, id);
    if (!organism) return;
    const inv = await storage.getInvitation(invId);
    if (!inv || inv.organismId !== id) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status !== 'pending') { res.status(409).json(error(config.nodeId, 'INVALID_STATE', `Invitation is already ${inv.status}`)); return; }
    await storage.updateInvitation(invId, { status: 'cancelled' });
    res.json(success(config.nodeId, { status: 'cancelled' }));
    emitChange('organisms');
  });

  /* ══ Provisioned-code invitations ("keys") — a second invitation TYPE whose account is created at
   * MINT time and whose emailed code IS the account password. The recipient logs in with the code on
   * the client (no magic-link accept step). A per-inviter quota (INVITE_CODE_QUOTA_PER_MEMBER) makes
   * exclusivity spread virally; the org creator/admin is unlimited. Cancellable while un-activated →
   * deletes the account + frees the slot. Authorized by ORG MEMBERSHIP + the organism:invite scope
   * (not role) via requireExternalPrincipal, so it works from an H-2 app origin (role 'app') for the
   * operator AND for keyholders. Service-specific naming/format/email copy stays in the CLIENT: the
   * caller supplies username + code (its password) + a localized message + landing_url. */
  const codeInviteGuards = [requireAuth(), requireExternalPrincipal(), requireScope('organism:invite')];
  /** Shared member gate for the code routes; returns { organism, membership, unlimited } or null (responded). */
  const requireOrgMember = async (req: Request, res: Response, id: string): Promise<{ organism: OrganismRecord; role: string; unlimited: boolean } | null> => {
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return null; }
    const membership = await storage.getMembership(id, req.auth!.owner as string);
    if (!membership || membership.status !== 'active') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return null; }
    const unlimited = membership.role === 'creator' || membership.role === 'admin';
    return { organism, role: membership.role, unlimited };
  };

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

    // Provision the guest account: the code IS the password (hashed here → a minted high-entropy
    // credential, so the interactive strength validator is intentionally not run). verifiedEmail lifts
    // the email-confirmation gate in one step (verificationLevel 1).
    const passwordHash = await hashPassword(code);
    await provisionOwner(storage, config, {
      username: uname,
      displayName: (typeof display_name === 'string' && display_name.trim()) ? display_name.trim() : uname,
      passwordHash,
      locale: typeof locale === 'string' ? locale : undefined,
      verifiedEmail: cleanEmail,
      enableMagicLink: false,
    });
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

    // Grant the selected workspaces (creator-owned viewer/contributor consents).
    const wsGrants = normalizeWorkspaceGrants(workspaces);
    const grantedWs: string[] = [];
    for (const g of wsGrants) {
      const entry = await findWsEntry(id, g.ws);
      if (!entry) continue;
      const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
      if (createdBy === uname) continue;
      await setWorkspaceRole(`${createdBy}@${config.nodeId}`, id, g.ws, uname, g.role);
      grantedWs.push(g.ws);
    }

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

  /* GET /v1/invitations/:token — PUBLIC: invite details for the accept page (token carried in the URL) */
  router.get('/v1/invitations/:token', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
    const token = req.params.token as string;
    const inv = await storage.getInvitationByHash(hashInviteToken(token));
    if (!inv || inv.status === 'cancelled') { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status === 'accepted') { res.status(410).json(error(config.nodeId, 'INVITE_USED', 'This invitation has already been accepted')); return; }
    if (inv.status === 'expired' || new Date(inv.expiresAt) <= new Date()) {
      if (inv.status === 'pending') await storage.updateInvitation(inv.id, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'INVITE_EXPIRED', 'This invitation has expired'));
      return;
    }
    const organism = await storage.getOrganism(inv.organismId);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const registered = !!(await storage.getGHIIByEmailHash(inv.emailHash));
    const wsDisplay: Array<{ ws: string; name: string; role: string }> = [];
    for (const g of inv.workspaces) {
      const entry = await findWsEntry(inv.organismId, g.ws);
      wsDisplay.push({ ws: g.ws, name: entry?.name || g.ws, role: g.role });
    }
    res.json(success(config.nodeId, {
      invitation: {
        email: inv.email,
        org_role: inv.orgRole,
        workspaces: wsDisplay,
        message: inv.message,
        invited_by: inv.invitedBy,
        expires_at: inv.expiresAt,
        registered,
        organism: { id: organism.id, name: organism.name, description: organism.description, type: organism.type, visibility: organism.visibility },
      },
    }));
  });

  /* POST /v1/invitations/:token/accept — PUBLIC: register (or use current session) + join org + workspaces */
  router.post('/v1/invitations/:token/accept', optionalAuth(), rateLimit({ max: 10, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const token = req.params.token as string;
    const inv = await storage.getInvitationByHash(hashInviteToken(token));
    if (!inv || inv.status === 'cancelled') { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Invitation not found')); return; }
    if (inv.status === 'accepted') { res.status(410).json(error(config.nodeId, 'INVITE_USED', 'This invitation has already been accepted')); return; }
    if (inv.status === 'expired' || new Date(inv.expiresAt) <= new Date()) {
      if (inv.status === 'pending') await storage.updateInvitation(inv.id, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'INVITE_EXPIRED', 'This invitation has expired'));
      return;
    }
    const organism = await storage.getOrganism(inv.organismId);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }

    // Who is accepting: a real (non-anonymous) session, else create a fresh account from the register form.
    const authed = req.auth && req.auth.anonymous !== true ? (req.auth.owner as string) : null;
    let ownerName: string;
    let createdAccount = false;
    if (authed) {
      ownerName = authed;
    } else {
      let { username } = req.body ?? {};
      const { password, display_name, locale } = req.body ?? {};
      if (!username || typeof username !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required')); return; }
      username = username.trim().toLowerCase();
      if (username.includes('@')) username = username.split('@')[0];
      const nameErr = validateOwnerName(username);
      if (nameErr) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameErr)); return; }
      if (!password || typeof password !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required')); return; }
      const pwErr = validatePasswordStrength(password);
      if (pwErr) { res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwErr)); return; }
      if (await storage.getOwner(username)) { res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`)); return; }
      const passwordHash = await hashPassword(password);
      const { owner } = await provisionOwner(storage, config, {
        username,
        displayName: (typeof display_name === 'string' && display_name.trim()) ? display_name.trim() : username,
        passwordHash,
        locale: typeof locale === 'string' ? locale : undefined,
        verifiedEmail: inv.email, // the invite proves reachability → the new account's email is verified
        enableMagicLink: true,
      });
      ownerName = owner.name;
      createdAccount = true;
      emitChange('ghii');
    }

    // Join the organism: membership row + roster arrays kept in sync (mirrors the accept handler above).
    const nowIso = new Date().toISOString();
    const existingMembership = await storage.getMembership(inv.organismId, ownerName);
    if (existingMembership) {
      if (existingMembership.status !== 'active') {
        await storage.updateMembership(existingMembership.id, { status: 'active', role: inv.orgRole, joinedAt: nowIso });
      }
    } else {
      await storage.createMembership({
        id: uuidv4(), organismId: inv.organismId, ghii: ownerName,
        role: inv.orgRole, status: 'active', invitedBy: inv.invitedBy, joinedAt: nowIso,
      });
    }
    const nextMembers = [...new Set([...organism.members, ownerName])];
    const nextAdmins = inv.orgRole === 'admin' ? [...new Set([...organism.admins, ownerName])] : organism.admins;
    await storage.updateOrganism(inv.organismId, { members: nextMembers, admins: nextAdmins, updatedAt: nowIso });

    // Apply the workspace grants (resolve each workspace's creator = the consent owner).
    const grantedWs: string[] = [];
    for (const g of inv.workspaces) {
      const entry = await findWsEntry(inv.organismId, g.ws);
      if (!entry) continue; // workspace deleted since the invite — skip
      const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
      if (createdBy === ownerName) continue; // creator already has full access to their workspace
      await setWorkspaceRole(`${createdBy}@${config.nodeId}`, inv.organismId, g.ws, ownerName, g.role);
      grantedWs.push(g.ws);
    }

    // Consume the invite (single-use) + tell the inviter.
    await storage.updateInvitation(inv.id, { status: 'accepted', acceptedAt: nowIso, acceptedBy: ownerName });
    await notify(storage, `${inv.invitedBy}@${config.nodeId}`, {
      type: 'organism_invitation_accepted',
      title: `${ownerName} accepted your invitation to "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');
    emitChange('organisms');

    // Log the accepting user straight in (fresh roles), so the SPA lands authenticated.
    const ownerRecord = await storage.getOwner(ownerName);
    const roles = ownerRecord?.roles ?? ['owner'];
    const session = await establishOwnerSession(storage, config, req, res, { owner: ownerName, roles });

    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, {
      status: 'joined',
      organism_id: inv.organismId,
      created_account: createdAccount,
      workspaces: grantedWs,
      token: session.token,
      expires_in: session.expiresIn,
      redirect: '/v1/profile#organisms',
    }));
  });

  /* ── Contract engagements — the first-class link between an agent's contract capability and a
   * workspace, with an active/retired lifecycle (docs/agent-workspace-contracts.md §7d). Adopt
   * writes an `active` engagement; Retire flips it to `retired` (kept as history). Distinct from the
   * derived "active here" trace: the engagement is INTENT, the trace is EVIDENCE. ── */

  // Normalize an `agent` body field (full GAII or bare name → full GAII under the given owner).
  const toAgentGaii = (agent: unknown, owner: string): string => {
    const s = String(agent || '').trim();
    return s.includes('#') ? s : `${s}#${owner}@${config.nodeId}`;
  };

  /* ── POST /v1/organisms/:id/workspace/engagements — ACTIVATE (adopt) a contract engagement. Body:
   * { ws, agent, contract? }. The caller must own the agent (you bring your OWN agent in) and be a
   * member of the organism. ── */
  router.post('/v1/organisms/:id/workspace/engagements', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, agent, contract } = req.body ?? {};
    if (!ws || typeof ws !== 'string' || !agent || typeof agent !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and agent are required')); return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const agentGaii = toAgentGaii(agent, req.auth!.owner as string);
    if ((parseGaiiLoose(agentGaii).owner || '') !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only adopt a contract for an agent you own')); return;
    }
    const eng = await activateEngagement(storage, config.nodeId, { orgId: id, ws, agentGaii, contract: typeof contract === 'string' ? contract : undefined, by: req.auth!.owner as string });
    emitChange('organisms');
    res.json(success(config.nodeId, { engagement: eng }));
  });

  /* ── POST /v1/organisms/:id/workspace/engagements/retire — RETIRE a contract engagement (real
   * off-switch: an agent's processing loop skips a workspace whose engagement is retired). Body:
   * { ws, agent, contract? }. Allowed for the agent's OWNER (my agent, I pull it) OR the workspace
   * creator/admin (I run this workspace, I remove your agent). ── */
  router.post('/v1/organisms/:id/workspace/engagements/retire', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, agent, contract } = req.body ?? {};
    if (!ws || typeof ws !== 'string' || !agent || typeof agent !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and agent are required')); return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerRole = await memberRole(req, organism, id);
    if (!callerRole) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const agentGaii = toAgentGaii(agent, req.auth!.owner as string);
    const ownsAgent = (parseGaiiLoose(agentGaii).owner || '') === req.auth!.owner;
    if (!ownsAgent) {
      // Not my agent → I must be able to manage this workspace's access to retire someone else's.
      const entry = await findWsEntry(id, ws);
      const createdBy = entry ? (entry.createdBy ?? bareOwner(entry.ownerGaii)) : null;
      const isManager = createdBy === req.auth!.owner || callerRole === 'creator' || callerRole === 'admin';
      if (!isManager) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the agent’s owner or the workspace creator can retire a contract')); return; }
    }
    const eng = await retireEngagement(storage, config.nodeId, { orgId: id, ws, agentGaii, contract: typeof contract === 'string' ? contract : undefined, by: req.auth!.owner as string });
    emitChange('organisms');
    res.json(success(config.nodeId, { engagement: eng }));
  });

  /* ── GET /v1/organisms/:id/workspace/engagements?ws= — list the contract engagements declared in a
   * workspace (active + retired), for the People panel chips. Member-gated. ── */
  router.get('/v1/organisms/:id/workspace/engagements', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const engagements = await listEngagementsByWorkspace(storage, id, ws);
    res.json(success(config.nodeId, { ws, engagements }));
  });

  /* ── GET /v1/organisms/:id/workspace/activity?ws= — deterministic activity feed for a workspace,
   * derived from the version history: who did what, in which space, draft-edit vs publish, when.
   * Each .version.N = a publish event; each .draft = an edit event. Member-gated; access-filtered. ── */
  router.get('/v1/organisms/:id/workspace/activity', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });
    const manifest = (items.find(r => r.key === `${root}.meta.manifest`)?.value as Record<string, unknown> | undefined) ?? null;

    // Read-authorize each record (the caller's own records AND their own agents' records — same owner,
    // different GAII — are always theirs to see; only genuinely other-owner records hit the consent
    // check), then derive the events via the shared helper so the activity feed, the workspace list's
    // lastEvent, and the agents/activity aggregate all reconstruct events identically.
    const readable: typeof items = [];
    for (const r of items) {
      if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
        const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
        if (!d.allowed) continue;
      }
      readable.push(r);
    }
    const events = deriveWorkspaceEvents(readable, manifest, root);
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json(success(config.nodeId, { ws, events: events.slice(0, 300), total: events.length }));
  });

  /* ── GET /v1/organisms/:id/agents/activity — agent activity context aggregated across EVERY workspace
   * the caller can read, in ONE request (replaces the organism Agents tab's per-workspace
   * getWorkspaceActivity fan-out). Same read-authorized event derivation as GET /workspace/activity.
   * Returns { agents: { agentName: { count, lastAt, workspaces:[names] } } }. ── */
  router.get('/v1/organisms/:id/agents/activity', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    // Registry → readable workspaces + names.
    const reg = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    const wss: Array<{ id: string; name: string }> = [];
    const seenWs = new Set<string>();
    for (const rec of reg.items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [])) {
        if (!w.id || seenWs.has(w.id)) continue;
        seenWs.add(w.id);
        const createdBy = w.createdBy ?? bareOwner(rec.ownerGaii);
        if (createdBy === ownerName || await canReadWs(id, w.id, callerGaii)) wss.push({ id: w.id, name: w.name ?? w.id });
      }
    }
    // Single scan of organism.{id}.w. → bucket by ws (per-ws fallback above the cap).
    const wRoot = `organism.${id}.w.`;
    const ENRICH_SCAN_CAP = 20000;
    const buckets = new Map<string, MemoryRecord[]>();
    let perWsScan = false;
    const scan = await storage.listAllMemory({ prefix: wRoot, limit: ENRICH_SCAN_CAP });
    if (scan.total > ENRICH_SCAN_CAP) perWsScan = true;
    else for (const r of scan.items) {
      const wsId = r.key.slice(wRoot.length).split('.')[0];
      if (!wsId) continue;
      let arr = buckets.get(wsId); if (!arr) { arr = []; buckets.set(wsId, arr); } arr.push(r);
    }
    const agg: Record<string, { count: number; lastAt: string; workspaces: Set<string> }> = {};
    for (const w of wss) {
      const root = `organism.${id}.w.${w.id}`;
      const bucket = perWsScan ? (await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 })).items : (buckets.get(w.id) ?? []);
      const readable: MemoryRecord[] = [];
      for (const r of bucket) {
        if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
          const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
          if (!d.allowed) continue;
        }
        readable.push(r);
      }
      const manifest = (bucket.find(r => r.key === `${root}.meta.manifest`)?.value as Record<string, unknown> | undefined) ?? null;
      for (const e of deriveWorkspaceEvents(readable, manifest, root)) {
        if (!e.agent) continue;
        const a = agg[e.agent] ?? (agg[e.agent] = { count: 0, lastAt: '', workspaces: new Set<string>() });
        a.count++; a.workspaces.add(w.name);
        if (!a.lastAt || (e.at || '') > a.lastAt) a.lastAt = e.at;
      }
    }
    const agents: Record<string, { count: number; lastAt: string; workspaces: string[] }> = {};
    for (const [name, v] of Object.entries(agg)) agents[name] = { count: v.count, lastAt: v.lastAt, workspaces: [...v.workspaces] };
    res.json(success(config.nodeId, { agents }));
  });

  /* ── GET /v1/organisms/:id/workspace/participants?ws= — who takes part in this workspace, derived
   * from the records' ownerGaii traces (humans + their agents leave their identity on what they write)
   * plus organism membership. Builds a node → owner → agents hierarchy. Agent NAMES are revealed only
   * for the CALLER's own agents; every other owner's agents come back anonymized (name: null), so the
   * caller sees their own agents named and everyone else's only as ghost boxes + counts. ── */
  router.get('/v1/organisms/:id/workspace/participants', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const viewerOwner = req.auth!.owner as string;
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });

    interface OwnerAgg { owner: string; node: string; human: number; agents: Map<string, number> }
    const byKey = new Map<string, OwnerAgg>();
    const ensure = (owner: string, node: string) => {
      const k = `${owner}@${node}`;
      let a = byKey.get(k);
      if (!a) { a = { owner, node, human: 0, agents: new Map() }; byKey.set(k, a); }
      return a;
    };
    for (const r of items) {
      const rel = r.key.slice(root.length + 1);
      if (rel.startsWith('access.')) continue;            // access requests are plumbing, not participation
      const p = parseGaiiLoose(r.ownerGaii);
      if (!p.owner || !p.node) continue;
      const agg = ensure(p.owner, p.node);
      if (p.agent) agg.agents.set(p.agent, (agg.agents.get(p.agent) || 0) + 1);
      else agg.human++;
    }
    // Organism members are humans with access — include them even if they have not written anything yet.
    for (const m of (organism.members || [])) ensure(m, config.nodeId);

    const wsEntry = await findWsEntry(id, ws);
    const creator = wsEntry?.createdBy;
    const memberSet = new Set(organism.members || []);

    const nodesMap = new Map<string, OwnerAgg[]>();
    for (const agg of byKey.values()) {
      const list = nodesMap.get(agg.node) ?? [];
      list.push(agg);
      nodesMap.set(agg.node, list);
    }
    const nodes = [...nodesMap.entries()].map(([node, owners]) => ({
      id: node,
      isLocal: node === config.nodeId,
      owners: owners.map(o => {
        const isSelf = o.owner === viewerOwner && o.node === config.nodeId;
        return {
          owner: o.owner,
          isSelf,
          isMember: memberSet.has(o.owner),
          isCreator: o.owner === creator,
          contributions: o.human,
          // Show every agent's identifier + what it has done (its trace count); `isOwn` only drives
          // the visual emphasis. A non-own agent's LIVE status / current task is never exposed here —
          // this endpoint only ever reports the historical trace, so others' agents stay greyed-out.
          agents: [...o.agents.entries()].map(([name, count]) => ({ name, isOwn: isSelf, contributions: count })),
        };
      }),
    }));
    res.json(success(config.nodeId, { ws, viewerOwner, nodes }));
  });

  /* ── PUT /v1/organisms/:id/workspace?ws= — update a workspace's name and/or readme IN PLACE (no new
   * id, no touch to objectTypes/schemas/content), keeping the name synced across manifest + registry.
   * Creator-only (or an org admin). ── */
  router.put('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : (req.body?.ws as string | undefined);
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    // Archived workspace/organism is read-only — block structure/name/readme edits.
    const wsGuard = await isKeyArchived(storage, `organism.${id}.w.${ws}.`);
    if (wsGuard.archived) { res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${wsGuard.level} is archived (read-only). Unarchive it before editing.`)); return; }
    try {
      const result = await updateWorkspaceMeta(storage, config, {
        orgId: id, ws, callerOwner: req.auth!.owner as string,
        isAdmin: role === 'admin' || role === 'creator',
        name: req.body?.name, readme: req.body?.readme,
        addObjectTypes: Array.isArray(req.body?.add_object_types) ? req.body.add_object_types : (Array.isArray(req.body?.add_spaces) ? req.body.add_spaces : undefined),
        manifest: req.body?.manifest, schemas: req.body?.schemas,
        apps: Array.isArray(req.body?.apps) ? req.body.apps : undefined,
      });
      emitChange('organisms');
      res.json(success(config.nodeId, result));
      // Manifest/space/name edits change the structure → record a timeline snapshot (dedup handles no-ops).
      void updateOrganismStructure(storage, config, id, { event: 'workspace updated', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(() => { /* best-effort */ });
    } catch (e) {
      if (e instanceof WorkspaceMetaError) {
        const status = e.code === 'WS_NOT_FOUND' ? 404 : e.code === 'NOT_CREATOR' ? 403 : 400;
        res.status(status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', (e as Error).message || 'Could not update the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/workspace/public/documents?ws=&space=&format= — NO AUTH. The published
   * document-space pages a workspace has marked public (via meta.share). ?space= limits to one space;
   * ?format=md returns a single concatenated markdown document. 404 (no disclosure) if nothing public. ── */
  router.get('/v1/organisms/:id/workspace/public/documents', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    let docs = await collectPublicDocs(id, ws, share);
    if (space) docs = docs.filter(d => d.type === space);
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public documents')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(401).json(error(config.nodeId, denied.code, denied.message)); return; }
    if (req.query.format === 'md') {
      const entry = await findWsEntry(id, ws);
      res.type('text/markdown; charset=utf-8').send(docsToMarkdown(entry?.name, docs));
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, documents: docs }));
  });

  /* ── GET /v1/organisms/:id/workspace/public/document?ws=&type=&id=&format= — NO AUTH. A single
   * published+public document-space page. ?format=md returns its raw markdown. 404 otherwise. ── */
  router.get('/v1/organisms/:id/workspace/public/document', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const docId = typeof req.query.id === 'string' ? req.query.id : '';
    const organism = await storage.getOrganism(id);
    if (!organism || !ws || !type || !docId) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    const docs = await collectPublicDocs(id, ws, share, { type, id: docId });
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Document not found or not public')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(401).json(error(config.nodeId, denied.code, denied.message)); return; }
    const doc = docs[0];
    if (req.query.format === 'md') {
      res.type('text/markdown; charset=utf-8').send(`# ${doc.title}\n\n${doc.markdown.trim()}\n`);
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, document: doc }));
  });

  /* ── GET /v1/organisms/:id/workspace/share?ws= — the current share state (for the UI toggles).
   * Any active member may read it. Owner sessions bypass scopes; app/agent tokens need memory:read
   * (sharing lives in a memory record — without this gate ANY app grant could read/flip it). ── */
  router.get('/v1/organisms/:id/workspace/share', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    res.json(success(config.nodeId, { organism_id: id, ws, share: redactShare(await readShareMeta(id, ws)) }));
  });

  /* ── PUT /v1/organisms/:id/workspace/share?ws= — set the share state. Body { public?, spaces?, docs? }
   * is MERGED into the existing meta.share. The workspace creator or an org admin only. The record is
   * stored under the workspace creator's GHII so there is exactly one canonical share record. ── */
  router.put('/v1/organisms/:id/workspace/share', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can change sharing')); return;
    }
    const body = (req.body ?? {}) as ShareMeta & { password?: string | null };
    const isBoolMap = (m: unknown): m is Record<string, boolean> =>
      !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'boolean');
    if (body.spaces !== undefined && !isBoolMap(body.spaces)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'spaces must be a map of name → boolean')); return; }
    if (body.docs !== undefined && !isBoolMap(body.docs)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'docs must be a map of key → boolean')); return; }
    if (body.access !== undefined && body.access !== 'open' && body.access !== 'password' && body.access !== 'account') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "access must be 'open', 'password' or 'account'")); return;
    }
    if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password must be a string (set) or null (clear)')); return;
    }
    if (typeof body.password === 'string' && (body.password.length < 4 || body.password.length > 128)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password must be 4–128 characters')); return;
    }
    const prev = await readShareMeta(id, ws);
    // password: string sets a new scrypt hash, null clears it, absent keeps the previous one.
    const nextHash = typeof body.password === 'string' ? await hashPassword(body.password)
      : body.password === null ? null : prev.passwordHash;
    const next: ResolvedShare = {
      public: typeof body.public === 'boolean' ? body.public : prev.public,
      spaces: { ...prev.spaces, ...(body.spaces ?? {}) },
      docs: { ...prev.docs, ...(body.docs ?? {}) },
      access: body.access ?? prev.access,
      passwordHash: nextHash,
    };
    if (next.access === 'password' && !next.passwordHash) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "access 'password' requires a password to be set")); return;
    }
    const key = `organism.${id}.w.${ws}.meta.share`;
    const existing = (await storage.listAllMemory({ prefix: key, limit: 10 })).items.find(r => r.key === key);
    const now = new Date().toISOString();
    await storage.setMemory({
      key, ownerGaii: entry.ownerGaii, value: next, visibility: 'private', tags: ['share'], ttlHours: null,
      version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('organisms');
    res.json(success(config.nodeId, { organism_id: id, ws, share: redactShare(next) }));
    // Public landing feed — fire once on the FIRST public edge of this PUT: the whole
    // workspace, any space, or any document transitioning private→public ("publish to feed").
    const newlyPublic = (
      (next.public === true && prev.public === false) ||
      Object.entries(next.spaces).some(([k, v]) => v === true && prev.spaces[k] !== true) ||
      Object.entries(next.docs).some(([k, v]) => v === true && prev.docs[k] !== true)
    );
    if (newlyPublic) {
      void recordPublicActivity(storage, config, {
        category: 'organisms',
        actor: req.auth!.owner as string,
        summary: `Workspace "${entry.name ?? ws}" published publicly`,
        detail: organism.name ? `In organism "${organism.name}"` : '',
        link: `/v1/publicworkspaceviewer?org=${encodeURIComponent(id)}&ws=${encodeURIComponent(ws)}`,
      }).catch(() => { /* feed is best-effort */ });
    }
  });

  /* ── POST /v1/organisms/:id/workspace/share/unlock — NO AUTH. Exchange the share password for a
   * short-lived share token (X-Share-Token on the public reads). Body { ws, password }. Tightly
   * rate-limited PER IP (keyBy:'ip' — anonymous mode would otherwise share one bucket) and
   * timing-uniform: a workspace without a password verifies against a dummy hash so the response
   * time does not disclose whether password mode is even configured. Always a generic 401 on
   * failure — no hints. ── */
  const SHARE_UNLOCK_DUMMY_HASH = 'v2:' + '0'.repeat(32) + ':' + '0'.repeat(128);
  router.post('/v1/organisms/:id/workspace/share/unlock',
    rateLimit({ windowMs: 15 * 60_000, max: 10, keyBy: 'ip' }),
    async (req, res) => {
      const id = req.params.id as string;
      const body = (req.body ?? {}) as { ws?: unknown; password?: unknown };
      const ws = typeof body.ws === 'string' ? body.ws : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!ws || !password) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and password are required')); return; }
      const organism = await storage.getOrganism(id);
      const share = organism ? await readShareMeta(id, ws) : null;
      const usable = !!share && share.access === 'password' && !!share.passwordHash;
      const ok = await verifyPassword(password, usable ? share!.passwordHash! : SHARE_UNLOCK_DUMMY_HASH);
      if (!usable || !ok) { res.status(401).json(error(config.nodeId, 'INVALID_PASSWORD', 'Invalid password')); return; }
      const shareToken = await generateShareToken({ org: id, ws });
      res.json(success(config.nodeId, {
        organism_id: id, ws, share_token: shareToken, expires_in: SHARE_TOKEN_TTL_SECONDS,
      }, [{ description: 'Read the shared documents (send the token as X-Share-Token)', method: 'GET', url: `/v1/organisms/${id}/workspace/public/documents?ws=${ws}` }]));
    });

  /* ── GET /v1/organisms/:id/workspace/export?ws= — download a full-fidelity ZIP backup of a
   * workspace (workspace.json + images/). The workspace creator (or an org admin) only. ── */
  router.get('/v1/organisms/:id/workspace/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can export')); return;
    }
    const { buffer, filename } = await exportWorkspace(storage, config, {
      orgId: id, ws, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt: new Date().toISOString(),
    });
    // Programmatic/MCP callers can request the ZIP as base64 JSON (size-capped to keep it out of an
    // agent's context); the UI downloads the binary directly.
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) {
        res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Workspace too large for inline (base64) export — use the UI/REST binary download.'));
        return;
      }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/:id/workspace/import — restore a workspace ZIP as a NEW workspace in this
   * organism. Body is the raw ZIP (Content-Type application/zip). Member of the target org only;
   * the importer becomes the new workspace's creator. ── */
  router.post('/v1/organisms/:id/workspace/import', requireAuth(),
    // Raw-parse the body EXCEPT application/json (which the global json parser handles → { zip_base64 }).
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '64mb' }),
    async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the workspace ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importWorkspace(storage, config, { orgId: id, importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'workspace_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/export — download a ZIP backup of the WHOLE organism (settings + all
   * its workspaces). Any ACTIVE MEMBER (membership keyed by the bare owner name — org agents in
   * agentGaiis don't qualify): the bundle contains only what the member can already read live, so
   * the gate matches the read model instead of silently 403ing members the UI shows the button to.
   * ?format=base64 for a size-capped JSON payload. ── */
  router.get('/v1/organisms/:id/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const ownerName = req.auth!.owner as string | undefined;
    const m = ownerName ? await storage.getMembership(id, ownerName) : null;
    if (!m || m.status !== 'active') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an active member of the organism can export it')); return; }
    // Export as the member's owner GHII — a member reads the whole organism live, and the per-creator
    // registry + records are GHII-owned (an agent-session GAII used to yield a near-empty bundle).
    const { buffer, filename } = await exportOrganism(storage, config, { orgId: id, exporterGaii: `${ownerName}@${config.nodeId}`, exportedAt: new Date().toISOString() });
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) { res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Organism too large for inline (base64) export — use the UI/REST binary download.')); return; }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/import — restore an organism bundle ZIP as a NEW organism (the importer
   * becomes its creator). Body is the raw ZIP (application/zip) or JSON { zip_base64 }. ── */
  router.post('/v1/organisms/import', requireAuth(), requireRole('agent'),
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '128mb' }),
    async (req, res) => {
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the organism ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importOrganism(storage, config, { importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'organism_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the organism'));
    }
  });

  /* ── DELETE /v1/organisms/:id/workspace — wipe the workspace (manifest + readme + config + ALL
   * object data: drafts, latest, version history) and unregister its schema locks. The organism
   * itself (membership, etc.) stays — it returns to "no workspace yet". Creator/admin only; the
   * deliberate typed-confirmation lives in the UI. Memory under organism.{id}.* is removed entirely. */
  router.delete('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can delete the workspace'));
      return;
    }
    // Scope the wipe to one workspace (organism.{id}.w.{ws}.*) when ?ws= is given; without it, the
    // legacy organism-level wipe. The registry entry (organism.{id}.meta.workspaces) is managed by
    // the client, which removes the entry after this succeeds.
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const prefix = ws ? `organism.${id}.w.${ws}.` : `organism.${id}.`;
    const { items } = await storage.listAllMemory({ prefix, limit: 100000 });
    let memoryKeys = 0;
    for (const r of items) { if (await storage.deleteMemory(r.ownerGaii, r.key)) memoryKeys++; }
    let schemas = 0;
    for (const s of await storage.listSchemas(prefix)) { if (await storage.deleteSchema(s.keyPattern)) schemas++; }
    res.json(success(config.nodeId, { deleted: true, memoryKeys, schemas }));
    emitChange('organisms');
    if (ws) void updateOrganismStructure(storage, config, id, { event: 'workspace deleted', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(() => { /* timeline best-effort */ });
  });

  /* ── Archive / Unarchive ──────────────────────────────────────────────────────────────────────
   * Flag an organism, a workspace, a record-table/document-space, or a single record as read-only +
   * archived so it drops out of every AI-facing material (overview, workspace read, search) yet stays
   * findable via archive search and resolvable by key. Cascades down a container with smart restore
   * (see services/archive.ts). Creator/admin only — archiving is a structural, destructive-adjacent op.
   * Body: { level: 'organism'|'workspace'|'space'|'record', ws?, namespace?, key? }. */
  const validateArchiveTarget = (id: string, body: Record<string, unknown>): { ok: true; target: { level: ArchiveLevel; orgId: string; ws?: string; namespace?: string; key?: string } } | { ok: false; msg: string } => {
    const level = body.level as ArchiveLevel;
    if (!['organism', 'workspace', 'space', 'record'].includes(level)) return { ok: false, msg: 'level must be organism|workspace|space|record' };
    const ws = typeof body.ws === 'string' ? body.ws : undefined;
    const namespace = typeof body.namespace === 'string' ? body.namespace : undefined;
    const key = typeof body.key === 'string' ? body.key : undefined;
    if ((level === 'workspace' || level === 'space' || level === 'record') && !ws) return { ok: false, msg: 'ws is required for workspace/space/record' };
    if (level === 'space' && !namespace) return { ok: false, msg: 'namespace is required for space' };
    if (level === 'record') {
      if (!key) return { ok: false, msg: 'key is required for record' };
      if (!key.startsWith(`organism.${id}.w.${ws}.`)) return { ok: false, msg: 'key must be inside organism.{id}.w.{ws}.' };
    }
    return { ok: true, target: { level, orgId: id, ws, namespace, key } };
  };

  const archiveHandler = (mode: 'archive' | 'unarchive') => async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', `Only the creator or an admin can ${mode} organism content`));
      return;
    }
    const v = validateArchiveTarget(id, (req.body ?? {}) as Record<string, unknown>);
    if (!v.ok) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', v.msg)); return; }
    const actor = resolveIdentity(req.auth!, config.nodeId);
    try {
      const result = mode === 'archive'
        ? await archiveTarget(storage, v.target, actor)
        : await unarchiveTarget(storage, v.target, actor);
      res.json(success(config.nodeId, { [mode === 'archive' ? 'archived' : 'restored']: result.count, level: result.level, root: result.root }));
      emitChange('organisms');
      void updateOrganismStructure(storage, config, id, { event: `${v.target.level} ${mode}d`, actor }).catch(() => { /* timeline best-effort */ });
    } catch (e) {
      res.status(400).json(error(config.nodeId, 'ARCHIVE_FAILED', (e as Error).message || `Could not ${mode}`));
    }
  };

  router.post('/v1/organisms/:id/archive', requireAuth(), requireRole('agent'), archiveHandler('archive'));
  router.post('/v1/organisms/:id/unarchive', requireAuth(), requireRole('agent'), archiveHandler('unarchive'));

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

    const { namespace, id: instance, ws, expected_version: expectedRaw } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    // TARGET-009 S1: the publisher's optimistic lock (required by requires_expected_version spaces)
    const expectedVersion = typeof expectedRaw === 'number' && Number.isFinite(expectedRaw) ? expectedRaw : null;
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin/creator role required to publish in a meta.* namespace'));
      return;
    }
    // Archived content is read-only — block publishing into an archived organism/workspace.
    const pubGuard = await isKeyArchived(storage, wsId ? `organism.${id}.w.${wsId}.` : `organism.${id}.`);
    if (pubGuard.archived) {
      res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${pubGuard.level} is archived (read-only). Unarchive it before publishing.`));
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
        arguments: { namespace, instance, ws: wsId, expected_version: expectedVersion }, risk: 'medium',
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

    const result = await publishDraft(id, wsId, namespace, instance, publisher, expectedVersion);
    if (!result.ok) {
      if (result.code === 'NO_DRAFT') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${namespace}.${instance}`));
      } else {
        // A write-guard refusal is a CONFLICT (the record moved, or the space is append-only) —
        // distinct from a schema shape violation so writers know to re-read, not to reshape.
        const guardHit = (result.violations as Array<{ schema_rule?: string; message?: string }> | undefined)
          ?.find(v => String(v.schema_rule ?? '').startsWith('write_guard'));
        if (guardHit) {
          res.status(409).json(error(config.nodeId, 'WRITE_CONFLICT', guardHit.message ?? 'Write refused by the workspace write guard', 409, { violations: result.violations }));
        } else {
          res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: result.violations }));
        }
      }
      return;
    }
    if (result.skipped) {
      // No-op re-publish (draft identical to the live .latest) — no new version, no decision-log or
      // structure-snapshot churn. The stale draft was still consumed.
      res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version, skipped: true }, [
        { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      ]));
      emitChange('organisms');
      return;
    }
    await writeDecision(id, publisher, `published ${namespace}.${instance} v${result.version}`, [`${namespace}.${instance}`]);
    res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'List version history', method: 'GET', url: `/v1/memory?prefix=${encodeURIComponent(`organism.${id}.${namespace}.${instance}.version.`)}` },
    ]));
    emitChange('organisms');
    // Content growth changes the structure fingerprint (doc/record counts) → record a timeline snapshot.
    void updateOrganismStructure(storage, config, id, { event: 'content published', actor: publisher }).catch(() => { /* best-effort */ });
  });

  // POST /v1/organisms/:id/revert — reopen a published record for editing (copy .latest → .draft).
  // Same write access as publish; not gated (creating a private draft is not a publish).
  router.post('/v1/organisms/:id/revert', requireAuth(), async (req, res) => {
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
    const { namespace, id: instance, ws } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin/creator role required to edit in a meta.* namespace'));
      return;
    }

    const reverter = resolveIdentity(req.auth!, config.nodeId);
    const result = await revertToDraft(id, wsId, namespace, instance, reverter);
    if (!result.ok) {
      if (result.code === 'NO_LATEST') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No published record at ${namespace}.${instance} to reopen`));
      } else {
        res.status(409).json(error(config.nodeId, 'DRAFT_EXISTS', `A draft already exists for ${namespace}.${instance} — edit it directly`));
      }
      return;
    }
    res.json(success(config.nodeId, { reopened: true, namespace, id: instance }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'Publish the edited draft', method: 'POST', url: `/v1/organisms/${id}/publish` },
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
      const pws = typeof pargs?.ws === 'string' ? pargs.ws : undefined;
      if (ns && inst) {
        const pexp = typeof pargs?.expected_version === 'number' ? pargs.expected_version : null;
        const pub = await publishDraft(id, pws, ns, inst, decider, pexp);
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
