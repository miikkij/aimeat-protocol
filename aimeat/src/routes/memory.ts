import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function memoryRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/memory — write a memory entry (agent auth required)
  router.post('/v1/memory', requireAuth(), requireRole('agent'), async (req, res) => {
    const { key, value, visibility, tags, ttl_hours } = req.body ?? {};

    if (!key || value === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key and value are required'));
      return;
    }

    if (typeof key !== 'string' || key.length > 256) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key must be a string of 256 characters or fewer'));
      return;
    }

    const validVisibility = ['private', 'owner', 'public'];
    const vis = visibility ?? 'private';
    if (!validVisibility.includes(vis)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `visibility must be one of: ${validVisibility.join(', ')}`));
      return;
    }

    const now = new Date().toISOString();
    const gaii = req.auth!.sub;

    const existing = await storage.getMemory(gaii, key);

    const record = await storage.setMemory({
      key,
      ownerGaii: gaii,
      value,
      visibility: vis as 'private' | 'owner' | 'public',
      tags: Array.isArray(tags) ? tags : [],
      ttlHours: ttl_hours ?? null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    res.status(existing ? 200 : 201).json(success(config.nodeId, {
      key: record.key,
      visibility: record.visibility,
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Read this memory entry', method: 'GET', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'List all memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Delete this memory entry', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}` },
    ]));
  });

  // GET /v1/memory — list memory keys (agent auth required)
  router.get('/v1/memory', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const prefix = req.query.prefix as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    const tagsParam = req.query.tags as string | undefined;
    const tags = tagsParam ? tagsParam.split(',') : undefined;

    const records = await storage.listMemory(gaii, { prefix, visibility, tags });

    res.json(success(config.nodeId, {
      items: records.map(r => ({
        key: r.key,
        visibility: r.visibility,
        tags: r.tags,
        version: r.version,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
      total: records.length,
    }, [
      {
        description: 'Write a new memory entry',
        method: 'POST',
        url: '/v1/memory',
        example_body: { key: 'example-key', value: 'example-value', visibility: 'private' },
      },
    ]));
  });

  // GET /v1/memory/:key — read a memory entry
  router.get('/v1/memory/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    res.json(success(config.nodeId, {
      key: record.key,
      value: record.value,
      visibility: record.visibility,
      tags: record.tags,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, [
      { description: 'Update this memory entry', method: 'POST', url: '/v1/memory', example_body: { key: record.key, value: '...new value...' } },
      { description: 'Delete this memory entry', method: 'DELETE', url: `/v1/memory/${encodeURIComponent(key)}` },
      { description: 'List all memory keys', method: 'GET', url: '/v1/memory' },
    ]));
  });

  // DELETE /v1/memory/:key — delete a memory entry
  router.delete('/v1/memory/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = decodeURIComponent(req.params.key as string);

    const deleted = await storage.deleteMemory(gaii, key);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${key}`));
      return;
    }

    res.json(success(config.nodeId, {
      deleted: true,
      key,
    }, [
      { description: 'List remaining memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Write a new memory entry', method: 'POST', url: '/v1/memory' },
    ]));
  });

  // GET /v1/memory/:gaii/:key — public memory read (no auth for public entries)
  // This allows Tier 0 access to public memory
  router.get('/v1/memory/:gaii/:key', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const key = decodeURIComponent(req.params.key as string);

    const record = await storage.getMemory(gaii, key);
    if (!record || record.visibility !== 'public') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
      return;
    }

    res.json(success(config.nodeId, {
      key: record.key,
      value: record.value,
      visibility: record.visibility,
      tags: record.tags,
      version: record.version,
      owner_gaii: record.ownerGaii,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }));
  });

  return router;
}
