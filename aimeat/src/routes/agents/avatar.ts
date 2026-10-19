/**
 * @file src/routes/agents/avatar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's picture: served as an image, and set or removed by the owner or the agent
 *   itself. The picture is the `agent.avatar` memory record in the agent's own namespace
 *   (services/agent-avatar.ts); an agent normally sets it with aimeat_memory_write and needs nothing
 *   here except the GET.
 *
 *   - GET /v1/agents/:gaii/avatar.svg — the picture, to anyone. An emoji avatar is drawn as an SVG,
 *     so the one address answers for both kinds (an A2A card's iconUrl, an <img> on any page).
 *     `?v=<version>` that matches the record is cached for good, because a new picture has a new
 *     version and so a new address.
 *   - PUT /v1/agents/:name/avatar { emoji } | { svg } — the owner in person, for an agent of theirs,
 *     or the agent for itself. Writes the same record through the shared memory writer.
 *   - DELETE /v1/agents/:name/avatar — the same two callers.
 * @structure registerAvatarRoutes(router, config, storage)
 * @usage registerAvatarRoutes(router, config, storage);   // in routes/agents.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */
import { createHash } from 'node:crypto';
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { callerOf } from '../../middleware/caller.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII } from '../../utils/gaii.js';
import { writeMemoryRecord } from '../../services/memory-write.js';
import { emitChange, emitRecordChange } from '../../services/event-bus.js';
import {
  AVATAR_KEY, AVATAR_SVG_HEADERS, avatarView, emojiAsSvg, parseAvatarValue, readAvatar,
} from '../../services/agent-avatar.js';

/** The agent a `:name` path names (a bare name is the caller's owner's), and whether this caller may change its picture. */
async function targetFor(req: Request, config: AimeatConfig, storage: Storage):
    Promise<{ ok: true; agent: AgentRecord; principal: string } | { ok: false; status: number; code: string; message: string }> {
  const identifier = req.params.name as string;
  const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
  const agent = await storage.getAgent(gaii);
  if (!agent) return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
  const caller = callerOf(req, config.nodeId, storage);
  // The agent itself, or the account holder in person for an agent of theirs. A sibling agent, an
  // app grant and a visitor change no other agent's face.
  const self = caller.principal === agent.gaii;
  const owner = caller.inPerson && !caller.visitor && agent.owner === caller.owner;
  if (!self && !owner) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the agent itself or its owner sets its picture.' };
  }
  return { ok: true, agent, principal: caller.principal };
}

export function registerAvatarRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  router.get('/v1/agents/:gaii/avatar.svg', async (req, res) => {
    const gaii = req.params.gaii as string;
    const { record, parsed } = await readAvatar(storage, gaii);
    if (!record || !parsed || !parsed.ok) {
      res.status(404).json(error(config.nodeId, 'AVATAR_NOT_FOUND',
        parsed && !parsed.ok ? `This agent's avatar cannot be shown: ${parsed.problem}` : `No avatar for ${gaii}.`));
      return;
    }
    const body = parsed.kind === 'svg' ? parsed.svg : emojiAsSvg(parsed.emoji);
    const etag = `"${createHash('sha256').update(gaii).digest('hex').slice(0, 16)}-${record.version}"`;
    for (const [k, v] of Object.entries(AVATAR_SVG_HEADERS)) res.setHeader(k, v);
    res.setHeader('ETag', etag);
    // The address with the current version never changes meaning, so it is cached for good; any
    // other address (no version, or an old one) is revalidated after five minutes.
    res.setHeader('Cache-Control', String(req.query.v) === String(record.version)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300');
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    res.send(body);
  });

  // memory:write, because the picture is a memory record. The owner in person passes on the role; an
  // agent setting its own needs the word its memory write would need anyway; an app grant that holds
  // it is still refused below, because it is neither the agent nor the owner in person.
  router.put('/v1/agents/:name/avatar', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const target = await targetFor(req, config, storage);
    if (!target.ok) { res.status(target.status).json(error(config.nodeId, target.code, target.message)); return; }
    const parsed = parseAvatarValue(req.body);
    if (!parsed.ok) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.problem)); return; }
    const caller = callerOf(req, config.nodeId, storage);
    // Through the shared memory writer, so the value ceiling, the key ceiling, the quota and the
    // provenance stamp apply exactly as they do to aimeat_memory_write. The record is public by
    // design (services/agent-avatar.ts), so the publish gate is not asked, as for an offers document.
    const written = await writeMemoryRecord({ storage, config }, {
      ...caller.principalView,
      targetGaii: target.agent.gaii,
      federated: caller.visitor,
    }, {
      key: AVATAR_KEY,
      value: parsed.kind === 'svg' ? { svg: parsed.svg } : { emoji: parsed.emoji },
      visibility: 'public',
      tags: [],
      pipeline: 'rest.agent_avatar',
    });
    if (!written.ok) {
      res.status(written.status ?? 400).json(error(config.nodeId, written.code, written.message));
      return;
    }
    emitChange('agents');
    res.json(success(config.nodeId, {
      gaii: target.agent.gaii,
      name: target.agent.name,
      avatar: avatarView(target.agent.gaii, written.record),
    }, [
      { description: 'The picture', method: 'GET', url: `/v1/agents/${encodeURIComponent(target.agent.gaii)}/avatar.svg` },
    ]));
  });

  router.delete('/v1/agents/:name/avatar', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const target = await targetFor(req, config, storage);
    if (!target.ok) { res.status(target.status).json(error(config.nodeId, target.code, target.message)); return; }
    // A direct storage delete: the key is fixed and not a server-owned, secret or workspace key, so
    // none of the memory bin's refusals (services/memory-bin.ts binRefusal) can apply to it, and the
    // caller was decided above. The record goes to the bin like any other, restorable in its window.
    const existing = await storage.getMemory(target.agent.gaii, AVATAR_KEY);
    const removed = existing ? await storage.deleteMemory(target.agent.gaii, AVATAR_KEY, target.principal) : false;
    if (removed) {
      emitRecordChange('memory', target.agent.gaii, existing!.visibility);
      emitChange('agents');
    }
    res.json(success(config.nodeId, { gaii: target.agent.gaii, name: target.agent.name, removed, avatar: null }));
  });
}
