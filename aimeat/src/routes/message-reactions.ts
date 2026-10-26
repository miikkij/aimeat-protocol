/**
 * @file src/routes/message-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Acknowledgement marks on a single direct message (services/message-reactions.ts, which
 *   also backs aimeat_dm_react):
 *     POST   /v1/messages/:id/reactions   { reaction, as_owner? }        give a mark
 *     DELETE /v1/messages/:id/reactions?reaction=…[&as_owner=true]      take your own back
 *
 *   WHO. The owner in person, a published app acting for the person, or an agent as itself on a
 *   message it is a party to, all on messages:send. `as_owner` lets an agent mark in its owner's name
 *   on messages:send-as-owner, as group chat's `as_owner` does (reactionActor decides, for every door).
 *   A message the caller holds no copy of answers 404, as reading it does.
 * @structure registerMessageReactionRoutes(router, config, storage, peers)
 * @usage registerMessageReactionRoutes(router, config, storage, peers); (from routes/messages.ts)
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireLocalSession, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { reactToMessage, reactionActor } from '../services/message-reactions.js';

export function registerMessageReactionRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
  const ctx = { config, storage, peers };

  /** The one answer both doors give, after each read its own fields. */
  const respond = async (req: Request, res: Response, input: { reaction: unknown; asOwner: boolean; remove: boolean }) => {
    const actor = reactionActor(callerOf(req, config.nodeId, storage), input.asOwner);
    if ('refused' in actor) {
      res.status(403).json(error(config.nodeId, actor.code, actor.refused));
      return;
    }
    const out = await reactToMessage(ctx, actor, { messageId: req.params.id as string, reaction: input.reaction, remove: input.remove });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.status(input.remove || !out.changed ? 200 : 201).json(success(config.nodeId, {
      message_id: out.messageId, reaction: String(input.reaction).trim(), removed: input.remove, changed: out.changed, reactions: out.reactions,
    }));
  };

  router.post('/v1/messages/:id/reactions', requireAuth(), requireLocalSession(), requireScope('messages:send'), async (req, res) => {
    const { reaction, as_owner } = req.body ?? {};
    await respond(req, res, { reaction, asOwner: as_owner === true, remove: false });
  });

  router.delete('/v1/messages/:id/reactions', requireAuth(), requireLocalSession(), requireScope('messages:send'), async (req, res) => {
    await respond(req, res, { reaction: req.query.reaction, asOwner: req.query.as_owner === 'true', remove: true });
  });
}
