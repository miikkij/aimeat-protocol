/**
 * @file ai.ts
 * @description App-level AI completion endpoint. Sibling of /v1/openrouter/complete
 *   but without the project-id gate: any logged-in owner (or agent with `ai:use`
 *   scope) can call it from a sandboxed app or extension. The actual completion,
 *   budget enforcement, key decrypt, and usage accounting live in the shared
 *   services/ai-completion.ts module (also used by the scheduler's `ai` jobs);
 *   this router is a thin HTTP wrapper + the owner-only settings/usage endpoints.
 * @structure
 *   - POST /v1/ai/complete       — owner or any token with ai:use scope, runs one completion
 *   - POST /v1/ai/transcribe     — same gate, speech-to-text over a stored (or inline) audio file
 *   - GET  /v1/ai/available      — owner or ai:use token, boolean "is AI configured?" probe
 *   - GET  /v1/ai/usage          — owner-only, today's spend per-app breakdown
 *   - GET  /v1/ai/usage/history  — owner-only, per-day spend series + 24h/7d/30d rollups (charts)
 *   - GET  /v1/admin/ai-usage    — operator-only, cross-user AI-spend aggregate (admin dashboard)
 *   - POST /v1/ai/settings       — owner-only, update budget/quotas/allowlist
 *   - GET  /v1/ai/settings       — owner-only, read budget/quotas/allowlist
 * @usage
 *   import { aiRouter } from './routes/ai.js';
 *   app.use(aiRouter(config, storage));
 * @version-history
 *   v1.x — 2026-08-16 — POST /v1/ai/image. The bytes land in the caller's storage and the answer is
 *     a key and a URL, never base64: a picture returned inline would travel through a tool result
 *     and an agent's context for nothing. Gated with requireScope('ai:use') as middleware as well
 *     as the in-handler check, so the route says which permission it needs where an audit can read
 *     it; an owner session bypasses scopes, so the two admit the same callers.
 *   v1.0.0 — 2026-05-29 — Initial: app-level AI calls with budget enforcement
 *   v1.1.0 — 2026-06-03 — Delegate completion to services/ai-completion.ts (shared
 *     with the scheduler); route is now a thin wrapper.
 *   v1.2.0 — 2026-06-24 — Accept an optional `images` array (data:/https URLs) on
 *     /v1/ai/complete for vision-capable models (Secretary doc/image intake).
 *   v1.3.0 — 2026-06-25 — Gate is role-agnostic on the ai:use scope so app-grant tokens
 *     (sandboxed apps on the isolated app origin) can spend the owner's AI budget; add
 *     GET /v1/ai/available so such apps can gate their UI without owner-only settings.
 *   v1.4.0 — 2026-07-05 — Add GET /v1/ai/usage/history (owner per-day series + rollups) and
 *     GET /v1/admin/ai-usage (operator cross-user aggregate) backing the AI-spend charts.
 *   v1.6.0 — 2026-08-01 — POST /v1/ai/transcribe: speech-to-text on the owner's own key, behind the
 *     same gate, the same daily budget and the same usage ledger as completions. Audio comes from a
 *     storage key resolved against the CALLER's namespace (an inline base64 fallback is capped hard),
 *     so the endpoint cannot be pointed at another account's files.
 *   v1.5.0 — 2026-08-01 — TARGET-058: /v1/ai/complete carries the minted provenance record in
 *     `meta.provenance` and in the AI-Disclosure / Link response headers. The `data` shape is
 *     untouched, so nothing that reads `content` changes.
 *   v1.7.0 — 2026-08-11 — Security audit H-2: the gate's owner branch excludes agent and ecosystem
 *     sessions, matching requireScope. An agent now needs `ai:use` to spend the owner's AI budget,
 *     which is what the endpoint always said and not what it enforced while agent tokens carried the
 *     owner's roles.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { recordAccountEvent } from '../services/account-events.js';
import {
  completeForOwner, AiCompletionError, getTodayUsage, getUsageHistory, getDailyBudgetUsd,
  DEFAULT_DAILY_BUDGET_USD,
} from '../services/ai-completion.js';
import { getAdminAiUsage } from '../services/ai-usage-admin.js';
import { transcribeForOwner } from '../services/ai-transcription.js';
import { generateForOwner } from '../services/ai-image.js';
import { servedProvenanceOf, envelopeMeta, setProvenanceHeaders } from '../services/ai-provenance-marks.js';

/** ~6 MB of audio once decoded. Inline base64 is the fallback path, so it is bounded well below the
 *  JSON body limit; anything real goes through storage. */
const INLINE_AUDIO_MAX_CHARS = 8_000_000;

export function aiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  // Reuse the openrouter rate limit bucket — same provider, same spend concerns.
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  async function upsertMemory(gaii: string, key: string, value: unknown, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(gaii, key);
    await storage.setMemory({
      key, ownerGaii: gaii, value, visibility: 'private', tags,
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Either the caller is an owner JWT (role=owner) OR any scoped principal
   * (agent JWT, or an app-grant token from a sandboxed app) carrying the
   * `ai:use` scope. The scope check is role-agnostic so a browser app running
   * on the isolated app origin — which holds an app-grant token (role 'app'),
   * never an owner session — can still spend the owner's AI budget once the
   * owner granted `ai:use`. Reject anything else.
   */
  // The same test the chat proxy applies, in one place (src/auth/ai-gate.ts). A permission word
  // enforced on one door and not the next is the shape the August 2026 audit kept finding.
  const gateOwnerOrAiUseAgent = (req: Request, res: Response): boolean =>
    assertAiUseAllowed(req, res, config.nodeId);

  // ── POST /v1/ai/complete ──
  router.post('/v1/ai/complete',
    requireAuth(), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      req.setTimeout(1_800_000);
      res.setTimeout(1_800_000);

      const gaii = resolve(req);
      const {
        prompt, systemPrompt, model: modelOverride, modelRole,
        temperature, top_p, max_tokens, app_id, images,
      } = req.body as {
        prompt?: string; systemPrompt?: string; model?: string;
        modelRole?: 'reasoning' | 'execution';
        temperature?: number; top_p?: number; max_tokens?: number;
        app_id?: string; images?: string[];
      };

      // Bound the image payload (vision attachments) — keep a runaway request from ballooning.
      let imageList: string[] | undefined;
      if (images !== undefined) {
        if (!Array.isArray(images) || images.some((u) => typeof u !== 'string')) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'images must be an array of URL strings.'));
        }
        if (images.length > 8) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'images: at most 8 attachments per request.'));
        }
        imageList = images.filter((u) => u.length > 0);
      }

      try {
        const r = await completeForOwner(storage, config, gaii, {
          prompt: prompt as string, systemPrompt, model: modelOverride, modelRole,
          temperature, topP: top_p, maxTokens: max_tokens, appId: app_id, images: imageList,
        });
        // TARGET-058: the provenance of the bytes we are about to hand back, on the ONE envelope
        // carrier. `meta`, never `data` — the `data` shape is what every published app reads, and it
        // is unchanged, so an app that ignores provenance keeps working and one that wants it finds
        // it in the same place on every route that serves generated content.
        //
        // The caller is the owner (or an app spending the owner's budget), so they see the whole
        // record rather than the public projection: it is their own generation.
        const prov = r.provenance ? servedProvenanceOf(config, r.provenance, { full: true }) : undefined;
        setProvenanceHeaders(res, prov);
        res.json(success(config.nodeId, {
          content: r.content,
          model: r.model,
          usage: {
            prompt_tokens: r.usage.promptTokens,
            completion_tokens: r.usage.completionTokens,
            total_tokens: r.usage.totalTokens,
            cost_usd: r.usage.costUsd,
            cost_exact: r.usage.costExact,
          },
          budget: {
            daily_budget_usd: r.budget.dailyBudgetUsd,
            spent_today_usd: r.budget.spentTodayUsd,
            remaining_usd: r.budget.remainingUsd,
          },
        }, undefined, envelopeMeta(prov)));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          return res.status(e.status).json(error(config.nodeId, e.code, e.message));
        }
        return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
      }
    });

  // ── POST /v1/ai/transcribe ── speech-to-text, gated identically to /complete.
  //
  // Two audio sources, and the ORDER matters: `storage_key` is the real one. The bytes of anything
  // worth transcribing are already on this node (a voice message attachment, an uploaded recording),
  // so reading them here avoids a pointless round trip through the browser and the base64 inflation
  // that comes with it. `audio_base64` exists for the case where a browser recorded something it has
  // not stored yet, and is capped hard because it travels inside a JSON body.
  //
  // The key is resolved against the CALLER's own namespace — never an owner supplied in the body —
  // so one account cannot transcribe another's files. A key belonging to someone else answers 404
  // rather than 403: whether it exists is not information this route gives away.
  router.post('/v1/ai/transcribe',
    requireAuth(), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      req.setTimeout(180_000);
      res.setTimeout(180_000);

      const gaii = resolve(req);
      const { storage_key, audio_base64, mime, filename, model, language, verbose, app_id } = req.body as {
        storage_key?: string; audio_base64?: string; mime?: string; filename?: string;
        model?: string; language?: string; verbose?: boolean; app_id?: string;
      };

      let audio: { data: Buffer; mime: string; filename: string };

      if (typeof storage_key === 'string' && storage_key) {
        const file = await storage.getStorageFile(gaii, storage_key);
        if (!file) {
          return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such file in your storage.'));
        }
        audio = {
          data: file.data,
          mime: mime || file.mimeType || 'application/octet-stream',
          filename: filename || storage_key.split('/').pop() || 'audio',
        };
      } else if (typeof audio_base64 === 'string' && audio_base64) {
        // A base64 string is 4/3 of the bytes it carries, and it has to fit the JSON body limit —
        // a separate ceiling from the storage quota, which is exactly the trap that made large
        // message attachments fail mysteriously before they moved to presigned upload.
        if (audio_base64.length > INLINE_AUDIO_MAX_CHARS) {
          return res.status(400).json(error(config.nodeId, 'AUDIO_TOO_LARGE',
            `Inline audio is limited to ~${Math.round(INLINE_AUDIO_MAX_CHARS * 0.75 / 1048576)} MB. Upload it to storage and pass storage_key instead.`));
        }
        audio = {
          data: Buffer.from(audio_base64, 'base64'),
          mime: mime || 'audio/webm',
          filename: filename || 'audio.webm',
        };
      } else {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY',
          'Provide storage_key (preferred) or audio_base64.'));
      }

      try {
        const r = await transcribeForOwner(storage, config, gaii, {
          audio, model, language, verbose: !!verbose, appId: app_id,
        });
        res.json(success(config.nodeId, {
          text: r.text,
          model: r.model,
          language: r.language ?? null,
          seconds: r.seconds,
          usage: {
            total_tokens: r.usage.totalTokens,
            cost_usd: r.usage.costUsd,
            cost_exact: r.usage.costExact,
          },
          budget: {
            daily_budget_usd: r.budget.dailyBudgetUsd,
            spent_today_usd: r.budget.spentTodayUsd,
            remaining_usd: r.budget.remainingUsd,
          },
        }));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          return res.status(e.status).json(error(config.nodeId, e.code, e.message));
        }
        return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
      }
    });

  // ── POST /v1/ai/image ── generate an image on the owner's key.
  // The bytes land in the caller's own storage and the answer is a key and a URL, never base64: a
  // picture returned inline would travel through a tool result and an agent's context for nothing,
  // and this node already has a place where bytes live and can be pointed at.
  // requireScope('ai:use') as MIDDLEWARE rather than only the in-handler gate: an owner session
  // bypasses scopes there, so it admits exactly who gateOwnerOrAiUseAgent admits, and it says so
  // where the route-scope audit can read it. The in-handler gate stays because it also refuses an
  // owner-role token that is really an agent or an ecosystem app, which a scope word cannot express.
  router.post('/v1/ai/image',
    requireAuth(), requireScope('ai:use'), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      req.setTimeout(300_000);
      res.setTimeout(300_000);

      const gaii = resolve(req);
      const { prompt, model, size, storage_key, public: isPublic, app_id } = req.body as {
        prompt?: string; model?: string; size?: string; storage_key?: string;
        public?: boolean; app_id?: string;
      };

      try {
        const r = await generateForOwner(storage, config, gaii, {
          prompt: prompt ?? '', model, size, storageKey: storage_key,
          publicVisibility: isPublic === true, appId: app_id,
        });
        res.json(success(config.nodeId, {
          storage_key: r.storageKey,
          mime_type: r.mime,
          size: r.sizeBytes,
          model: r.model,
          visibility: r.visibility,
          url: `/v1/storage/${r.storageKey.split('/').map(encodeURIComponent).join('/')}`,
          usage: { cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
          budget: {
            daily_budget_usd: r.budget.dailyBudgetUsd,
            spent_today_usd: r.budget.spentTodayUsd,
            remaining_usd: r.budget.remainingUsd,
          },
        }, [
          { description: 'Download the image', method: 'GET', url: `/v1/storage/${r.storageKey}` },
        ]));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          return res.status(e.status).json(error(config.nodeId, e.code, e.message));
        }
        return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
      }
    });

  // ── GET /v1/ai/available ── lightweight "can I run AI?" probe.
  // Owner-only `/v1/ai/settings` (which exposes hasApiKey) is NOT reachable by an app-grant
  // token, so a sandboxed app cannot use it to decide whether to show its AI affordances. This
  // endpoint answers just the boolean, gated identically to /complete (owner OR ai:use scope), so
  // an app can gate its UI without owner privileges. Resolves the owner from the caller's identity
  // (app tokens resolve to the owner GHII), matching the key completeForOwner will actually read.
  router.get('/v1/ai/available',
    requireAuth(), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      const gaii = resolve(req);
      const [apiKeyRecord, prefsRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
      ]);
      const encrypted = (apiKeyRecord?.value as { encrypted?: string } | undefined)?.encrypted;
      const provider = ((prefsRecord?.value as Record<string, unknown> | undefined)?.provider as string) || 'openrouter';
      // openrouter needs a key; self-hosted providers (lmstudio/custom) can run keyless.
      const available = !!encrypted || provider !== 'openrouter';
      res.json(success(config.nodeId, { available }));
    });

  // ── GET /v1/ai/usage ── today's spend breakdown
  router.get('/v1/ai/usage',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const usage = await getTodayUsage(storage, gaii);
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const dailyBudget = getDailyBudgetUsd(prefs);
      res.json(success(config.nodeId, {
        date: usage.date,
        daily_budget_usd: dailyBudget,
        spent_today_usd: usage.total_cost_usd,
        remaining_usd: Math.max(0, dailyBudget - usage.total_cost_usd),
        total_calls: usage.total_calls,
        total_tokens: usage.total_tokens,
        per_app: usage.per_app,
      }));
    });

  // ── GET /v1/ai/usage/history ── owner-only, per-day spend series + 24h/7d/30d rollups (per-app).
  // Reads the retained ai-usage.<gaii>.<day> records; feeds the profile home card + Generator chart.
  router.get('/v1/ai/usage/history',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const days = Number(req.query.days);
      const history = await getUsageHistory(storage, gaii, Number.isFinite(days) ? days : 30);
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      res.json(success(config.nodeId, {
        daily_budget_usd: getDailyBudgetUsd(prefs),
        ...history,
      }));
    });

  // ── GET /v1/admin/ai-usage ── operator-only cross-user AI-spend aggregate (per-app + per-user).
  // Note: per-app attribution uses the self-reported app_id (spoofable) — fine for reporting, not a
  // security boundary. Backs the admin dashboard "AI Apps Usage" tab.
  router.get('/v1/admin/ai-usage',
    requireAuth(),
    async (req: Request, res: Response) => {
      if (!req.auth?.roles?.includes('operator')) {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Operator role required.'));
      }
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const data = await getAdminAiUsage(storage, { from, to });
      res.json(success(config.nodeId, data));
    });

  // ── GET /v1/ai/settings ──
  router.get('/v1/ai/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      res.json(success(config.nodeId, {
        daily_budget_usd: getDailyBudgetUsd(prefs),
        app_quotas: (prefs.app_quotas as Record<string, unknown>) ?? {},
        app_allowlist: Array.isArray(prefs.app_allowlist) ? prefs.app_allowlist : null,
        defaults: {
          daily_budget_usd: DEFAULT_DAILY_BUDGET_USD,
          // null = an app defaults to the whole daily budget; app_quotas.<app> overrides it.
          per_app_daily_usd: null,
          max_tokens_ceiling: null,
        },
      }));
    });

  // ── POST /v1/ai/settings ── update budget/quotas/allowlist
  router.post('/v1/ai/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const { daily_budget_usd, app_quotas, app_allowlist } = req.body as {
        daily_budget_usd?: number;
        app_quotas?: Record<string, { daily_usd?: number }>;
        app_allowlist?: string[] | null;
      };
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = { ...(prefsRecord?.value as Record<string, unknown> ?? {}) };
      if (typeof daily_budget_usd === 'number') {
        if (daily_budget_usd < 0 || daily_budget_usd > 1000) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BUDGET', 'daily_budget_usd must be between 0 and 1000.'));
        }
        prefs.daily_budget_usd = daily_budget_usd;
      }
      if (app_quotas !== undefined) prefs.app_quotas = app_quotas;
      if (app_allowlist !== undefined) prefs.app_allowlist = app_allowlist;
      await upsertMemory(gaii, 'openrouter.settings', prefs, ['openrouter', 'settings']);
      // Changing what the account may spend is a decision about money, and the person should be
      // able to see later that it was made and when. The row names WHAT changed, not the values —
      // a budget is on the settings page, and a feed row is not a diff.
      const changed = [
        typeof daily_budget_usd === 'number' ? 'budget' : '',
        app_quotas !== undefined ? 'quotas' : '',
        app_allowlist !== undefined ? 'allowlist' : '',
      ].filter(Boolean).join(', ');
      if (changed) {
        void recordAccountEvent(storage, {
          ownerGhii: gaii,
          kind: 'ai_settings_changed',
          actorGaii: resolveIdentity(req.auth!, config.nodeId),
          link: '/v1/profile?tab=ai',
          data: { changed },
        }, config);
      }
      res.json(success(config.nodeId, { saved: true }));
    });

  return router;
}
