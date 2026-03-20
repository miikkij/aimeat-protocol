/**
 * @file openrouter.ts
 * @description REST endpoints for OpenRouter settings management and AI completions.
 *   All endpoints require owner authentication. API keys are encrypted at rest
 *   using AES-256-GCM via the encryption service.
 * @structure
 *   - PUT /v1/openrouter/settings — save encrypted API key + preferences
 *   - GET /v1/openrouter/settings — read preferences (no key returned)
 *   - DELETE /v1/openrouter/settings — remove key + preferences
 *   - GET /v1/openrouter/models — list available OpenRouter models
 *   - POST /v1/openrouter/test — test API key validity
 *   - POST /v1/openrouter/complete — run AI completion for generator step
 * @version-history
 *   v1.0.0 — 2026-03-20 — Initial implementation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { encrypt, decrypt, getEncryptionKey } from '../services/encryption.js';
import { complete, listModels } from '../services/openrouter.js';

// Per-user model cache: Map<ghii, { models, expiresAt }>
const modelCache = new Map<string, { models: unknown[]; expiresAt: number }>();
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function openrouterRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  const orRateLimit = rateLimit(config.rateLimits.openrouter);

  // Helper: get encryption key or return 503
  function requireEncryption(res: Response): Buffer | null {
    const key = getEncryptionKey(config);
    if (!key) {
      res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
        'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.'));
      return null;
    }
    return key;
  }

  // Helper: write or update a memory key with full MemoryRecord fields
  async function upsertMemory(gaii: string, key: string, value: unknown, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(gaii, key);
    await storage.setMemory({
      key,
      ownerGaii: gaii,
      value,
      visibility: 'private',
      tags,
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  // ── PUT /v1/openrouter/settings ──
  router.put('/v1/openrouter/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const encKey = requireEncryption(res);
      if (!encKey) return;

      const gaii = resolve(req);
      const { apiKey, model, autoRetry, maxRetries } = req.body as {
        apiKey?: string;
        model?: string;
        autoRetry?: unknown;
        maxRetries?: unknown;
      };

      // Save API key (encrypted) in separate memory key
      if (apiKey && typeof apiKey === 'string') {
        const encrypted = encrypt(apiKey, encKey);
        await upsertMemory(gaii, 'openrouter.apikey', { encrypted }, ['openrouter', 'secret']);
      }

      // Save preferences (plaintext)
      const prefs: Record<string, unknown> = {};
      if (model !== undefined) prefs.model = model;
      if (autoRetry !== undefined) prefs.autoRetry = !!autoRetry;
      if (maxRetries !== undefined) prefs.maxRetries = Math.max(1, Math.min(10, Number(maxRetries) || 3));

      if (Object.keys(prefs).length > 0) {
        const existing = await storage.getMemory(gaii, 'openrouter.settings');
        const merged = existing
          ? { ...(existing.value as object), ...prefs }
          : { model: 'anthropic/claude-sonnet-4', autoRetry: true, maxRetries: 3, ...prefs };
        await upsertMemory(gaii, 'openrouter.settings', merged, ['openrouter', 'settings']);
      }

      res.json(success(config.nodeId, { saved: true }));
    });

  // ── GET /v1/openrouter/settings ──
  router.get('/v1/openrouter/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);

      const [apiKeyRecord, prefsRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
      ]);

      res.json(success(config.nodeId, {
        hasApiKey: !!(apiKeyRecord?.value as { encrypted?: string })?.encrypted,
        ...(prefsRecord?.value as object ?? { model: null, autoRetry: true, maxRetries: 3 }),
      }));
    });

  // ── DELETE /v1/openrouter/settings ──
  router.delete('/v1/openrouter/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      await Promise.all([
        storage.deleteMemory(gaii, 'openrouter.apikey').catch(() => {}),
        storage.deleteMemory(gaii, 'openrouter.settings').catch(() => {}),
      ]);
      modelCache.delete(gaii);
      res.json(success(config.nodeId, { deleted: true }));
    });

  // ── GET /v1/openrouter/models ──
  router.get('/v1/openrouter/models',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const encKey = requireEncryption(res);
      if (!encKey) return;

      const gaii = resolve(req);

      // Check cache
      const cached = modelCache.get(gaii);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(success(config.nodeId, { models: cached.models }));
      }

      // Decrypt API key
      const apiKeyRecord = await storage.getMemory(gaii, 'openrouter.apikey');
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (!encrypted) {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        const apiKey = decrypt(encrypted, encKey);
        const models = await listModels(apiKey);
        modelCache.set(gaii, { models, expiresAt: Date.now() + MODEL_CACHE_TTL });
        res.json(success(config.nodeId, { models }));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'OpenRouter rejected the API key.'));
        }
        return res.status(502).json(error(config.nodeId, 'OPENROUTER_ERROR', (e as Error).message));
      }
    });

  // ── POST /v1/openrouter/test ──
  router.post('/v1/openrouter/test',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      req.setTimeout(1_800_000);
      res.setTimeout(1_800_000);

      const encKey = requireEncryption(res);
      if (!encKey) return;

      const gaii = resolve(req);
      const apiKeyRecord = await storage.getMemory(gaii, 'openrouter.apikey');
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (!encrypted) {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        const apiKey = decrypt(encrypted, encKey);
        const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
        const model = (prefsRecord?.value as { model?: string })?.model || 'openai/gpt-4o-mini';
        await complete(apiKey, model, 'Reply with exactly: OK');
        res.json(success(config.nodeId, { ok: true, model }));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'OpenRouter rejected the API key.'));
        }
        return res.status(502).json(error(config.nodeId, 'OPENROUTER_ERROR', (e as Error).message));
      }
    });

  // ── POST /v1/openrouter/complete ──
  router.post('/v1/openrouter/complete',
    requireAuth(), requireRole('owner'), orRateLimit,
    async (req: Request, res: Response) => {
      // Extend request timeout to 10 minutes for slow AI models
      req.setTimeout(1_800_000);
      res.setTimeout(1_800_000);

      const encKey = requireEncryption(res);
      if (!encKey) return;

      const gaii = resolve(req);
      const { projectId, prompt, systemPrompt, model: modelOverride } = req.body as {
        projectId?: string;
        prompt?: string;
        systemPrompt?: string;
        model?: string;
      };

      // Validate required fields
      if (!projectId || typeof projectId !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'projectId is required.'));
      }
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'prompt is required.'));
      }

      // Verify project ownership
      const projectRecord = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found or not owned by you.'));
      }

      // Decrypt API key
      const apiKeyRecord = await storage.getMemory(gaii, 'openrouter.apikey');
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (!encrypted) {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        const apiKey = decrypt(encrypted, encKey);
        const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
        const defaultModel = (prefsRecord?.value as { model?: string })?.model || 'anthropic/claude-sonnet-4';
        const model = (typeof modelOverride === 'string' && modelOverride) ? modelOverride : defaultModel;

        const result = await complete(apiKey, model, prompt, systemPrompt);
        res.json(success(config.nodeId, result));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'OpenRouter rejected the API key.'));
        }
        if (status === 429) {
          return res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'OpenRouter rate limit hit. Try again later.'));
        }
        return res.status(502).json(error(config.nodeId, 'OPENROUTER_ERROR', (e as Error).message));
      }
    });

  return router;
}
