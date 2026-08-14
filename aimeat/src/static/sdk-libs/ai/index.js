/**
 * @file ai/index.js
 * @description The aimeat-ai library (SDK-libs migration Phase 1). Exposes AIMEAT.ai — a facade
 *   (isAvailable/complete/completeJson/models/usage/invalidateCache) that proxies to /v1/ai/* using
 *   the user's own OpenRouter key via the AIMEAT.auth session, so the key never leaves the server;
 *   short in-memory caches + typed error `.code`s. Componentized ESM source esbuild bundles to the
 *   IIFE served, unchanged, at /v1/libs/aimeat-ai.js. Ported verbatim from lib-ai.ts.
 * @structure imports authFetch (session) + attach (namespace) + the _core spend guard + ./disclose.js
 *   (the transparency primitives); _availCache / _modelsCache; the `ai` facade; attach('ai', …) +
 *   attachSpend().
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-ai.js"></script>
 *   if (await AIMEAT.ai.isAvailable()) { const r = await AIMEAT.ai.complete({ prompt, app_id }); }
 * @version-history
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 5, ADDITIVE. complete() carries the node's provenance
 *     record through as `provenance` (it rides in the envelope's `meta`, so `data` — the shape every
 *     published app reads — is untouched and completeJson() inherits it by spreading). New:
 *     disclose() renders the visible label, chatNotice() the Art. 50(1) notice, declare() attaches
 *     the record to something the app stores. An app that only reads `content` is unaffected.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-ai.ts (SDK-libs migration Phase 1).
 *   v1.1.0 — 2026-07-31 — Spend guard: identical in-flight completions collapse to one paid call
 *     (allowDuplicate/dedupeMs opt out), `confirm` asks the user first (SPEND_CANCELLED on a no),
 *     and each response's budget is remembered so a later confirm can show what is left.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-ai.js');
import { attach } from '../_core/namespace.js';
import { once, keyOf, confirmSpend, noteBudget, cancelledError, attachSpend } from '../_core/spend.js';
import { disclose, chatNotice, declare } from './disclose.js';

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
   * This spends the signed-in user's own OpenRouter money, so two guards ride along:
   *   • repeats collapse — while an identical call (same app_id + model + prompts) is in flight,
   *     every further call gets the SAME promise. Five clicks on "Summarise" = one paid call.
   *     `allowDuplicate: true` opts out; `dedupeMs: N` also returns the result to a click made
   *     within N ms of the first one finishing.
   *   • `confirm: true` (or an object passed straight to AIMEAT.spend.confirm) asks the user
   *     first — use it for batches and anything the user did not directly click for. A cancel
   *     rejects with `.code === 'SPEND_CANCELLED'`.
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
   *   SPEND_CANCELLED       — the user declined the confirm dialog
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
    const call = async () => {
      if (opts.confirm) {
        const c = typeof opts.confirm === 'object' ? opts.confirm : {};
        const okToSpend = await confirmSpend({
          what: c.what || 'Run an AI request on your own OpenRouter key.',
          detail: c.detail, estimate: c.estimate, remaining: c.remaining,
          okLabel: c.okLabel, cancelLabel: c.cancelLabel,
          remember: c.remember || ('ai:' + (opts.app_id || 'app')),
        });
        if (!okToSpend) throw cancelledError('The AI request');
      }
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
      if (r.data) noteBudget(r.data.budget);
      // ADDITIVE, and it cannot break a published app: the provenance record rides in the envelope's
      // `meta`, not in `data`, so `content` / `model` / `usage` / `budget` are exactly what they were
      // and an app that never heard of provenance keeps working. An app that wants the label hands
      // this straight to AIMEAT.ai.disclose(). completeJson() spreads the result, so it inherits it.
      return r.meta && r.meta.provenance ? { ...r.data, provenance: r.meta.provenance } : r.data;
    };
    if (opts.allowDuplicate) return call();
    const key = keyOf(['ai', opts.app_id, opts.model || opts.modelRole, opts.systemPrompt, opts.prompt]);
    return once(key, call, { ttlMs: opts.dedupeMs || 0 });
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

  /**
   * Show the user that a model made this. ONE call, no styling decisions.
   *
   *   const r = await AIMEAT.ai.complete({ app_id: 'my-app', prompt });
   *   render(r.content);
   *   AIMEAT.ai.disclose(r.provenance, { target: '#answer-label' });
   *
   * Renders the same badge the platform renders — same official EU icon, same stylesheet, same theme
   * variables — so it follows your app's light/dark mode for free. It returns null and draws nothing
   * when the content owes no label; the legal test already happened on the server, so pass the
   * record and let this decide. `variant: 'block'` gives the banner form for a body of text; the
   * default inline chip suits a title row or a card.
   */
  disclose,

  /**
   * The first-message notice for a chat surface: "you are talking to an AI assistant."
   *
   *   AIMEAT.ai.chatNotice({ target: '#chat-top' });
   *
   * Owed the moment a conversation opens, so it takes no record and is never suppressed.
   */
  chatNotice,

  /**
   * Keep the record with the content when you store or publish it.
   *
   *   await AIMEAT.data.set(key, AIMEAT.ai.declare({ text: r.content }, r.provenance));
   *
   * Returns a new object carrying `aiProvenance`, so anything that reads the record later — your own
   * app, another app, an agent — can still say how it was made.
   */
  declare,
};

attach('ai', ai);
attachSpend();
