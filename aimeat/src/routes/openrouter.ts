/**
 * @file openrouter.ts
 * @description REST endpoints for AI provider settings management and completions.
 *   Supports OpenRouter, LM Studio, and custom OpenAI-compatible providers.
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
 *   v1.3.0 — 2026-06-23 — Auto-provision the owner's Secretary agent when an OpenRouter key is saved (Secretary Phase 0).
 *   v1.2.0 — 2026-04-01 — Add temperature/top_p/max_tokens model parameters
 *   v1.1.0 — 2026-03-21 — Add provider type (openrouter/lmstudio/custom) support
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
import { logger } from '../utils/logger.js';
import { complete, listModels } from '../services/openrouter.js';
import { ensureSecretary } from '../services/secretary.js';

function validateProviderUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    if (parsed.protocol === 'https:') return null;
    return 'Only localhost (http) or remote (https) URLs allowed';
  } catch {
    return 'Invalid URL format';
  }
}

type ProviderType = 'openrouter' | 'lmstudio' | 'custom';

const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

// Per-user model cache: Map<cacheKey, { models, expiresAt }>
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
      const gaii = resolve(req);
      const { apiKey, model, reasoningModel, executionModel, autoRetry, maxRetries, provider, baseUrl, temperature, top_p, max_tokens } = req.body as {
        apiKey?: string;
        model?: string;
        reasoningModel?: string;
        executionModel?: string;
        autoRetry?: unknown;
        maxRetries?: unknown;
        provider?: string;
        baseUrl?: string;
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
      };

      // Resolve provider type
      const validProviders: ProviderType[] = ['openrouter', 'lmstudio', 'custom'];
      const effectiveProvider: ProviderType = (provider && validProviders.includes(provider as ProviderType))
        ? provider as ProviderType
        : 'openrouter';

      // Resolve base URL
      let effectiveBaseUrl: string;
      if (baseUrl && typeof baseUrl === 'string') {
        effectiveBaseUrl = baseUrl;
      } else {
        effectiveBaseUrl = DEFAULT_BASE_URLS[effectiveProvider];
      }

      // Validate URL for non-openrouter providers (custom requires a URL)
      if (effectiveProvider === 'custom' && !effectiveBaseUrl) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'baseUrl is required for custom provider.'));
      }
      if (effectiveBaseUrl) {
        const urlError = validateProviderUrl(effectiveBaseUrl);
        if (urlError) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BODY', urlError));
        }
      }

      // API key: required for openrouter, optional for lmstudio/custom
      if (apiKey && typeof apiKey === 'string') {
        const encKey = requireEncryption(res);
        if (!encKey) return;
        const encrypted = encrypt(apiKey, encKey);
        await upsertMemory(gaii, 'openrouter.apikey', { encrypted }, ['openrouter', 'secret']);
      }

      // Save preferences (plaintext)
      const existing = await storage.getMemory(gaii, 'openrouter.settings');
      const base = existing
        ? (existing.value as object)
        : { model: 'anthropic/claude-sonnet-4', autoRetry: true, maxRetries: 3 };

      const prefs: Record<string, unknown> = {
        ...base,
        provider: effectiveProvider,
        baseUrl: effectiveBaseUrl,
      };
      if (model !== undefined) prefs.model = model;
      if (reasoningModel !== undefined) prefs.reasoningModel = reasoningModel;
      if (executionModel !== undefined) prefs.executionModel = executionModel;
      if (autoRetry !== undefined) prefs.autoRetry = !!autoRetry;
      if (maxRetries !== undefined) prefs.maxRetries = Math.max(1, Math.min(10, Number(maxRetries) || 3));
      // null = clear (use model default), number = set explicit value, undefined = don't change
      if (temperature !== undefined) prefs.temperature = (temperature === null || isNaN(Number(temperature))) ? null : Math.max(0, Math.min(2, Number(temperature)));
      if (top_p !== undefined) prefs.top_p = (top_p === null || isNaN(Number(top_p))) ? null : Math.max(0, Math.min(1, Number(top_p)));
      if (max_tokens !== undefined) prefs.max_tokens = (max_tokens === null || isNaN(Number(max_tokens))) ? null : Math.max(1, Math.min(128000, Math.floor(Number(max_tokens))));

      await upsertMemory(gaii, 'openrouter.settings', prefs, ['openrouter', 'settings']);

      // Auto-provision the owner's Secretary whenever OpenRouter is configured (idempotent; see
      // docs/plans/2026-06-23-secretary-feature.md Phase 0). Gated on the key actually being present
      // — so it covers both "key just set" and "existing-key owner tweaks settings", but never an
      // lmstudio/custom save with no key. Best-effort: provisioning must not block saving settings.
      try {
        const keyRec = await storage.getMemory(gaii, 'openrouter.apikey');
        const hasKey = !!((keyRec?.value as { encrypted?: string } | undefined)?.encrypted);
        if (hasKey) await ensureSecretary(storage, config, req.auth!.owner as string);
      } catch (err) {
        logger.warn('[secretary] auto-provision on settings save failed', { error: String(err) });
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

      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      res.json(success(config.nodeId, {
        hasApiKey: !!(apiKeyRecord?.value as { encrypted?: string })?.encrypted,
        model: prefs.model ?? null,
        reasoningModel: prefs.reasoningModel ?? null,
        executionModel: prefs.executionModel ?? null,
        autoRetry: prefs.autoRetry ?? true,
        maxRetries: prefs.maxRetries ?? 3,
        provider: prefs.provider ?? 'openrouter',
        baseUrl: prefs.baseUrl ?? DEFAULT_BASE_URLS.openrouter,
        temperature: prefs.temperature ?? null,
        top_p: prefs.top_p ?? null,
        max_tokens: prefs.max_tokens ?? null,
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
      // Clear all cache entries for this user (keys are gaii:baseUrl)
      for (const key of modelCache.keys()) {
        if (key.startsWith(`${gaii}:`)) modelCache.delete(key);
      }
      res.json(success(config.nodeId, { deleted: true }));
    });

  // ── GET /v1/openrouter/models ──
  router.get('/v1/openrouter/models',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);

      // Resolve provider settings
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const provider = (prefs.provider as ProviderType) || 'openrouter';
      const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

      // Check cache (keyed by baseUrl to avoid cross-provider collisions)
      const cacheKey = `${gaii}:${baseUrl}`;
      const cached = modelCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(success(config.nodeId, { models: cached.models }));
      }

      // Decrypt API key (optional for non-openrouter providers)
      let decryptedKey: string | undefined;
      const apiKeyRecord = await storage.getMemory(gaii, 'openrouter.apikey');
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (encrypted) {
        const encKey = requireEncryption(res);
        if (!encKey) return;
        decryptedKey = decrypt(encrypted, encKey);
      } else if (provider === 'openrouter') {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        const models = await listModels(decryptedKey, baseUrl);
        modelCache.set(cacheKey, { models, expiresAt: Date.now() + MODEL_CACHE_TTL });
        res.json(success(config.nodeId, { models }));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'API key was rejected.'));
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

      const gaii = resolve(req);

      // Resolve provider settings
      const [apiKeyRecord, prefsRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
      ]);
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const provider = (prefs.provider as ProviderType) || 'openrouter';
      const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

      // Decrypt API key (optional for non-openrouter providers)
      let decryptedKey: string | undefined;
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (encrypted) {
        const encKey = requireEncryption(res);
        if (!encKey) return;
        decryptedKey = decrypt(encrypted, encKey);
      } else if (provider === 'openrouter') {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        const model = (prefs.reasoningModel as string) || (prefs.executionModel as string) || (prefs.model as string) || 'openai/gpt-4o-mini';
        await complete(decryptedKey, model, 'Reply with exactly: OK', undefined, baseUrl);
        res.json(success(config.nodeId, { ok: true, model }));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'API key was rejected.'));
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

      const gaii = resolve(req);
      const { projectId, prompt, systemPrompt, model: modelOverride, modelRole, temperature, top_p, max_tokens } = req.body as {
        projectId?: string;
        prompt?: string;
        systemPrompt?: string;
        model?: string;
        modelRole?: 'reasoning' | 'execution';
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
      };

      // Validate required fields
      if (!projectId || typeof projectId !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'projectId is required.'));
      }
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'prompt is required.'));
      }

      // Verify project ownership (check generator, foundry, and calibrator namespaces)
      const projectRecord = await storage.getMemory(gaii, `generator.${projectId}.project`)
        || await storage.getMemory(gaii, `foundry.${projectId}.project`)
        || await storage.getMemory(gaii, `calibrator.${projectId}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found or not owned by you.'));
      }

      // Resolve provider settings
      const [apiKeyRecord, prefsRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
      ]);
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const provider = (prefs.provider as ProviderType) || 'openrouter';
      const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

      // Decrypt API key (optional for non-openrouter providers)
      let decryptedKey: string | undefined;
      const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
      if (encrypted) {
        const encKey = requireEncryption(res);
        if (!encKey) return;
        decryptedKey = decrypt(encrypted, encKey);
      } else if (provider === 'openrouter') {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No OpenRouter API key configured.'));
      }

      try {
        // Model selection: explicit override > role-specific model > default model
        let selectedModel: string;
        if (typeof modelOverride === 'string' && modelOverride) {
          selectedModel = modelOverride;
        } else if (modelRole === 'reasoning' && prefs.reasoningModel) {
          selectedModel = prefs.reasoningModel as string;
        } else if (modelRole === 'execution' && prefs.executionModel) {
          selectedModel = prefs.executionModel as string;
        } else {
          selectedModel = (prefs.model as string) || (prefs.reasoningModel as string) || (prefs.executionModel as string) || 'anthropic/claude-sonnet-4';
        }
        const model = selectedModel;

        // Use per-request overrides, falling back to stored settings defaults (null = not set)
        const options = {
          temperature: temperature ?? (typeof prefs.temperature === 'number' ? prefs.temperature : undefined),
          top_p: top_p ?? (typeof prefs.top_p === 'number' ? prefs.top_p : undefined),
          max_tokens: max_tokens ?? (typeof prefs.max_tokens === 'number' ? prefs.max_tokens : undefined),
        };
        logger.info(`[openrouter] call: model=${model}, promptLen=${prompt.length}, temp=${options.temperature ?? 'default'}, top_p=${options.top_p ?? 'default'}, max_tokens=${options.max_tokens ?? 'default'}`);
        const result = await complete(decryptedKey, model, prompt, systemPrompt, baseUrl, options);
        logger.info(`[openrouter] result: model=${result.model}, contentLen=${result.content.length}`);
        res.json(success(config.nodeId, result));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'API key was rejected.'));
        }
        if (status === 429) {
          return res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'Rate limit hit. Try again later.'));
        }
        return res.status(502).json(error(config.nodeId, 'OPENROUTER_ERROR', (e as Error).message));
      }
    });

  return router;
}
