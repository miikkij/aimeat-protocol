import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';

/**
 * Portal API — JSON endpoints extracted from the former SSR portal.
 * Currently contains only POST /v1/portal/try-memory (anonymous memory save).
 */
export function portalApiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.post('/v1/portal/try-memory', requireAuth(), async (req, res) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || text.length > 280) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 280 chars)'));
      return;
    }

    const gaii = resolveIdentity(req.auth!, config.nodeId);
    const rawKey = req.body?.boardKey;
    const boardKey = (typeof rawKey === 'string' && /^board\.[a-z][a-z0-9._-]{0,60}$/.test(rawKey))
      ? rawKey
      : 'board.public';

    // Read existing board
    const existing = await storage.getMemory(gaii, boardKey);
    const val = existing?.value as Record<string, unknown> | undefined;
    let messages: { msg: string; t: string }[] = [];
    if (val?.messages && Array.isArray(val.messages)) {
      messages = val.messages as { msg: string; t: string }[];
    }

    // Append new message, keep last 20
    messages.push({ msg: text, t: new Date().toISOString() });
    if (messages.length > 20) messages = messages.slice(-20);

    // Write back
    await storage.setMemory({
      key: boardKey,
      ownerGaii: gaii,
      value: { messages },
      visibility: 'public',
      tags: ['board'],
      ttlHours: 72,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { posted: true, count: messages.length }));
  });

  return router;
}
