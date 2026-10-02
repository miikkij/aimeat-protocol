/**
 * @file ai/index.js
 * @description The aimeat-ai library (SDK-libs migration Phase 1). Exposes AIMEAT.ai — a facade
 *   (capabilities/isAvailable/complete/completeJson/stream/image/speak/transcribe/embed/models/roles/
 *   usage/invalidateCache) that proxies to /v1/ai/* on the person's own AI providers via the AIMEAT.auth
 *   session, so no key ever leaves the server; short in-memory caches + typed error `.code`s.
 *   Componentized ESM source esbuild bundles to the IIFE served at /v1/libs/aimeat-ai.js.
 * @structure imports authFetch (session) + attach (namespace) + the _core spend guard + ./call.js
 *   (typed errors, the paid-call guard) + ./capabilities.js (capabilities, models) + ./stream.js
 *   (stream, speak) + ./media.js (image, transcribe, embed) + ./disclose.js (the transparency
 *   primitives) + ./job.js; _availCache; the `ai` facade; attach('ai', …) + attachSpend().
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-ai.js"></script>
 *   const caps = await AIMEAT.ai.capabilities({ app_id });
 *   if (caps.capabilities.text.on) { const r = await AIMEAT.ai.complete({ prompt, app_id }); }
 * @version-history
 *   v1.8.0 - 2026-10-02 - The capability that is off and the refused call both carry the person's
 *     sentence (`fix`) and `settingsUrl`; the docs say to show both (call.js aiError lifts them).
 *   v1.7.0 - 2026-09-28 - AI roles: complete(), stream(), image(), speak(), transcribe(), embed() and
 *     job.start() send `role`; roles() reads GET /v1/ai/roles.
 *   v1.6.0 - 2026-09-28 - System 2 plan, V5. capabilities() says per capability whether it is on
 *     and, when it is off, the fix to show the person. complete() sends `files` (storage keys, data:
 *     URLs or Blobs), `provider` and `fallback`. New: stream(), image(), speak(), transcribe(),
 *     embed(). models() reads GET /v1/ai/models, which an app grant with ai:use can call, instead
 *     of the owner-only /v1/openrouter/models; it takes { capability, type, status, allowed } and
 *     each row adds context_length and pricing in the old listing's form. A failed call's error
 *     carries the node's refusal details on `.details`.
 *   v1.5.0 - 2026-09-13 - complete() sends `images`, and the spend guard counts them as part of the
 *     call. The route had accepted pictures since June and this body dropped them. The JSDoc names
 *     finish_reason and truncated, which the route now answers.
 *   v1.4.0 - 2026-08-31 - AIMEAT.ai.job.* : background jobs (start/get/list/cancel/waitFor). A
 *     completion that takes half an hour cannot be a fetch an app holds open, and every published
 *     app would otherwise have written its own sentence for "the node is busy". The refusal codes
 *     become human words once, here.
 *   v1.3.0 — 2026-08-22 — completeJson() honours `schema`. The parameter had been in the build
 *     specs since July and in no code path at all: complete() builds its body from a fixed field
 *     list, so the schema was dropped in silence and the caller got an unvalidated 200 carrying
 *     the model's own key names. The shape now reaches the model, the answer is checked against
 *     it, a single wrapper key is unwrapped, and a second miss throws JSON_SCHEMA_MISMATCH.
 *     A caller that passes no schema is byte-for-byte unchanged.
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
import { attachSpend } from '../_core/spend.js';
import { disclose, chatNotice, declare } from './disclose.js';
import { job } from './job.js';
import { paid, postJson, isBlob, blobToDataUrl } from './call.js';
import { capabilities, models, roles, clearCaches } from './capabilities.js';
import { stream, speak } from './stream.js';
import { image, transcribe, embed, routing } from './media.js';

// 60s in-memory cache for isAvailable so apps can call it on every render
// without hammering the server. Cleared on logout via storage event.
/** @type {{ v: boolean, t: number } | null} */
let _availCache = null;

/**
 * The `files` of a completion in the form the route reads: { storage_key } or { data_url, filename }.
 * A Blob or File becomes a data: URL here; a string is a data: URL when it starts with "data:" and a
 * storage key otherwise; an object passes as it is. Undefined when the caller gave no files (an empty
 * list included, which the route would refuse).
 * @param {any} files
 * @returns {Promise<any[]|undefined>}
 */
async function callFiles(files) {
  if (files === undefined || files === null) return undefined;
  const list = Array.isArray(files) ? files : [files];
  if (!list.length) return undefined;
  return Promise.all(list.map(async (f) => {
    if (isBlob(f)) return { data_url: await blobToDataUrl(f), ...(/** @type {any} */ (f).name ? { filename: /** @type {any} */ (f).name } : {}) };
    if (typeof f === 'string') return f.startsWith('data:') ? { data_url: f } : { storage_key: f };
    return f;
  }));
}

/**
 * The top-level keys a `schema` asks for. Accepts a JSON-Schema object (`properties` plus an optional
 * `required`) or a plain example object, because both are what people actually pass. Anything else
 * (a string, an array, nothing at all) asks for no particular keys, and the check stands down.
 * @param {any} schema
 * @returns {string[]}
 */
function requiredKeysOf(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  if (schema.properties && typeof schema.properties === 'object') {
    const declared = Object.keys(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required.filter(k => typeof k === 'string') : null;
    return required && required.length ? required : declared;
  }
  return Object.keys(schema);
}

/**
 * Check a parsed answer against the requested keys, unwrapping one layer when the model has put the
 * whole object inside a single wrapper key. Throws JSON_SCHEMA_MISMATCH when the keys are not there,
 * so the caller's existing retry path treats a wrong shape exactly like a parse failure.
 * @param {any} parsed
 * @param {string[]} want
 */
function conform(parsed, want) {
  if (!want.length) return parsed;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const has = (v) => isObj(v) && want.every(k => k in v);
  if (has(parsed)) return parsed;
  if (isObj(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && has(parsed[keys[0]])) return parsed[keys[0]];
  }
  const missing = want.filter(k => !(isObj(parsed) && k in parsed));
  const present = isObj(parsed) ? (Object.keys(parsed).join(', ') || '(none)') : typeof parsed;
  const err = /** @type {Error & { code?: string }} */ (new Error('missing ' + missing.join(', ') + '; got ' + present));
  err.code = 'JSON_SCHEMA_MISMATCH';
  throw err;
}

const ai = {
  /**
   * What the person's AI can do for this app, per capability (text, vision, files, image, speech,
   * transcription, embed): { on, model, price, ... } when on, { on: false, reason, fix, settingsUrl }
   * when off. Ask this before showing a button that needs a capability; when it is off, show `fix`
   * (the person's sentence, in their language) and a link to `settingsUrl` (their AI settings, opened
   * where the fix is). A refused call's error carries the same as err.fix and err.settingsUrl.
   * Cached 60 seconds per app_id.
   *
   *   const caps = await AIMEAT.ai.capabilities({ app_id: 'my-app' });
   *   const img = caps.capabilities.image;
   *   if (!img.on) { notice.textContent = img.fix; link.href = img.settingsUrl; }
   */
  capabilities,

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
   * Run a single completion. Returns { content, model, usage, budget, finish_reason, truncated,
   * route, policy_chose_model? }.
   * `truncated` is true when the provider cut the answer at a token limit (finish_reason 'length'):
   * show it as unfinished or ask again, never as the whole answer.
   * `route` says who answered: { capability, chosenBy, answeredBy: { provider, model }, attempts,
   * fellBack }; `fellBack` is true when the first provider failed and another one answered.
   * `policy_chose_model` is true when the owner's model policy replaced the model the call asked for.
   * Throws an Error with .code set on quota/permission/auth failures, and `.details` when the node
   * says more (a policy refusal lists the models it would allow).
   *
   * `images`: an array of data: or https: URLs (at most 8; downscale first) turns the call into a
   * vision request, answered by the owner's vision model.
   *
   * `files`: documents the model reads itself (a PDF, a spreadsheet), at most 5 and 20 MB in all.
   * Each is a storage key of the person's own file, a data: URL, a Blob or File, or an object
   * { storage_key } | { data_url, filename }. Needs the files capability (see capabilities()).
   *
   * `provider` names one of the owner's providers (its id, or a type such as 'anthropic') and
   * `fallback: false` keeps the call on that one provider. Neither can add a provider or loosen
   * the owner's rules.
   *
   * `role` names the AI role the call runs as: for an app, a role it declares in its aimeat-ai meta
   * (role.<name>=text), which runs once the owner bound it to one of theirs; a named model or
   * provider wins over it. See roles().
   *
   * This spends the signed-in user's own money on their own AI provider, so two guards ride along:
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
   *   AI_ROLE_NOT_BOUND     — the owner has not bound this app's role yet (.details.binding)
   *   AI_ROLE_NOT_DECLARED  — the app's meta does not declare that role
   *   AI_ROLE_UNKNOWN       — the owner has no role of that id
   *   AI_ROLE_LACKS_CAPABILITY — the role has no provider for what the call needs
   */
  async complete(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('opts object required');
    if (!opts.prompt) throw new Error('opts.prompt required');
    const files = await callFiles(opts.files);
    const body = {
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      modelRole: opts.modelRole,
      temperature: opts.temperature,
      top_p: opts.top_p,
      max_tokens: opts.max_tokens,
      app_id: opts.app_id,
      // Pictures for a vision request: data: or https: URLs, at most 8 (the route refuses more).
      // POST /v1/ai/complete has read this since 2026-06-24 and this body never carried it, so a
      // question about a picture went out as text alone and the model answered it anyway.
      images: Array.isArray(opts.images) ? opts.images : undefined,
      // Documents the model reads itself (the files capability), and the caller's word on which
      // provider answers. Absent keys are dropped by JSON.stringify, so a call without them sends
      // the same body as before.
      files,
      ...routing(opts),
    };
    // postJson carries the provenance record from the envelope's `meta` onto the result as
    // `provenance`, so `content` / `model` / `usage` / `budget` are exactly what they were and an
    // app that never heard of provenance keeps working. completeJson() spreads the result, so it
    // inherits it. The pictures and the files are part of what makes two calls the same call;
    // without them a second picture under one prompt would be handed the first picture's answer.
    return paid(opts, {
      key: ['ai', opts.app_id, opts.model || opts.modelRole, opts.systemPrompt, opts.prompt,
        Array.isArray(opts.images) ? opts.images.join('\n') : '',
        files ? JSON.stringify(files) : '', opts.provider || '', opts.role || ''],
      what: 'Run an AI request on your own AI provider.',
    }, () => postJson('/v1/ai/complete', body, 'AI call failed'));
  },

  /**
   * Convenience: complete + JSON.parse. Adds a "return ONLY valid JSON"
   * suffix to systemPrompt. On parse failure, retries ONCE with a stronger
   * instruction. Further failures throw — the user can retry by clicking.
   *
   * `schema` states the shape you need back: either a JSON-Schema object
   * (`{ type: 'object', properties: { … }, required: [ … ] }`) or a plain
   * example object whose keys are the keys you want. Three build specs have
   * advertised this parameter since July while no code path read it, because
   * complete() builds its body from a fixed field list — so it was dropped on
   * the way in and the caller got an unvalidated 200 under the model's own key
   * names. That reads as a bug in the app, since nothing points at the library.
   * The shape now reaches the model, the answer is checked against it, and a
   * miss is retried once the way a parse failure is. Two misses throw
   * JSON_SCHEMA_MISMATCH naming the keys that never arrived.
   *
   * A model that wraps the answer in one extra key is unwrapped rather than
   * refused: it is the commonest way a model complies in spirit, and it is what
   * every app here hand-rolls today.
   */
  async completeJson(opts) {
    const want = requiredKeysOf(opts && opts.schema);
    const shape = opts && opts.schema
      ? '\nReturn an object with exactly this shape, using these key names: ' + JSON.stringify(opts.schema)
      : '';
    const suffix = '\nReturn ONLY valid JSON, no prose, no markdown fences.' + shape;
    const read = (r) => ({ ...r, parsed: conform(JSON.parse(r.content), want) });
    const first = await ai.complete({
      ...opts,
      systemPrompt: (opts.systemPrompt || '') + suffix,
    });
    try { return read(first); }
    catch {
      // One retry with a stronger instruction. A shape miss is retried the same way a parse failure
      // is: from the caller's side both are "the answer is not the thing I asked for".
      const insist = want.length
        ? '\nIMPORTANT: your previous attempt did not match the requested shape. Output ONLY the JSON object, starting with { and ending with }, with exactly these top-level keys: ' + want.join(', ') + '.'
        : '\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.';
      const retry = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || '') + suffix + insist,
        temperature: typeof opts.temperature === 'number' ? Math.max(0, opts.temperature - 0.3) : 0.2,
      });
      try { return read(retry); }
      catch (e) {
        const mismatch = !!e && /** @type {any} */ (e).code === 'JSON_SCHEMA_MISMATCH';
        const err = /** @type {Error & { code?: string }} */ (new Error(mismatch
          ? 'AI returned JSON without the requested keys twice (' + /** @type {any} */ (e).message + '). Original response: ' + retry.content.slice(0, 200)
          : 'AI returned invalid JSON twice. Original response: ' + retry.content.slice(0, 200)));
        err.code = mismatch ? 'JSON_SCHEMA_MISMATCH' : 'JSON_PARSE_FAILED';
        throw err;
      }
    }
  },

  /**
   * A text reply piece by piece: onText(delta, soFar) per piece, and the promise resolves with
   * { content, model, finish_reason, truncated, usage, budget, provenance }.
   *
   *   await AIMEAT.ai.stream({ app_id, prompt, onText: (d, all) => { out.textContent = all; } });
   */
  stream,

  /**
   * A picture from a prompt, stored in the person's storage: { storage_key, url, model, route, ... }.
   * Pass confirm: true; the dialog shows the price per picture when the catalogue knows it.
   */
  image,

  /**
   * Speech from text: { blob, mime_type, format, bytes, model, ... } (mp3 by default).
   * onAudio(bytes) per chunk for early playback; store: true keeps it as a private file instead.
   */
  speak,

  /** Text from a recording: { text, language, seconds, model, route, ... }. */
  transcribe,

  /** Vectors for texts, for search by meaning: { embeddings, model, dimensions, route, ... }. */
  embed,

  /**
   * The models a capability can use: models({ capability: 'image' }). Default: the text models
   * this caller can use now. Rows are { ref, type, id, name, caps, limits, price, status } plus
   * context_length and pricing in the old OpenRouter listing's form. Cached 1 hour per query.
   */
  models,

  /**
   * The person's AI roles and the roles apps declare, with the owner's bindings (GET /v1/ai/roles):
   * { roles, apps: [{ app, roles: [{ name, binding, boundTo, requestedAt? }] }] }. An app's role runs
   * once boundTo is set; until then a call with that `role` is refused AI_ROLE_NOT_BOUND.
   */
  roles,

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
    clearCaches();
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

  /**
   * Background jobs: a model call with a handle, for anything that may take minutes.
   *
   *   const { job_id } = await AIMEAT.ai.job.start({ prompt, result_key: 'report.latest' });
   *   const done = await AIMEAT.ai.job.waitFor(job_id);
   *
   * complete() above is right when the answer arrives in seconds and wrong when it does not: a tab
   * that navigates away, a laptop that sleeps or a proxy that gives up takes the answer with it, and
   * the money is spent either way. A job survives all three, and its answer is waiting at
   * `result_key` whenever the app comes back.
   */
  job,
};

attach('ai', ai);
attachSpend();
