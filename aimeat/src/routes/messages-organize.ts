/**
 * @file messages-organize.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST doors for how an owner organises their own Messages list: read the settings and
 *   rules, change them, and archive or restore conversations. The list itself stays at
 *   GET /v1/messages/conversations and /overview, which compose it with what is decided here.
 * @structure
 *   - GET  /v1/messages/organize          -- auto-archive, subject folding, rules, archive counts
 *   - PUT  /v1/messages/organize          -- change them (rules replace; add_rule / remove_rule edit)
 *   - POST /v1/messages/organize/archive  -- archive conversations, or restore them with `restore: true`
 * @usage import { messagesOrganizeRouter } from '../routes/messages-organize.js'; app.use(messagesOrganizeRouter(config, storage));
 *
 *   WHO. The owner in person, and anything acting in their name that holds `messages:organize-as-owner`:
 *   an agent asked "archive those coordination threads", or an app the owner granted the word. That
 *   word is outside every wildcard (utils/scope-coverage.ts), because archiving is how a message stops
 *   being seen, and "Full access" is one click nobody makes to decide that. The mailbox is always the
 *   acting principal's own owner, derived from the session (services/direct-message-delete.ts
 *   ownerMailbox); a session from another node is refused before any of it.
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Initial, with the Messages list's sections, rules and archive.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { InboxArchiveSchema, InboxOrganizePatchSchema } from '../models/inbox-organize-schemas.js';
import { ownerMailbox } from '../services/direct-message-delete.js';
import {
  MESSAGES_ORGANIZE_AS_OWNER_SCOPE, archiveConversations, organizeView, readInboxOrganizeStrict, updateInboxOrganize,
} from '../services/inbox-organize/record.js';
import { logger } from '../utils/logger.js';

export function messagesOrganizeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const gate = [requireAuth(), requireLocalSession(), requireScope(MESSAGES_ORGANIZE_AS_OWNER_SCOPE)];
  const issues = (e: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
    e.issues.map(i => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');

  /** An agent changing what its owner is shown leaves no trace in the list itself, so the log does. */
  const audit = (req: Express.Request, what: string, detail: Record<string, unknown>) => {
    if (req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent') && !req.auth!.roles.includes('ecosystem')) return;
    logger.info('messages organised as owner (delegated)', { actor: req.auth!.sub, owner: ownerMailbox(req.auth!, config.nodeId), what, ...detail });
  };

  /* ── GET /v1/messages/organize ── */
  router.get('/v1/messages/organize', ...gate, async (req, res) => {
    const rec = await readInboxOrganizeStrict(storage, ownerMailbox(req.auth!, config.nodeId));
    res.json(success(config.nodeId, organizeView(rec), [
      { description: 'Change the settings or rules', method: 'PUT', url: '/v1/messages/organize' },
      { description: 'Archive or restore conversations', method: 'POST', url: '/v1/messages/organize/archive' },
    ]));
  });

  /* ── PUT /v1/messages/organize ── */
  router.put('/v1/messages/organize', ...gate, async (req, res) => {
    const parsed = InboxOrganizePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', issues(parsed.error)));
      return;
    }
    const result = await updateInboxOrganize(storage, ownerMailbox(req.auth!, config.nodeId), parsed.data);
    if (!result.ok) {
      res.status(result.code === 'NOT_FOUND' ? 404 : 400).json(error(config.nodeId, result.code, result.message));
      return;
    }
    audit(req, 'settings', { fields: Object.keys(parsed.data) });
    res.json(success(config.nodeId, organizeView(result.organize)));
  });

  /* ── POST /v1/messages/organize/archive ── */
  router.post('/v1/messages/organize/archive', ...gate, async (req, res) => {
    const parsed = InboxArchiveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', issues(parsed.error)));
      return;
    }
    const restore = parsed.data.restore === true;
    const { changed, organize } = await archiveConversations(storage, ownerMailbox(req.auth!, config.nodeId), parsed.data.conversation_ids, restore);
    audit(req, restore ? 'restore' : 'archive', { count: changed });
    res.json(success(config.nodeId, {
      [restore ? 'restored' : 'archived']: changed,
      conversation_ids: [...new Set(parsed.data.conversation_ids)],
      archived_count: Object.keys(organize.archived).length,
      note: restore
        ? 'Back in the list, and kept there: neither a rule nor the age limit archives these again on its own.'
        : 'In the archive. A conversation comes back by itself when somebody other than your own agents writes in it.',
    }, [
      { description: 'The list, with sections', method: 'GET', url: '/v1/messages/conversations' },
    ]));
  });

  return router;
}
