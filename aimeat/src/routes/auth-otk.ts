/**
 * @file src/routes/auth-otk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Tier 0.5 one-time-key routes: POST /v1/auth/otk mints a key, GET /v1/otk/:key
 *   executes it with NO authentication, and POST /v1/auth/connectivity-key mints the registration
 *   key an agent onboards with (it sits between them in the original file and travels with them —
 *   it is the same "hand out a key, redeem it later" shape). Extracted from auth.ts by pure move to
 *   satisfy max-file-lines.
 *
 *   Tier 0.5 is DEPRECATED in RFC v4.0 and three of its write paths were deleted in 9723f018. This
 *   pair survives, so it is gated rather than trusted: because execution carries no credential, the
 *   mint is the only place a principal can be asked anything, and both gates live there.
 * @structure registerOtkRoutes(router, config, storage, sessions, inactivityMs)
 * @usage registerOtkRoutes(router, config, storage, sessions, SESSION_INACTIVITY_MS) from authRouter().
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Extracted from auth.ts (max-file-lines) as part of E2E test-quality
 *     audit finding A8, which gave the mint its scope gate and its reserved-key check and moved the
 *     execution onto the shared memory write.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { validateAgentName, buildGAII } from '../utils/gaii.js';
import { generateOtk } from '../utils/otk.js';
import { appMayWriteKey } from '../utils/reserved-keys.js';
import { writeMemoryRecord } from '../services/memory-write.js';

/** The session map authRouter owns — passed in rather than duplicated, so there is one store. */
export type OtkSessionMap = Map<string, { ownerGaii: string; lastActivity: number }>;

export function registerOtkRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  sessions: OtkSessionMap,
  SESSION_INACTIVITY_MS: number,
): void {

  // POST /v1/auth/otk — generate a one-time key for Tier 0.5 actions (agent auth).
  //
  // The KEY IS THE CREDENTIAL: GET /v1/otk/:key executes with no authentication at all, by design.
  // So everything about who may do this has to be decided HERE, where the principal is known, and
  // it was not: the mint carried requireAuth() alone. An app grant holding nothing but memory:read
  // minted `{action:'write_memory', params:{key:'openrouter.settings', …}}` and then executed it
  // unauthenticated, writing the very key services/ai-completion.ts reads before posting the
  // owner's decrypted AI key — reopening C-2, which utils/reserved-keys.ts exists to close, plus
  // `finance.accountants` and `ai-usage.*`. Two gates, both at the door that knows the answer:
  // the scope word below, and the reserved-key check on the parameters.
  router.post('/v1/auth/otk', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const { action, params } = req.body ?? {};
    if (!action) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action is required (e.g. write_memory, post_board)'));
      return;
    }

    const allowedActions = ['write_memory', 'post_board'];
    if (!allowedActions.includes(action)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `action must be one of: ${allowedActions.join(', ')}`));
      return;
    }

    // The execution is unauthenticated, so the reserved-key rule cannot be applied there — the roles
    // that decide it are gone by then. Applied here instead, against the minting principal.
    if (action === 'write_memory') {
      const target = (params as { key?: unknown } | undefined)?.key;
      if (typeof target === 'string' && !appMayWriteKey(req.auth!.roles, target)) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
          `"${target}" is written by the node, not by an app. An OTK cannot be minted for it.`));
        return;
      }
    }

    const key = generateOtk();
    const expiresAt = new Date(Date.now() + 600_000).toISOString(); // 10 minutes

    await storage.createOtk({
      key,
      ownerGaii: req.auth!.sub,
      action,
      params: params ?? {},
      expiresAt,
      initial: false,
      used: false,
      usedAt: null,
      sessionId: null,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      otk: key,
      action,
      expires_at: expiresAt,
      usage_url: `/v1/otk/${key}`,
      note: 'This key can be used once via GET request. Share with a Tier 0 agent to allow a single write operation.',
    }, [
      { description: 'Use this one-time key', method: 'GET', url: `/v1/otk/${key}` },
    ]));
  });

  // POST /v1/auth/initial-otk — generate an Initial OTK (timer starts on first use)
  // The OTK remains dormant until the AI first uses it. Once used, the grace period starts.
  // Ideal for embedding in prompts — the consumer can use it hours/days later.
  router.post('/v1/auth/initial-otk', requireAuth(), async (req, res) => {
    const key = generateOtk();
    // Far-future expiry — effectively no expiry until first use activates the timer
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

    await storage.createOtk({
      key,
      ownerGaii: req.auth!.sub,
      action: 'initial',
      params: {},
      expiresAt: farFuture,
      initial: true,
      used: false,
      usedAt: null,
      sessionId: null,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      otk: key,
      initial: true,
      grace_ms: config.otkGraceMs,
      note: `This is an Initial OTK. It has no expiry until first use. Once used, it remains valid for ${config.otkGraceMs / 1000} seconds. Embed it in prompts for AI agents.`,
      owner: req.auth!.sub,
    }, [
      { description: 'Use for micro-memory operations', method: 'GET', url: `/v1/mm?otk=${key}&op=list` },
      { description: 'Generate AI prompt with this OTK', method: 'GET', url: `/v1/prompts/tier0?otk=${key}` },
    ]));
  });

  // POST /v1/auth/connectivity-key — generate a connectivity key for AI agent registration
  router.post('/v1/auth/connectivity-key', requireAuth(), requireRole('owner'), async (req, res) => {
    const { agent_name, description } = req.body ?? {};
    const owner = req.auth!.owner;

    if (agent_name) {
      const nameError = validateAgentName(agent_name);
      if (nameError) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
        return;
      }

      const gaii = buildGAII(agent_name, owner, config.nodeId);
      const existing = await storage.getAgent(gaii);
      if (existing) {
        res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${agent_name}" already exists under your identity`));
        return;
      }
    }

    const key = generateOtk();
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

    await storage.createOtk({
      key,
      ownerGaii: req.auth!.sub,
      action: 'register_agent',
      params: {
        owner,
        agent_name: agent_name ?? null,
        description: description ?? null,
      },
      expiresAt: farFuture,
      initial: true,
      used: false,
      usedAt: null,
      sessionId: null,
      createdAt: new Date().toISOString(),
    });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      connectivity_key: key,
      owner,
      agent_name: agent_name ?? null,
    }));
  });

  // GET /v1/otk/:key — execute a one-time key action (no auth required — Tier 0.5)
  router.get('/v1/otk/:key', async (req, res) => {
    const key = req.params.key as string;
    const otk = await storage.consumeOtk(key, config.otkGraceMs);
    if (!otk) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'One-time key not found, expired, or already used'));
      return;
    }

    // Check session inactivity timeout
    if (otk.sessionId) {
      const session = sessions.get(otk.sessionId);
      if (session && Date.now() - session.lastActivity > SESSION_INACTIVITY_MS) {
        await storage.expireSessionOtks(otk.sessionId);
        sessions.delete(otk.sessionId);
        res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity'));
        return;
      }
      if (session) session.lastActivity = Date.now();
    }

    if (otk.action === 'write_memory') {
      const { key: memKey, value, visibility } = otk.params as {
        key?: string;
        value?: unknown;
        visibility?: MemoryRecord['visibility'];
      };
      if (!memKey || value === undefined) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'OTK params must include key and value'));
        return;
      }
      // Through the SAME write every other door uses, rather than straight into storage. A raw
      // setMemory here was a fourth Tier 0.5 write path (three were deleted in 9723f018) and it
      // skipped everything the shared write does: schema locks, append-only guards, the anonymous
      // fence, quota, provenance and the SSE change domain an open page listens on. The authority
      // replayed is exactly what the mint proved and no more — memory:write for the principal that
      // minted the key, with no role, so nothing here can pass as an owner session.
      const written = await writeMemoryRecord({ storage, config }, {
        principal: otk.ownerGaii,
        targetGaii: otk.ownerGaii,
        scopes: ['memory:write'],
        roles: [],
      }, {
        key: memKey,
        value,
        visibility: visibility ?? 'private',
        tags: [],
        ttlHours: null,
        pipeline: 'rest.otk_write_memory',
      });
      if (!written.ok) {
        res.status(written.status).json(error(config.nodeId, written.code, written.message));
        return;
      }
      res.json(success(config.nodeId, { action: 'write_memory', key: memKey, written: true }));
      return;
    }

    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Unsupported OTK action: ${otk.action}`));
  });
}
