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
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { createOrganismHelpers } from './organisms/shared.js';
import { registerOrganismCrudRoutes } from './organisms/crud.js';
import { registerOrganismMembershipRoutes } from './organisms/membership.js';
import { registerOrganismWorkspaceReadRoutes } from './organisms/workspace-read.js';
import { registerOrganismWorkspaceAccessRoutes } from './organisms/workspace-access.js';
import { registerOrganismWorkspaceOpsRoutes } from './organisms/workspace-ops.js';
import { registerOrganismGateRoutes } from './organisms/gates.js';
import { registerOrganismIntakeRoutes } from './organisms/intake.js';

export function organismsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const H = createOrganismHelpers(config, storage);

  // Registration order is load-bearing (Express matches top-to-bottom) — keep these calls in the
  // exact sequence the handlers were originally declared in the monolithic organisms.ts.
  registerOrganismCrudRoutes(router, config, storage, H);
  registerOrganismMembershipRoutes(router, config, storage);
  registerOrganismWorkspaceReadRoutes(router, config, storage);
  registerOrganismWorkspaceAccessRoutes(router, config, storage, H);
  registerOrganismWorkspaceOpsRoutes(router, config, storage, H);
  registerOrganismGateRoutes(router, config, storage, H);
  registerOrganismIntakeRoutes(router, config, storage, H);

  return router;
}
