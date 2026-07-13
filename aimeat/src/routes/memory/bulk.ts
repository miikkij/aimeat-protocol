/**
 * @file src/routes/memory/bulk.ts
 * @description Bulk + cross-user memory routes: export, import, bulk-delete, bundle (ZIP), discover, copy. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router } from 'express';
import { ZipArchive } from 'archiver';
import type { MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { checkMemoryQuota } from '../../services/quota.js';
import { validateMemoryWrite } from '../../services/schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { emitChange, emitMemoryWritten } from '../../services/event-bus.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { listOwnerScopeMemory } from '../../services/owner-memory.js';
import { type MemoryRouteCtx, isAnonymousGaii } from './shared.js';

export function registerBulkRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, stats, resolve } = ctx;

  // GET /v1/memory/export — download all of the caller's memory entries (full values) as a JSON
  // backup. Owner sessions export across their GHII + agents + ecosystem apps (owner-scope); agent
  // sessions export their own keyspace. Optional ?prefix= scopes the export to one namespace.
  router.get('/v1/memory/export', requireAuth(), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let gaii = req.auth!.sub;
    const agentParam = req.query.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only export memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }
    const prefix = req.query.prefix as string | undefined;

    let records: MemoryRecord[];
    if (isOwnerSession && !agentParam) {
      records = await listOwnerScopeMemory(storage, config.nodeId, req.auth!.owner, { prefix });
    } else {
      records = await storage.listMemory(gaii, { prefix });
    }

    res.json(success(config.nodeId, {
      exported_at: new Date().toISOString(),
      node_id: config.nodeId,
      count: records.length,
      entries: records.map(r => ({
        key: r.key,
        value: r.value,
        visibility: r.visibility,
        tags: r.tags,
        ...(r.ttlHours != null ? { ttl_hours: r.ttlHours } : {}),
      })),
    }));
  });

  // POST /v1/memory/import — restore/merge a JSON backup produced by /v1/memory/export.
  // body: { entries: [{ key, value, visibility?, tags?, ttl_hours? }], mode?, agent? }
  //   mode = 'skip' (default) | 'overwrite' | 'rename' — how to resolve a key that already exists.
  // Per-entry validation/quota/schema mirror POST /v1/memory; one bad entry doesn't abort the run.
  router.post('/v1/memory/import', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const body = req.body ?? {};
    const entries = Array.isArray(body.entries) ? body.entries : null;
    const mode = (['skip', 'overwrite', 'rename'].includes(body.mode) ? body.mode : 'skip') as 'skip' | 'overwrite' | 'rename';
    if (!entries) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'entries array is required'));
      return;
    }

    // Resolve target identity (owner sessions may target one of their agents via ?agent / body.agent)
    let gaii = resolve(req);
    const agentParam = body.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may import under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only import memory to your own agents'));
        return;
      }
      gaii = agentParam;
    }

    const MAX_KEYS_PER_AGENT = config.memoryMaxKeysPerAgent;
    const MAX_VALUE_SIZE = config.memoryMaxValueSizeKb * 1024;
    let keyCount = (await storage.listMemory(gaii)).length;

    const summary = { created: 0, updated: 0, skipped: 0, failed: [] as { key: string; reason: string }[] };

    for (const entry of entries) {
      const key = entry?.key;
      if (typeof key !== 'string' || !key) { summary.failed.push({ key: String(key), reason: 'missing key' }); continue; }
      // Reserved-key guard (DNA invariant #2): apps may not import server-trusted owner keys.
      if (!appMayWriteKey(req.auth!.roles, key)) { summary.failed.push({ key, reason: 'reserved key — managed by the account owner' }); continue; }
      try {
        if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
          summary.failed.push({ key, reason: 'anonymous agents can only write anonymous.* keys' }); continue;
        }
        const valueSize = Buffer.byteLength(JSON.stringify(entry.value), 'utf8');
        if (valueSize > MAX_VALUE_SIZE) { summary.failed.push({ key, reason: 'value too large' }); continue; }

        let targetKey = key;
        const existing = await storage.getMemory(gaii, key);
        if (existing) {
          if (mode === 'skip') { summary.skipped++; continue; }
          if (mode === 'rename') {
            let n = 1;
            while (await storage.getMemory(gaii, `${key}-imported${n > 1 ? '-' + n : ''}`)) n++;
            targetKey = `${key}-imported${n > 1 ? '-' + n : ''}`;
          }
          // mode === 'overwrite' falls through with targetKey === key
        }

        const isNewKey = targetKey === key ? !existing : true;
        if (isNewKey && keyCount >= MAX_KEYS_PER_AGENT) { summary.failed.push({ key, reason: 'key quota reached' }); continue; }

        const validation = await validateMemoryWrite(targetKey, entry.value, storage);
        if (!validation.valid) { summary.failed.push({ key: targetKey, reason: 'schema validation failed' }); continue; }

        const now = new Date().toISOString();
        const prior = targetKey === key ? existing : null;
        await storage.setMemory({
          key: targetKey,
          ownerGaii: gaii,
          value: entry.value,
          visibility: (['private', 'owner', 'group', 'members', 'public'].includes(entry.visibility) ? entry.visibility : 'private') as MemoryRecord['visibility'],
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          ttlHours: typeof entry.ttl_hours === 'number' ? entry.ttl_hours : null,
          version: prior ? prior.version + 1 : 1,
          createdAt: prior?.createdAt ?? now,
          updatedAt: now,
        });
        if (prior) summary.updated++; else { summary.created++; keyCount++; }
        emitMemoryWritten(gaii, targetKey, prior ? 'updated' : 'created');
      } catch (e) {
        summary.failed.push({ key, reason: String(e instanceof Error ? e.message : e) });
      }
    }

    emitResourceListChanged(gaii);
    emitChange('memory');
    res.json(success(config.nodeId, summary));
  });

  // POST /v1/memory/bulk-delete — delete many entries at once by { prefix } and/or { keys }.
  // Avoids firing 1000+ individual DELETE requests when clearing a whole namespace (e.g. an old
  // organism). Owner sessions delete across their owner-scope (records keep their writer's gaii);
  // agent sessions delete from their own keyspace.
  router.post('/v1/memory/bulk-delete', requireAuth(), requireScope('memory:delete'), async (req, res) => {
    const body = req.body ?? {};
    const prefix = typeof body.prefix === 'string' && body.prefix ? body.prefix : undefined;
    const keys = Array.isArray(body.keys) ? new Set(body.keys.filter((k: unknown): k is string => typeof k === 'string')) : undefined;
    if (!prefix && (!keys || keys.size === 0)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'prefix or keys is required'));
      return;
    }

    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let gaii = resolve(req);
    const agentParam = body.agent as string | undefined;
    if (agentParam && agentParam !== gaii) {
      if (!isOwnerSession) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owner sessions may bulk-delete under a specific agent'));
        return;
      }
      const targetAgent = await storage.getAgent(agentParam);
      if (!targetAgent || targetAgent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only delete memory of your own agents'));
        return;
      }
      gaii = agentParam;
    }

    // Gather candidate records (owner-scope keeps each record's writer gaii so we delete from the right keyspace).
    const records = (isOwnerSession && !agentParam)
      ? await listOwnerScopeMemory(storage, config.nodeId, req.auth!.owner, { prefix })
      : await storage.listMemory(gaii, { prefix });

    let deleted = 0;
    for (const r of records) {
      if (keys && !keys.has(r.key)) continue;
      if (await storage.deleteMemory(r.ownerGaii, r.key)) {
        deleted++;
        emitResourceUpdated(r.ownerGaii, `aimeat://memory/${encodeURIComponent(r.key)}`);
      }
    }
    if (deleted > 0) { emitResourceListChanged(gaii); emitChange('memory'); }
    res.json(success(config.nodeId, { deleted }));
  });

  // POST /v1/memory/bundle — download a ZIP of selected memory values + storage files (+ a manifest).
  // Backs the "collection cart" export: a pointer-free bundle of the caller's OWN data (GHII + owned
  // agents). Each item must be owned by the caller or one of their agents; anything else is skipped
  // and recorded in manifest.json. Body: { items: [{ kind:'memory'|'file', key, owner_gaii? }] }.
  router.post('/v1/memory/bundle', requireAuth(), async (req, res) => {
    const body = req.body ?? {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'items is required (non-empty array)'));
      return;
    }
    if (items.length > 500) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A bundle may contain at most 500 items'));
      return;
    }

    // Allowed owners = the caller's own identity + (owner sessions only) their agents' GAIIs.
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const callerGaii = resolve(req);
    const allowed = new Set<string>([callerGaii]);
    if (isOwnerSession) {
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      for (const a of agents) allowed.add(a.gaii);
    }

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('error', (err: Error) => {
      if (!res.headersSent) res.status(500).json(error(config.nodeId, 'ZIP_ERROR', `Failed to build bundle: ${err.message}`));
    });
    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const stamp = new Date().toISOString().slice(0, 10);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="aimeat-collection-${stamp}.zip"`,
        'Content-Length': String(buffer.length),
      });
      res.send(buffer);
    });

    // Keep zip entry names inside the archive root (strip leading slashes and any '..' traversal).
    const sanitize = (k: string) => String(k).replace(/\\/g, '/').replace(/\.\.+/g, '.').replace(/^\/+/, '');
    const encKeyPath = (k: string) => k.split('/').map(encodeURIComponent).join('/');
    const manifest: { generated_at: string; node_id: string; items: Array<Record<string, unknown>> } = {
      generated_at: new Date().toISOString(), node_id: config.nodeId, items: [],
    };
    const seen = new Set<string>();

    for (const raw of items) {
      const kind = raw?.kind === 'file' ? 'file' : raw?.kind === 'memory' ? 'memory' : null;
      const key = typeof raw?.key === 'string' && raw.key ? raw.key : null;
      const owner = typeof raw?.owner_gaii === 'string' && raw.owner_gaii ? raw.owner_gaii : callerGaii;
      if (!kind || !key) { manifest.items.push({ kind: raw?.kind ?? null, key: raw?.key ?? null, included: false, reason: 'invalid' }); continue; }
      const dedup = `${kind}:${owner}:${key}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      if (!allowed.has(owner)) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_owned' }); continue; }
      try {
        if (kind === 'file') {
          const file = await storage.getStorageFile(owner, key);
          if (!file) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_found' }); continue; }
          archive.append(file.data as Buffer, { name: `files/${sanitize(key)}` });
          manifest.items.push({ kind, key, owner_gaii: owner, included: true, mime_type: file.mimeType, size: file.size, url: `${config.baseUrl}/v1/pub/${encodeURIComponent(owner)}/${encKeyPath(key)}` });
        } else {
          const record = await storage.getMemory(owner, key);
          if (!record) { manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'not_found' }); continue; }
          const content = typeof record.value === 'string' ? record.value : JSON.stringify(record.value, null, 2);
          archive.append(content, { name: `memory/${sanitize(key)}.json` });
          manifest.items.push({ kind, key, owner_gaii: owner, included: true, visibility: record.visibility, url: `${config.baseUrl}/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}` });
        }
      } catch {
        manifest.items.push({ kind, key, owner_gaii: owner, included: false, reason: 'error' });
      }
    }

    const included = manifest.items.filter(i => i.included).length;
    if (included === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No accessible items to bundle'));
      return;
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.finalize();
  });

  // GET /v1/memory/discover — browse public memory entries across all users on this node
  router.get('/v1/memory/discover', requireAuth(), async (req, res) => {
    const prefix = req.query.prefix as string | undefined;
    const owner = req.query.owner as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const callerGaii = resolve(req);

    const result = await storage.listAllMemory({
      prefix: prefix || undefined,
      ownerPrefix: owner || undefined,
      visibility: 'public',
      limit,
      offset,
    });

    // Filter out the caller's own entries and apply text search if provided
    let items = result.items.filter(m => m.ownerGaii !== callerGaii);
    if (q) {
      const lq = q.toLowerCase();
      items = items.filter(m =>
        m.key.toLowerCase().includes(lq) ||
        (m.ownerGaii && m.ownerGaii.toLowerCase().includes(lq)) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(lq)))
      );
    }

    stats?.increment('memory_discover');

    res.json(success(config.nodeId, {
      items: items.map(m => ({
        key: m.key,
        owner_gaii: m.ownerGaii,
        visibility: m.visibility,
        tags: m.tags,
        version: m.version,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      })),
      total: items.length,
      limit,
      offset,
    }));
  });

  // POST /v1/memory/copy — copy a public memory entry from another user to your own memory
  router.post('/v1/memory/copy', requireAuth(), requireRole('agent'), requireScope('memory:write'), async (req, res) => {
    const callerGaii = resolve(req);
    const { source_gaii, key, visibility: targetVis } = req.body as {
      source_gaii: string; key: string; visibility?: string;
    };

    if (!source_gaii || !key) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_gaii and key are required'));
      return;
    }

    const sourceRecord = await storage.getMemory(source_gaii, key);
    if (!sourceRecord || sourceRecord.visibility !== 'public') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Public memory entry not found'));
      return;
    }

    const sourceBytes = Buffer.byteLength(JSON.stringify(sourceRecord.value), 'utf8');
    const quotaCheck = await checkMemoryQuota(config, storage, callerGaii, sourceBytes);
    if (!quotaCheck.allowed) {
      res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', quotaCheck.reason!));
      return;
    }

    const now = new Date().toISOString();
    const existing = await storage.getMemory(callerGaii, key);
    const newVersion = existing ? existing.version + 1 : 1;

    await storage.setMemory({
      key,
      ownerGaii: callerGaii,
      value: sourceRecord.value,
      visibility: (targetVis as MemoryRecord['visibility']) || 'private',
      tags: sourceRecord.tags || [],
      ttlHours: null,
      version: newVersion,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    emitResourceUpdated(callerGaii, `aimeat://memory/${encodeURIComponent(key)}`);
    emitResourceListChanged(callerGaii);

    res.json(success(config.nodeId, {
      key,
      copied_from: source_gaii,
      version: newVersion,
    }));
    emitChange('memory');
  });
}
