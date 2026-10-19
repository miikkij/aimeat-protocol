/**
 * @file src/routes/portal-api.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Small JSON API carried over from the removed SSR portal. Currently exposes
 *   POST /v1/portal/try-memory — an authenticated append to a public "board" memory key that keeps only
 *   the last 20 messages with a 72h TTL, used by the try-it demo surface.
 *
 * @structure
 *   - portalApiRouter(config, storage): builds the Express router
 *   - POST /v1/portal/try-memory: validate text (<=280 chars) + boardKey, append message, cap at 20, write back
 *
 * @version-history
 *   v1.1.0 — 2026-10-19 — The append is written on the board's version (updateRecord)
 *     (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { updateRecord } from '../services/record-cas.js';

/**
 * Portal API — JSON endpoints extracted from the former SSR portal.
 * Currently contains only POST /v1/portal/try-memory (anonymous memory save).
 */
export function portalApiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.post('/v1/portal/try-memory', requireAuth(), requireScope('memory:write'), async (req, res) => {
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

    // Append the new message and keep the last 20, on the board's version: a message another post
    // appended meanwhile stays.
    const message = { msg: text, t: new Date().toISOString() };
    const board = await updateRecord(storage, gaii, boardKey,
      (v) => {
        const messages = (v as Record<string, unknown> | undefined)?.messages;
        return { messages: Array.isArray(messages) ? [...messages as { msg: string; t: string }[]] : [] };
      },
      (cur) => ({ messages: [...cur.messages, message].slice(-20) }),
      { tag: 'board', visibility: 'public', ttlHours: 72 });

    res.json(success(config.nodeId, { posted: true, count: board.messages.length }));
  });

  return router;
}
