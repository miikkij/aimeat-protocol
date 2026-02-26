import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { verify } from '../auth/keypair.js';
import { issueJWT, revokeToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseGAII } from '../utils/gaii.js';
import { randomBytes } from 'node:crypto';
import { generateOtk } from '../utils/otk.js';
import { AuthTokenRequestSchema, validateBody } from '../models/schemas.js';

// In-memory challenge store
const challenges = new Map<string, { challenge: string; expiresAt: number; owner: string }>();

// Session inactivity tracking: sessionId → lastActivity timestamp
const sessions = new Map<string, { ownerGaii: string; lastActivity: number }>();
const SESSION_INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if an OTK's session is still active (not timed out by inactivity).
 * Updates lastActivity on success. Returns false if session has expired.
 * Non-session OTKs always return true.
 */
export async function checkOtkSession(otk: { sessionId: string | null }, storage: Storage): Promise<boolean> {
  if (!otk.sessionId) return true;
  const session = sessions.get(otk.sessionId);
  if (!session) return true; // session not tracked (e.g. standalone OTK)
  if (Date.now() - session.lastActivity > SESSION_INACTIVITY_MS) {
    await storage.expireSessionOtks(otk.sessionId);
    sessions.delete(otk.sessionId);
    return false;
  }
  session.lastActivity = Date.now();
  return true;
}

export function authRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/auth/challenge — get a nonce to sign
  router.get('/v1/auth/challenge', (req, res) => {
    const owner = req.query.owner as string | undefined;
    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query parameter "owner" is required'));
      return;
    }

    const challenge = `ch-${randomBytes(16).toString('hex')}`;
    const expiresAt = Date.now() + 60_000; // 60 seconds
    challenges.set(challenge, { challenge, expiresAt, owner });

    res.json(success(config.nodeId, {
      challenge,
      expires_at: new Date(expiresAt).toISOString(),
    }, [
      {
        description: 'Sign the challenge with your private key and submit to get a JWT',
        method: 'POST',
        url: '/v1/auth/token',
        example_body: {
          gaii: `your-agent#${owner}@${config.nodeId}`,
          timestamp: new Date().toISOString(),
          signature: 'base64(Ed25519_sign(private_key, gaii + timestamp))',
        },
      },
    ]));
  });

  // GET /v1/auth/session — Submit signed challenge, get OTK (Tier 0.5)
  router.get('/v1/auth/session', async (req, res) => {
    const owner = req.query.owner as string | undefined;
    const challengeStr = req.query.challenge as string | undefined;
    const sig = req.query.sig as string | undefined;

    if (!owner || !challengeStr || !sig) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query parameters "owner", "challenge", and "sig" are required'));
      return;
    }

    // Look up challenge
    const stored = challenges.get(challengeStr);
    if (!stored) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge not found or expired'));
      return;
    }
    if (Date.now() > stored.expiresAt) {
      challenges.delete(challengeStr);
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge expired'));
      return;
    }
    if (stored.owner !== owner) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge does not match owner'));
      return;
    }

    // Verify signature: owner signed the challenge string with their private key
    const ownerRecord = await storage.getOwner(owner);
    if (!ownerRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${owner}`));
      return;
    }

    const valid = await verify(ownerRecord.publicKey, challengeStr, sig);
    if (!valid) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
      return;
    }

    // Consume challenge
    challenges.delete(challengeStr);

    // Find first agent for this owner (or create session OTK for owner)
    const agents = await storage.getAgentsByOwner(owner);
    const sessionGaii = agents.length > 0 ? agents[0].gaii : owner;

    // Create a session for inactivity tracking
    const sessionId = `sess-${randomBytes(8).toString('hex')}`;
    sessions.set(sessionId, { ownerGaii: sessionGaii, lastActivity: Date.now() });

    // Generate OTK for Tier 0.5 operations
    const otk = generateOtk();
    const expiresAt = new Date(Date.now() + 300_000).toISOString(); // 5 minutes

    await storage.createOtk({
      key: otk,
      ownerGaii: sessionGaii,
      action: 'session',
      params: { owner, sessionType: 'tier_0_5', sessionId },
      expiresAt,
      used: false,
      usedAt: null,
      sessionId,
      createdAt: new Date().toISOString(),
    });

    // Pre-rotate: generate next_otk so the AI always has a buffered key
    const nextOtk = generateOtk();
    const nextExpiresAt = new Date(Date.now() + 300_000).toISOString();
    await storage.createOtk({
      key: nextOtk,
      ownerGaii: sessionGaii,
      action: 'session',
      params: { owner, sessionType: 'tier_0_5', sessionId },
      expiresAt: nextExpiresAt,
      used: false,
      usedAt: null,
      sessionId,
      createdAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      otk,
      otk_expires: expiresAt,
      next_otk: nextOtk,
      next_otk_expires: nextExpiresAt,
      session_id: sessionId,
      session_agent: sessionGaii,
      session_inactivity_timeout_seconds: SESSION_INACTIVITY_MS / 1000,
      note: 'OTKs remain valid for 60 seconds after first use to handle retries. Session expires after 5 minutes of inactivity.',
    }, [
      { description: 'Use OTK for micro-memory operations', method: 'GET', url: `/v1/mm?otk=${otk}&op=list` },
      { description: 'Accept work via GET', method: 'GET', url: `/v1/work/{tc}/accept?otk=${otk}` },
    ]));
  });

  // POST /v1/auth/token — exchange signature for JWT
  router.post('/v1/auth/token', validateBody(AuthTokenRequestSchema, config.nodeId), async (req, res) => {
    const { gaii, owner: ownerName, timestamp, signature } = req.body ?? {};

    // Agent auth (gaii provided)
    if (gaii) {
      const parsed = parseGAII(gaii);
      if (!parsed) {
        res.status(400).json(error(config.nodeId, 'INVALID_GAII', `Invalid GAII format: ${gaii}`));
        return;
      }

      const agent = await storage.getAgent(gaii);
      if (!agent) {
        res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
        return;
      }

      // Verify signature: sign(private_key, gaii + timestamp)
      const message = gaii + timestamp;
      const valid = await verify(agent.publicKey, message, signature);
      if (!valid) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
        return;
      }

      // Check timestamp freshness (within 5 minutes)
      const ts = new Date(timestamp).getTime();
      if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Timestamp too old or too far in the future'));
        return;
      }

      // Get owner to check roles
      const ownerRecord = await storage.getOwner(parsed.owner);
      const roles = ['agent'];
      if (ownerRecord?.roles.includes('owner')) roles.push('owner');
      if (ownerRecord?.roles.includes('operator')) roles.push('operator');

      const token = await issueJWT({
        sub: gaii,
        owner: parsed.owner,
        node: config.nodeId,
        roles,
      }, config.jwtTtlSeconds);

      // Update last seen
      await storage.updateAgent(gaii, { lastSeen: new Date().toISOString() });

      res.json(success(config.nodeId, {
        token,
        expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
        ttl_seconds: config.jwtTtlSeconds,
        identity: {
          gaii,
          owner: parsed.owner,
          node: config.nodeId,
        },
        roles,
      }, [
        {
          description: 'Use this token in the Authorization header for all requests',
          note: `Authorization: Bearer ${token.slice(0, 20)}...`,
          method: 'GET',
          url: '/v1/memory',
        },
        { description: 'Refresh before expiry', method: 'POST', url: '/v1/auth/refresh' },
      ]));
      return;
    }

    // Owner auth (owner name provided instead of gaii)
    if (ownerName) {
      const ownerRecord = await storage.getOwner(ownerName);
      if (!ownerRecord) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${ownerName}`));
        return;
      }

      const message = ownerName + config.nodeId + timestamp;
      const valid = await verify(ownerRecord.publicKey, message, signature);
      if (!valid) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
        return;
      }

      const ts = new Date(timestamp).getTime();
      if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Timestamp too old or too far in the future'));
        return;
      }

      const roles = [...ownerRecord.roles];

      const token = await issueJWT({
        sub: ownerName,
        owner: ownerName,
        node: config.nodeId,
        roles,
      }, config.jwtTtlSeconds);

      res.json(success(config.nodeId, {
        token,
        expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
        ttl_seconds: config.jwtTtlSeconds,
        identity: {
          owner: ownerName,
          node: config.nodeId,
        },
        roles,
      }, [
        { description: 'Register a new agent', method: 'POST', url: '/v1/agents' },
        { description: 'List your agents', method: 'GET', url: '/v1/agents' },
      ]));
      return;
    }

    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Either "gaii" or "owner" is required'));
  });

  // POST /v1/auth/refresh
  router.post('/v1/auth/refresh', requireAuth(), async (req, res) => {
    const token = await issueJWT({
      sub: req.auth!.sub,
      owner: req.auth!.owner,
      node: config.nodeId,
      roles: req.auth!.roles,
    }, config.jwtTtlSeconds);

    res.json(success(config.nodeId, {
      token,
      expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
      ttl_seconds: config.jwtTtlSeconds,
    }));
  });

  // POST /v1/auth/revoke
  router.post('/v1/auth/revoke', requireAuth(), (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      revokeToken(token, req.auth!.exp);
    }

    res.json(success(config.nodeId, {
      revoked: true,
    }, [
      { description: 'Get a new token', method: 'POST', url: '/v1/auth/token' },
    ]));
  });

  // POST /v1/auth/otk — generate a one-time key for Tier 0.5 actions (agent auth)
  router.post('/v1/auth/otk', requireAuth(), async (req, res) => {
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

    const key = generateOtk();
    const expiresAt = new Date(Date.now() + 600_000).toISOString(); // 10 minutes

    await storage.createOtk({
      key,
      ownerGaii: req.auth!.sub,
      action,
      params: params ?? {},
      expiresAt,
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

  // GET /v1/otk/:key — execute a one-time key action (no auth required — Tier 0.5)
  router.get('/v1/otk/:key', async (req, res) => {
    const key = req.params.key as string;
    const otk = await storage.consumeOtk(key);
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
      const { key: memKey, value, visibility } = otk.params as any;
      if (!memKey || value === undefined) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'OTK params must include key and value'));
        return;
      }
      const existing = await storage.getMemory(otk.ownerGaii, memKey);
      await storage.setMemory({
        key: memKey,
        ownerGaii: otk.ownerGaii,
        value,
        visibility: visibility ?? 'private',
        tags: [],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json(success(config.nodeId, { action: 'write_memory', key: memKey, written: true }));
      return;
    }

    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Unsupported OTK action: ${otk.action}`));
  });

  // Cleanup expired challenges and inactive sessions periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of challenges) {
      if (now > val.expiresAt) challenges.delete(key);
    }
    // Expire inactive sessions (5 min inactivity)
    for (const [sessionId, session] of sessions) {
      if (now - session.lastActivity > SESSION_INACTIVITY_MS) {
        storage.expireSessionOtks(sessionId).catch(() => { });
        sessions.delete(sessionId);
      }
    }
  }, 30_000);

  return router;
}
