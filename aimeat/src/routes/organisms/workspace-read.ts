/**
 * @file src/routes/organisms/workspace-read.ts
 * @description Manifest-driven workspace read + read-only projections: the aggregated workspace read,
 *   OKF overviews, structure graphs, dangling-refs scan, structure timeline, content search, and the
 *   comments/threads endpoints. Extracted from src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 *   v1.1.0 — 2026-07-15 — Org managers (creator/admin) pass the workspace read gate automatically —
 *     an org admin reads every workspace under the organism without a per-workspace grant.
 *   v1.2.0 — 2026-07-16 — Workspace read scans exclude `.version.N` rows in SQL (excludeVersionRows):
 *     the read never surfaces history, so loading every historic full-copy value was pure waste.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireRoleOrScope } from '../../auth/middleware.js';
import { resolveIdentity, isSameOwner, isGEAI } from '../../utils/gaii.js';
import { authorizeRead } from '../../services/access-guard.js';
import { ecoMayReadKey } from '../../services/ecosystem-access.js';
import { isMemoryBackedSpace } from '../../services/workspace-meta.js';
import { emitChange } from '../../services/event-bus.js';
import { searchOrganismContent } from '../../services/organism-search.js';
import { scanOrganismDanglingRefs } from '../../services/dangling-refs.js';
import { canAccessWorkspaceComments, addComment, listComments, commentPrefix, type WorkspaceComment } from '../../services/organism-comments.js';
import { buildOrganismOverview, buildWorkspaceOverview, listWorkspaces, collectWorkspaceSummary } from '../../services/structure-overview.js';
import { buildInstructionBlocks } from '../../services/hello-mcp.js';
import { collectOrganismGraph, collectWorkspaceGraph } from '../../services/structure-graph.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';
import { fresherRec } from './shared.js';
import { logger } from '../../utils/logger.js';

export function registerOrganismWorkspaceReadRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
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
    // BARE owner name (matches organisms.ts join/leave + consent.ts organism resolution). The same
    // lookup yields org-manager status (creator/admin), which passes the workspace read gate below.
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    let isOrgManager = false;
    if (ownerName) {
      const membership = await storage.getMembership(id, ownerName);
      if (membership && membership.status === 'active') {
        isMember = true;
        isOrgManager = membership.role === 'creator' || membership.role === 'admin';
      }
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
    // excludeVersionRows: this read collapses each instance to `.latest`/`.draft`/bare and never
    // surfaces `.version.N` history — dropping those rows in SQL avoids loading every historic
    // full-copy value only to skip it in the role loop below.
    let items: MemoryRecord[];
    if (archived === 'only' || archived === 'include') {
      const all = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000, archived: 'include', excludeVersionRows: true })).items;
      // Keep ONLY the manifest + readme (so the workspace shell renders) plus the archived content.
      // NB: must match the manifest/readme EXACTLY, not a `meta.` prefix — an objectType namespace can
      // itself start with `meta.` (e.g. `meta.goals`), and a prefix filter would leak ACTIVE content
      // from those spaces into the archived-only view.
      items = archived === 'only'
        ? all.filter(r => r.archived || r.key === `${nsRoot}meta.manifest` || r.key === `${nsRoot}meta.readme`)
        : all;
    } else {
      items = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000, excludeVersionRows: true })).items;
    }
    const manRec = items.find(r => r.key === `${nsRoot}meta.manifest`);
    let canReadWorkspace = false;
    if (manRec) {
      canReadWorkspace = isOrgManager || manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
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
    } catch (err) {
      /* best-effort: leave todos empty if the task store is unavailable */
      logger.warn('withMeta: continuing after a suppressed failure', { error: String(err) });
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

  /* ── GET /v1/organisms/:id/instruction-block — the paste-into-your-AI's-instructions block ──
   * Generated from the organism's REAL structure (id, name, its actual workspaces and their
   * spaces), never from a template: an AI that reads it knows where things live before it asks,
   * which is the whole point. Three formats for three paste targets (CLAUDE.md, AGENTS.md, the
   * chat's own instructions field) plus where each one goes. Same membership gate as /overview.
   * ?lang=en|fi, ?format=txt → the chat-instructions variant as raw text. */
  router.get('/v1/organisms/:id/instruction-block', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerSub = req.auth!.sub;
    const ownerName = req.auth!.owner;
    let isMember = !!callerSub && organism.agentGaiis.includes(callerSub);
    if (!isMember && ownerName) { const m = await storage.getMembership(id, ownerName); isMember = !!m && m.status === 'active'; }
    if (!isMember) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    // Active workspaces only: an archived one is not where the next piece of work should land.
    const wss = (await listWorkspaces(storage, id)).filter(w => !w.archived);
    const workspaces = [];
    for (const w of wss) {
      // Per-workspace summary rather than the registry name alone, so the block carries the
      // spaces an agent will actually write into. Unreadable workspaces are listed by name only.
      const s = await collectWorkspaceSummary(storage, config, { orgId: id, ws: w.id, name: w.name, viewerGaii });
      workspaces.push({
        id: w.id,
        name: s.name,
        description: s.readme ? s.readme.replace(/[#*`>\r\n]+/g, ' ').trim().slice(0, 140) : undefined,
        spaces: s.spaces.map(sp => sp.name),
      });
    }
    const blocks = buildInstructionBlocks(config, { orgId: id, orgName: organism.name || id, workspaces }, { lang });
    if (req.query.format === 'txt') { res.type('text/plain; charset=utf-8').send(blocks.chatInstructions); return; }
    res.json(success(config.nodeId, {
      organism_id: id,
      organism_name: organism.name || id,
      lang,
      workspaces,
      blocks: {
        claude_md: blocks.claudeMd,
        agents_md: blocks.agentsMd,
        chat_instructions: blocks.chatInstructions,
      },
      placement: blocks.placement,
    }, [
      { description: 'The full organism overview this block is generated from', method: 'GET', url: `/v1/organisms/${id}/overview` },
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
    await updateOrganismStructure(storage, config, id, { event: 'viewed', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(err => { logger.warn('GET /v1/organisms/:id/structure/history: best-effort', { error: String(err) }); });

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
  /* An APP grant carries role 'app', which satisfies neither 'owner' nor 'agent', so a board
   * rendering its own workspace record could read the thread and never add to it. organism:write
   * is the right key: it is already in APP_GRANTABLE_SCOPES and it already lets a granted app
   * write the RECORD itself, so refusing it a comment on that record protected nothing. The
   * membership gate below is unchanged and still decides who may comment where. */
  router.post('/v1/organisms/:id/comments', requireAuth(), requireRoleOrScope('agent', 'organism:write'), async (req, res) => {
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
}
