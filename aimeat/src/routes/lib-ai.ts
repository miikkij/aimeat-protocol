import type { AimeatConfig } from '../config.js';

/**
 * aimeat-ai.js — Browser-side AI capability that uses the user's own
 * OpenRouter (or compatible) API key, configured once via AIMEAT Settings.
 *
 * Apps detect availability and surface "✨ Use AI" affordances:
 *   const ok = await AIMEAT.ai.isAvailable();
 *   if (ok) document.getElementById('suggest').onclick = async () => {
 *     const r = await AIMEAT.ai.complete({
 *       prompt: 'Suggest 5 short genre tags for:\n' + summary,
 *       modelRole: 'execution',
 *       max_tokens: 60,
 *       app_id: 'my-app-name',  // for per-app spend tracking
 *     });
 *     output.value = r.content;
 *   };
 *
 * The user's key never leaves the AIMEAT server. Errors are thrown with a
 * descriptive `.code` (e.g. NO_API_KEY, QUOTA_EXHAUSTED, APP_NOT_ALLOWED) so
 * apps can show actionable messages.
 *
 * Requires aimeat-auth.js loaded first.
 */
export function aimeatAiLib(config: AimeatConfig): string {
  return `// aimeat-ai.js — AIMEAT AI capability (user-owned OpenRouter key)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
(function(global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-ai.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

// 60s in-memory cache for isAvailable so apps can call it on every render
// without hammering the server. Cleared on logout via storage event.
let _availCache = null;

// 1h in-memory cache for models() — the list barely changes in practice.
let _modelsCache = null;

const ai = {
  /**
   * Returns true if the user has an OpenRouter key configured.
   * Cached 60 seconds. Apps should call this before showing "Use AI" buttons.
   */
  async isAvailable() {
    const now = Date.now();
    if (_availCache && (now - _availCache.t) < 60_000) return _availCache.v;
    try {
      const r = await authFetch('/v1/openrouter/settings');
      const v = !!(r && r.ok && r.data && r.data.has_api_key);
      _availCache = { v, t: now };
      return v;
    } catch (e) { return false; }
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
      const err = new Error(msg);
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
    const suffix = '\\nReturn ONLY valid JSON, no prose, no markdown fences.';
    const first = await ai.complete({
      ...opts,
      systemPrompt: (opts.systemPrompt || '') + suffix,
    });
    try { return { ...first, parsed: JSON.parse(first.content) }; }
    catch (e) {
      // One retry with a stronger instruction.
      const retry = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || '') + suffix + '\\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.',
        temperature: typeof opts.temperature === 'number' ? Math.max(0, opts.temperature - 0.3) : 0.2,
      });
      try { return { ...retry, parsed: JSON.parse(retry.content) }; }
      catch (e2) {
        const err = new Error('AI returned invalid JSON twice. Original response: ' + retry.content.slice(0, 200));
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

if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.ai = ai;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
