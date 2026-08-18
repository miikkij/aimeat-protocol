/**
 * @file openrouter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST endpoints for AI provider settings management and completions.
 *   Supports OpenRouter, LM Studio, and custom OpenAI-compatible providers.
 *   All endpoints require owner authentication. API keys are encrypted at rest
 *   using AES-256-GCM via the encryption service.
 * @structure
 *   - PUT /v1/openrouter/settings — save encrypted API key + preferences
 *   - GET /v1/openrouter/settings — read preferences (no key returned)
 *   - DELETE /v1/openrouter/settings — remove key + preferences
 *   - GET /v1/openrouter/models — list available models (?modality=chat|transcription|speech)
 *   - POST /v1/openrouter/test — test API key validity
 *   - POST /v1/openrouter/complete — run AI completion for generator step
 * @version-history
 *   v1.9.0 — 2026-08-16 — `imageModel` persists beside the other roles, for POST /v1/ai/image. It is
 *     read through services/ai-model-defaults.ts like the rest, so an owner who sets nothing gets
 *     the node's default and a node that sets nothing refuses by name rather than handing an image
 *     request to a chat model.
 *   v1.8.0 — 2026-08-01 — Speech-to-text settings: `sttModel` + `sttLanguage` persist alongside
 *     visionModel, and GET /models takes `?modality=`. The modality is load-bearing rather than
 *     cosmetic — OpenRouter's default catalogue has no transcription models in it, so without the
 *     parameter no STT model can be offered anywhere in the UI. The cache key gained the modality so
 *     two different listings cannot overwrite each other.
 *   v1.7.0 — 2026-08-01 — TARGET-058 Phase 8b. The two completing routes (/complete and /test) go
 *     through services/ai-completion.ts instead of speaking to the provider themselves. They predated
 *     the chokepoint and were the last two paths on the node producing model output that nothing
 *     stamped and — the half that costs money — nothing billed: a completion here was charged to the
 *     owner's OpenRouter account and appeared in no budget on this node. Both now mint provenance and
 *     land in the usage ledger, and /complete carries the record in `meta.provenance` + the two
 *     headers like every other route that serves generated content.
 *
 *     WHAT DID NOT CHANGE: the request body and the `data` shape. This route is somebody's
 *     integration (the calibrator's callModel reads `data.content`), so it is a change of what
 *     happens behind the route, not of what the route looks like. What DOES now apply, because the
 *     chokepoint applies it to everyone: the owner's daily AI budget, the provider-host allowlist,
 *     and the 200k prompt bound.
 *
 *     Key decryption left with the provider call. This file no longer holds a plaintext AI key on
 *     either completing path — one fewer place a secret is in memory.
 *   v1.6.0 — 2026-07-01 — Vendor-neutral default: the completion route, the connection-test ping, and
 *     the default settings object now fall back to OpenRouter's free-models router 'openrouter/free'
 *     instead of a hardcoded anthropic/openai model (no specific vendor hardcoded).
 *   v1.5.0 — 2026-06-25 — GET /v1/openrouter/settings now BACKFILLS the Secretary: it ensureSecretary()s
 *     when a key is configured (best-effort, idempotent). PUT-only provisioning left owners who set up
 *     OpenRouter before the Secretary feature without an agent (the page wrongly said "configure OpenRouter");
 *     this GET runs on every SPA load (header button), so it self-heals them transparently.
 *   v1.4.0 — 2026-06-24 — Add `visionModel` preference (a vision-capable model, e.g. qwen-2.5-VL) used
 *     for image inputs — the Secretary's doc/image intake. Persisted/returned with the other settings.
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
import { recordAccountEvent } from '../services/account-events.js';
import { listModels, DEFAULT_BASE_URLS, type ProviderType, type ModelModality } from '../services/openrouter.js';
import { completeForOwner, AiCompletionError } from '../services/ai-completion.js';
import { servedProvenanceOf, envelopeMeta, setProvenanceHeaders } from '../services/ai-provenance-marks.js';

/**
 * The per-app attribution these two routes spend under, so their cost shows up in the owner's usage
 * breakdown as something recognisable rather than pooled into `_unknown`. Named after the route, not
 * after the caller: several different callers use this one door.
 */
const COMPLETE_APP_ID = 'openrouter:complete';
const TEST_APP_ID = 'openrouter:test';

/**
 * Map a chokepoint failure onto the envelope this route has always returned.
 *
 * Only one code is renamed: the chokepoint calls a provider failure `PROVIDER_ERROR` and this route
 * has always called it `OPENROUTER_ERROR`. The status is identical, and a client branching on the
 * code string should keep working. Everything else — NO_API_KEY, INVALID_API_KEY, RATE_LIMITED,
 * ENCRYPTION_NOT_CONFIGURED — already shares a spelling with what this route returned before.
 */
function completionError(e: AiCompletionError): { status: number; code: string; message: string } {
  return {
    status: e.status,
    code: e.code === 'PROVIDER_ERROR' ? 'OPENROUTER_ERROR' : e.code,
    message: e.message,
  };
}

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
      const { apiKey, model, reasoningModel, executionModel, visionModel, sttModel, sttLanguage, imageModel, autoRetry, maxRetries, provider, baseUrl, temperature, top_p, max_tokens } = req.body as {
        apiKey?: string;
        model?: string;
        reasoningModel?: string;
        executionModel?: string;
        visionModel?: string;
        sttModel?: string;
        imageModel?: string;
        sttLanguage?: string;
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
        // A key is what lets this account spend money on inference. Its arrival and its removal are
        // both worth a durable line; the key itself is never in the row.
        void recordAccountEvent(storage, {
          ownerGhii: gaii,
          kind: 'ai_key_changed',
          actorGaii: gaii,
          link: '/v1/profile?tab=ai',
          data: { action: 'set' },
        }, config);
      }

      // Save preferences (plaintext)
      const existing = await storage.getMemory(gaii, 'openrouter.settings');
      const base = existing
        ? (existing.value as object)
        // Vendor-neutral default: OpenRouter's free-models router (no specific vendor hardcoded).
        : { model: 'openrouter/free', autoRetry: true, maxRetries: 3 };

      const prefs: Record<string, unknown> = {
        ...base,
        provider: effectiveProvider,
        baseUrl: effectiveBaseUrl,
      };
      if (model !== undefined) prefs.model = model;
      if (reasoningModel !== undefined) prefs.reasoningModel = reasoningModel;
      if (executionModel !== undefined) prefs.executionModel = executionModel;
      // visionModel: a vision-capable model (e.g. qwen/qwen-2.5-vl-...) used for image inputs
      // (the Secretary's doc/image intake). '' / null clears it → image calls fall back to the default.
      if (visionModel !== undefined) prefs.visionModel = (visionModel === null || visionModel === '') ? null : visionModel;
      // sttModel: a transcription model (e.g. openai/whisper-large-v3) for voice messages and
      // /v1/ai/transcribe. Cleared means transcription is OFF, not "fall back to the default model" —
      // the default is a text model, and handing it audio yields an opaque provider error instead of
      // an instruction the owner can act on.
      if (sttModel !== undefined) prefs.sttModel = (sttModel === null || sttModel === '') ? null : sttModel;
      // imageModel: an IMAGE model (one whose output modality is image), used by POST /v1/ai/image.
      // Cleared the same way as the others: '' or null means "let the node decide".
      if (imageModel !== undefined) prefs.imageModel = (imageModel === null || imageModel === '') ? null : imageModel;
      // sttLanguage: ISO-639-1 hint. Empty = auto-detect, which is what mixed-language speech wants;
      // a hint measurably helps a single known language (Finnish in particular).
      if (sttLanguage !== undefined) prefs.sttLanguage = (sttLanguage === null || sttLanguage === '') ? null : String(sttLanguage).slice(0, 8);
      if (autoRetry !== undefined) prefs.autoRetry = !!autoRetry;
      if (maxRetries !== undefined) prefs.maxRetries = Math.max(1, Math.min(10, Number(maxRetries) || 3));
      // null = clear (use model default), number = set explicit value, undefined = don't change
      if (temperature !== undefined) prefs.temperature = (temperature === null || isNaN(Number(temperature))) ? null : Math.max(0, Math.min(2, Number(temperature)));
      if (top_p !== undefined) prefs.top_p = (top_p === null || isNaN(Number(top_p))) ? null : Math.max(0, Math.min(1, Number(top_p)));
      if (max_tokens !== undefined) prefs.max_tokens = (max_tokens === null || isNaN(Number(max_tokens))) ? null : Math.max(1, Math.min(128000, Math.floor(Number(max_tokens))));

      await upsertMemory(gaii, 'openrouter.settings', prefs, ['openrouter', 'settings']);

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
        visionModel: prefs.visionModel ?? null,
        sttModel: prefs.sttModel ?? null,
        imageModel: prefs.imageModel ?? null,
        sttLanguage: prefs.sttLanguage ?? null,
        autoRetry: prefs.autoRetry ?? true,
        maxRetries: prefs.maxRetries ?? 3,
        provider: prefs.provider ?? 'openrouter',
        baseUrl: prefs.baseUrl ?? DEFAULT_BASE_URLS.openrouter,
        temperature: prefs.temperature ?? null,
        top_p: prefs.top_p ?? null,
        max_tokens: prefs.max_tokens ?? null,
        // Node-level ceilings, served with the settings that live under them. The browser recorder
        // needs to stop at THIS node's number rather than a figure compiled into the page, and this
        // response is already fetched wherever that matters.
        limits: {
          voice_msg_max_seconds: config.voiceMsgMaxSeconds,
          stt_max_mb: config.sttMaxMb,
          stt_max_seconds: config.sttMaxSeconds,
        },
      }));
    });

  // ── DELETE /v1/openrouter/settings ──
  router.delete('/v1/openrouter/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      await Promise.all([
        storage.deleteMemory(gaii, 'openrouter.apikey').catch(err => { logger.warn('DELETE /v1/openrouter/settings: continuing after a suppressed failure', { error: String(err) }); }),
        storage.deleteMemory(gaii, 'openrouter.settings').catch(err => { logger.warn('DELETE /v1/openrouter/settings: continuing after a suppressed failure', { error: String(err) }); }),
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

      // Which slice of the catalogue. This is NOT a client-side filter dressed up as a parameter:
      // OpenRouter's default catalogue contains no transcription or speech models at all (measured
      // 2026-08-01: 336 models, zero whisper), so `chat` and `transcription` are different listings.
      const requested = String(req.query.modality ?? 'chat');
      const modality: ModelModality =
        (requested === 'transcription' || requested === 'speech') ? requested : 'chat';

      // Check cache (keyed by baseUrl AND modality — different listings must not share an entry)
      const cacheKey = `${gaii}:${baseUrl}:${modality}`;
      const cached = modelCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(success(config.nodeId, { models: cached.models, modality }));
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
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY', 'No AI key is set up yet. Add yours in Profile → AI and this will work.'));
      }

      try {
        const models = await listModels(decryptedKey, baseUrl, modality);
        modelCache.set(cacheKey, { models, expiresAt: Date.now() + MODEL_CACHE_TTL });
        res.json(success(config.nodeId, { models, modality }));
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

      // The MODEL this route tests is still the owner's reasoning model first — that ordering is
      // what "test my setup" has always meant here, and the chokepoint's own default order is
      // different. Passed as an explicit override so the chokepoint does the spending and this route
      // keeps deciding what it is testing.
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const model = (prefs.reasoningModel as string) || (prefs.executionModel as string) || (prefs.model as string) || 'openrouter/free';

      try {
        // A connectivity test is a real, billable completion. It goes through the chokepoint like
        // every other one — which also means it is refused once the owner's daily budget is spent,
        // and says so.
        await completeForOwner(storage, config, gaii, {
          prompt: 'Reply with exactly: OK', model, appId: TEST_APP_ID,
        });
        // The model this route was ASKED to test, not what the provider echoed — unchanged.
        res.json(success(config.nodeId, { ok: true, model }));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          const m = completionError(e);
          return res.status(m.status).json(error(config.nodeId, m.code, m.message));
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

      // Verify project ownership (check generator and calibrator namespaces)
      const projectRecord = await storage.getMemory(gaii, `generator.${projectId}.project`)
        || await storage.getMemory(gaii, `calibrator.${projectId}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found or not owned by you.'));
      }

      try {
        // Model selection, the key, the provider host allowlist, the budget and the usage record all
        // belong to the chokepoint now. `model` and `modelRole` are passed straight through, so an
        // explicit override still wins and a role still picks the role's model.
        const r = await completeForOwner(storage, config, gaii, {
          prompt, systemPrompt, model: modelOverride, modelRole,
          temperature, topP: top_p, maxTokens: max_tokens, appId: COMPLETE_APP_ID,
        });

        // TARGET-058: the provenance of the bytes about to be handed back, on the ONE envelope
        // carrier — `meta`, never `data`. The caller is the owner running their own project, so they
        // see the whole record rather than the public projection.
        const prov = r.provenance ? servedProvenanceOf(config, r.provenance, { full: true }) : undefined;
        setProvenanceHeaders(res, prov);
        // The `data` shape this route has always returned: `content`, `model`, and the provider's
        // usage in ITS OWN snake_case spelling. Reproduced field by field rather than spread from the
        // chokepoint result, because the chokepoint speaks camelCase internally and a spread here is
        // how a route DTO silently changes shape under an integration.
        res.json(success(config.nodeId, {
          content: r.content,
          model: r.model,
          usage: {
            prompt_tokens: r.usage.promptTokens,
            completion_tokens: r.usage.completionTokens,
            total_tokens: r.usage.totalTokens,
            cost_usd: r.usage.costUsd,
          },
        }, undefined, envelopeMeta(prov)));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          const m = completionError(e);
          return res.status(m.status).json(error(config.nodeId, m.code, m.message));
        }
        return res.status(502).json(error(config.nodeId, 'OPENROUTER_ERROR', (e as Error).message));
      }
    });

  return router;
}
