/**
 * @file ai/index.js
 * @description The aimeat-ai library (SDK-libs migration Phase 1). Exposes AIMEAT.ai — a facade
 *   (isAvailable/complete/completeJson/models/usage/invalidateCache) that proxies to /v1/ai/* using
 *   the user's own OpenRouter key via the AIMEAT.auth session, so the key never leaves the server;
 *   short in-memory caches + typed error `.code`s. Componentized ESM source esbuild bundles to the
 *   IIFE served, unchanged, at /v1/libs/aimeat-ai.js. Ported verbatim from lib-ai.ts.
 * @structure imports authFetch (session) + attach (namespace); _availCache / _modelsCache; the `ai`
 *   facade; attach('ai', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-ai.js"></script>
 *   if (await AIMEAT.ai.isAvailable()) { const r = await AIMEAT.ai.complete({ prompt, app_id }); }
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-ai.ts (SDK-libs migration Phase 1).
 */
import { authFetch } from '../_core/session.js';
import { attach } from '../_core/namespace.js';

// 60s in-memory cache for isAvailable so apps can call it on every render
// without hammering the server. Cleared on logout via storage event.
/** @type {{ v: boolean, t: number } | null} */
let _availCache = null;

// 1h in-memory cache for models() — the list barely changes in practice.
/** @type {{ v: any, t: number } | null} */
let _modelsCache = null;

const ai = {
  /**
   * Returns true if the user has AI configured (an OpenRouter key, or a keyless
   * self-hosted provider). Cached 60 seconds. Apps should call this before showing
   * "Use AI" buttons. Uses GET /v1/ai/available, which an app-grant token (a sandboxed
   * app on the isolated app origin) can call with the ai:use scope — unlike the
   * owner-only /v1/openrouter/settings. Falls back to that settings probe on older nodes.
   */
  async isAvailable() {
    const now = Date.now();
    if (_availCache && (now - _availCache.t) < 60_000) return _availCache.v;
    try {
      const r = await authFetch('/v1/ai/available');
      if (r && r.ok && r.data && typeof r.data.available === 'boolean') {
        _availCache = { v: r.data.available, t: now };
        return r.data.available;
      }
      // Older node without /v1/ai/available: fall back to the owner-only settings probe.
      const s = await authFetch('/v1/openrouter/settings');
      const v = !!(s && s.ok && s.data && (s.data.hasApiKey || s.data.has_api_key));
      _availCache = { v, t: now };
      return v;
    } catch { return false; }
  },

  /**
   * Run a single completion. Returns { content, model, usage, budget }.
   * Throws an Error with .code set on quota/permission/auth failures.
   *
   * Recognized error codes (see routes/ai.ts):
   *   NO_API_KEY            — user hasn't set up a key yet
   *   QUOTA_EXHAUSTED       — daily user budget hit
   *   APP_QUOTA_EXHAUSTED   — per-app daily quota hit
   *   APP_NOT_ALLOWED       — app_id not in user's allowlist
   *   APP_ID_REQUIRED       — user has an allowlist; app must pass app_id
   *   INVALID_API_KEY       — provider rejected the key
   *   RATE_LIMITED          — provider rate limit
   *   PROVIDER_ERROR        — upstream provider failed
   */
  async complete(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('opts object required');
    if (!opts.prompt) throw new Error('opts.prompt required');
    const body = {
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      modelRole: opts.modelRole,
      temperature: opts.temperature,
      top_p: opts.top_p,
      max_tokens: opts.max_tokens,
      app_id: opts.app_id,
    };
    const r = await authFetch('/v1/ai/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) {
      const code = (r && r.error && r.error.code) || 'UNKNOWN';
      const msg = (r && r.error && r.error.message) || 'AI call failed';
      const err = /** @type {Error & { code?: string }} */ (new Error(msg));
      err.code = code;
      throw err;
    }
    return r.data;
  },

  /**
   * Convenience: complete + JSON.parse. Adds a "return ONLY valid JSON"
   * suffix to systemPrompt. On parse failure, retries ONCE with a stronger
   * instruction. Further failures throw — the user can retry by clicking.
   */
  async completeJson(opts) {
    const suffix = '\nReturn ONLY valid JSON, no prose, no markdown fences.';
    const first = await ai.complete({
      ...opts,
      systemPrompt: (opts.systemPrompt || '') + suffix,
    });
    try { return { ...first, parsed: JSON.parse(first.content) }; }
    catch {
      // One retry with a stronger instruction.
      const retry = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || '') + suffix + '\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.',
        temperature: typeof opts.temperature === 'number' ? Math.max(0, opts.temperature - 0.3) : 0.2,
      });
      try { return { ...retry, parsed: JSON.parse(retry.content) }; }
      catch {
        const err = /** @type {Error & { code?: string }} */ (new Error('AI returned invalid JSON twice. Original response: ' + retry.content.slice(0, 200)));
        err.code = 'JSON_PARSE_FAILED';
        throw err;
      }
    }
  },

  /**
   * List the models the user's account can hit. Cached 1 hour.
   */
  async models() {
    const now = Date.now();
    if (_modelsCache && (now - _modelsCache.t) < 3600_000) return _modelsCache.v;
    const r = await authFetch('/v1/openrouter/models');
    if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || 'Failed to list models');
    const v = r.data && r.data.models ? r.data.models : [];
    _modelsCache = { v, t: now };
    return v;
  },

  /**
   * Today's spend snapshot (owner-only). Useful for "AI used: $0.04 / $1.00".
   */
  async usage() {
    const r = await authFetch('/v1/ai/usage');
    if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || 'Failed to read usage');
    return r.data;
  },

  /**
   * Clear browser-side caches. Call after the user toggles their key/budget.
   */
  invalidateCache() {
    _availCache = null;
    _modelsCache = null;
  },
};

attach('ai', ai);
