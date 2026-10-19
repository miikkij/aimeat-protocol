/**
 * @file src/routes/agents/permission-allow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two routes behind the allow page (/v1/allow?agent=<name>&need=<words>,
 *   public/views/agent-allow.js): GET /v1/agents/:name/allow reads what the agent asks for, and
 *   POST /v1/agents/:name/allow gives it.
 *
 *   WHY. An agent that lacks a permission hands its person one address (services/permission-ask.ts)
 *   instead of the name of a permission she cannot act on. Behind the address is one question and one
 *   press. The bell's Allow button (services/permission-ask-notice.ts) calls the same POST.
 *
 *   WHO. The owner in person, and nothing acting in their name: an agent that could press Allow would
 *   give itself permissions, which PATCH /v1/agents/:name/scopes refuses for the same reason
 *   (SCOPE_ADDITION_REFUSED). requireOwnerPrincipal() keeps out apps, visitors and ordinary agents,
 *   and callerOf().inPerson then also refuses an agent holding account:security, which
 *   requireOwnerPrincipal admits.
 *
 *   WHAT ONE PRESS GIVES. Only words the person may give that way (isOneClickWord): "Full access"
 *   carries them and the node does not call them powerful. A word outside every wildcard or a
 *   powerful one is refused with the agent's page, where it has its own tick, and the node's ceiling
 *   for agents (config.maxAgentScopes) holds as it does on PATCH.
 *
 *   ADDITIVE AND IDEMPOTENT. The POST adds what the agent does not hold yet and touches nothing else,
 *   so a button made hours ago (the bell, the email) is never stale: PATCH replaces the whole list and
 *   a list baked into a button would undo what the person changed since. A word already held is
 *   answered `added: []`.
 * @structure registerPermissionAllowRoutes(router, config, storage)
 * @usage registerPermissionAllowRoutes(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-10-19 — The `agent` object carries the agent's `avatar` (services/agent-avatar.ts), null when it has none.
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { emitChange } from '../../services/event-bus.js';
import { scopeIsCovered, exceedsCeiling } from '../../utils/scope-coverage.js';
import { isOneClickWord, agentPageUrl } from '../../services/permission-ask.js';
import { announceScopes } from './announce-scopes.js';
import { readAvatarsOrEmpty } from '../../services/agent-avatar.js';
import { logger } from '../../utils/logger.js';

const IN_PERSON = 'Only you, signed in yourself, can allow what your agents may do.';
const MAX_WORDS = 20;

/** The words of `need` (comma-separated in a query, an array in a body), trimmed and unique. */
function wordsOf(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!list || !list.every((w) => typeof w === 'string')) return null;
  const words = [...new Set((list as string[]).map((w) => w.trim()).filter(Boolean))];
  return words.length > 0 && words.length <= MAX_WORDS && words.every((w) => /^[a-z*][a-z0-9:*_-]*$/.test(w)) ? words : null;
}

export function registerPermissionAllowRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  /** The owner's agent by name, or an answer already sent. */
  async function ownAgent(req: Request, res: Response): Promise<AgentRecord | null> {
    if (!callerOf(req, config.nodeId, storage).inPerson) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', IN_PERSON));
      return null;
    }
    const name = req.params.name as string;
    const agent = (await storage.getAgentsByOwner(req.auth!.owner)).find((a) => a.name === name);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `You have no agent called "${name}".`));
      return null;
    }
    return agent;
  }

  const view = async (agent: AgentRecord, words: string[]) => {
    const held = agent.defaultScopes ?? [];
    const avatars = await readAvatarsOrEmpty(storage, [agent.gaii], logger.warn.bind(logger), 'GET /v1/agents/:name/allow');
    return {
      agent: { name: agent.name, gaii: agent.gaii, display_name: agent.displayName || agent.name, avatar: avatars.get(agent.gaii) ?? null },
      words: words.map((w) => ({ scope: w, held: scopeIsCovered(held, w), one_press: isOneClickWord(w) })),
      agent_page: agentPageUrl(config.baseUrl, agent.name),
    };
  };

  // GET /v1/agents/:name/allow?need=a,b — what the allow page shows: each word, whether the agent
  // holds it already, and whether one press may give it.
  router.get('/v1/agents/:name/allow', requireAuth(), requireOwnerPrincipal(IN_PERSON), async (req, res) => {
    const words = wordsOf(req.query.need);
    if (!words) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `need is a comma-separated list of 1 to ${MAX_WORDS} permissions.`));
      return;
    }
    const agent = await ownAgent(req, res);
    if (!agent) return;
    res.json(success(config.nodeId, await view(agent, words)));
  });

  // POST /v1/agents/:name/allow { scopes } — give these to the agent, adding to what it holds.
  router.post('/v1/agents/:name/allow', requireAuth(), requireOwnerPrincipal(IN_PERSON), async (req, res) => {
    const words = wordsOf(req.body?.scopes);
    if (!words) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `scopes is a list of 1 to ${MAX_WORDS} permissions.`));
      return;
    }
    const agent = await ownAgent(req, res);
    if (!agent) return;
    const notOnePress = words.filter((w) => !isOneClickWord(w));
    if (notOnePress.length > 0) {
      const page = agentPageUrl(config.baseUrl, agent.name);
      res.status(400).json(error(config.nodeId, 'NEEDS_AGENT_PAGE',
        "You allow this on your agent's own page, where it has a tick of its own.", 400,
        { scopes: notOnePress, agent_page: page },
        [{ description: "Open the agent's page and tick it there", method: 'GET', url: page }]));
      return;
    }
    if (exceedsCeiling(config.maxAgentScopes, words).length > 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', 'This node does not let agents do that. Ask whoever runs it.'));
      return;
    }
    const held = agent.defaultScopes ?? [];
    const added = words.filter((w) => !scopeIsCovered(held, w));
    if (added.length === 0) {
      res.json(success(config.nodeId, { ...(await view(agent, words)), added: [] }));
      return;
    }
    const updated = await storage.updateAgent(agent.gaii, { defaultScopes: [...held, ...added] });
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'This one is on us: the permission could not be saved. It is already reported; try again in a moment.'));
      return;
    }
    announceScopes(updated.gaii);
    emitChange('agents');
    res.json(success(config.nodeId, { ...(await view(updated, words)), added }));
  });
}
