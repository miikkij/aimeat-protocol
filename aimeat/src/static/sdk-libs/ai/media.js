/**
 * @file ai/media.js
 * @description The JSON calls of AIMEAT.ai beyond text: image() (POST /v1/ai/image), transcribe()
 *   (POST /v1/ai/transcribe) and embed() (POST /v1/ai/embed). Each asks for a capability, not a
 *   model: the owner's providers and model policy choose, and the answer's `route` says which
 *   provider answered and whether the call moved on to another one (`route.fellBack`).
 *
 *   `provider` names one of the owner's providers (its id, or a type such as 'openai') and `fallback:
 *   false` keeps the call on it. Both only narrow what the owner allows; neither adds a provider.
 *   `role` names the AI role the call runs as (GET /v1/ai/roles).
 * @structure image(opts) · transcribe(opts) · embed(opts)
 * @usage const pic = await AIMEAT.ai.image({ app_id, prompt, confirm: true }); img.src = pic.src;
 * @version-history
 *   v1.2.0 - 2026-10-18 - image() takes `reference_images` and `mask` (stored keys, data: URLs, Blobs),
 *     so an app keeps a character's look from panel to panel and redraws part of a picture
 *     (Comicland v3 A-1, A-2).
 *   v1.1.0 - 2026-09-28 - routing() carries `role`, the AI role the call runs as, so image, transcribe,
 *     embed and complete send it; it is part of what makes two calls the same call.
 *   v1.0.1 - 2026-09-28 - image() answers `src`, which loads for a private picture too (the signed
 *     download_url); `url` needed storage:read. Found by the V5 browser check.
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: image, transcribe and embed for apps.
 */
import { paid, postJson, isBlob, blobToBase64, blobToDataUrl } from './call.js';
import { capabilities, priceEstimate } from './capabilities.js';

/**
 * The routing fields every capability call shares, left out when the caller did not set them.
 * `role` is the AI role the call runs as: for an app, a role it declares in its aimeat-ai meta, which
 * runs once the owner bound it (AI_ROLE_NOT_BOUND until then); a named model or provider wins over it.
 * @param {any} opts
 * @returns {{ provider?: string, fallback?: boolean, role?: string }}
 */
export function routing(opts) {
  return {
    ...(typeof opts.provider === 'string' && opts.provider ? { provider: opts.provider } : {}),
    ...(typeof opts.fallback === 'boolean' ? { fallback: opts.fallback } : {}),
    ...(typeof opts.role === 'string' && opts.role ? { role: opts.role } : {}),
  };
}

/**
 * One input picture as /v1/ai/image takes it: a Blob or File becomes a data: URL, an object with
 * `storage_key` or `data_url` passes as it is.
 * @param {any} p
 * @returns {Promise<{ storage_key?: string, data_url?: string }>}
 */
async function pictureInput(p) {
  if (isBlob(p)) return { data_url: await blobToDataUrl(/** @type {Blob} */ (p)) };
  if (p && typeof p === 'object' && (p.storage_key || p.data_url)) {
    return p.storage_key ? { storage_key: String(p.storage_key) } : { data_url: String(p.data_url) };
  }
  throw new Error('a reference image is { storage_key }, { data_url }, or a Blob');
}

/**
 * A picture from a prompt. Resolves with { src, storage_key, url, download_url?, mime_type, size,
 * model, visibility, route, usage, budget, provenance }. The picture is stored in the person's own
 * storage. Show it with `src`: for a private picture that is `download_url`, a signed address that
 * loads without a sign-in for an hour (`url` needs storage:read, which an app with only ai:use does
 * not hold); for a public one (public: true) it is `url`. To show it again later, keep the picture
 * public, or ask for storage:read and read `storage_key`.
 *
 * `size` ('1024x1024' and the like) and `model` are optional. `storage_key` chooses where it is
 * stored. A picture costs money on most providers: pass `confirm: true` and the dialog shows the
 * catalogue's price per picture when it is known.
 *
 * `reference_images` (up to 16) are pictures the model works from, so a character, a place or a
 * style stays the same from picture to picture: each is `{ storage_key }` (a picture in the person's
 * storage, the better choice), `{ data_url }`, or a Blob or File. `mask` redraws part of the FIRST
 * reference: a PNG of the same size whose transparent pixels mark the area to redraw. The answer's
 * `mask_mode` says whether the provider applied it as a mask ('native') or followed it as one more
 * picture ('guided', on OpenRouter and xAI, which have no mask parameter).
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function image(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  if (!opts.prompt) throw new Error('opts.prompt required');
  if (opts.reference_images != null && !Array.isArray(opts.reference_images)) throw new Error('opts.reference_images must be an array');
  const refs = opts.reference_images ? await Promise.all(opts.reference_images.map(pictureInput)) : undefined;
  const mask = opts.mask ? await pictureInput(opts.mask) : undefined;
  const body = {
    prompt: opts.prompt, model: opts.model, size: opts.size, storage_key: opts.storage_key,
    public: opts.public === true ? true : undefined, app_id: opts.app_id, ...routing(opts),
    ...(refs && refs.length ? { reference_images: refs } : {}),
    ...(mask ? { mask } : {}),
  };
  return paid(opts, {
    key: ['ai-image', opts.app_id, opts.model, opts.size, opts.storage_key, opts.provider, opts.role, opts.prompt,
      JSON.stringify(refs ? refs.map(r => r.storage_key || String(r.data_url).length) : []), mask ? (mask.storage_key || String(mask.data_url).length) : ''],
    what: 'Make a picture on your own AI provider.',
    label: 'The picture',
    remember: 'ai-image:' + (opts.app_id || 'app'),
    estimate: async () => {
      const caps = await capabilities({ app_id: opts.app_id });
      return priceEstimate(caps && caps.capabilities && caps.capabilities.image, 1);
    },
  }, async () => {
    const data = await postJson('/v1/ai/image', body, 'The picture could not be made');
    return data && typeof data === 'object' ? { ...data, src: data.download_url || data.url } : data;
  });
}

/**
 * Text from speech. Resolves with { text, model, language, seconds, route, usage, budget, provenance }.
 *
 * The audio is `storage_key` (a file already in the person's storage: the better choice, nothing
 * travels twice) or `audio` (a Blob or File from a recorder or a file input, or a base64 string).
 * `language` ('fi', 'en') helps the model; `mime` and `filename` default to the Blob's own.
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function transcribe(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  if (!opts.storage_key && !opts.audio) throw new Error('opts.storage_key or opts.audio required');
  const blob = isBlob(opts.audio) ? /** @type {Blob} */ (opts.audio) : null;
  const audio = blob ? await blobToBase64(blob) : (typeof opts.audio === 'string' ? opts.audio : undefined);
  const body = {
    ...(opts.storage_key ? { storage_key: opts.storage_key } : { audio_base64: audio }),
    mime: opts.mime || (blob && blob.type) || undefined,
    filename: opts.filename || (blob && /** @type {any} */ (blob).name) || undefined,
    model: opts.model, language: opts.language, temperature: opts.temperature, verbose: opts.verbose,
    app_id: opts.app_id, ...routing(opts),
  };
  return paid(opts, {
    key: ['ai-transcribe', opts.app_id, opts.model, opts.language, opts.role, opts.storage_key || audio || ''],
    what: 'Turn a recording into text on your own AI provider.',
    label: 'The transcription',
    remember: 'ai-transcribe:' + (opts.app_id || 'app'),
  }, () => postJson('/v1/ai/transcribe', body, 'Transcription failed'));
}

/**
 * Vectors for texts, for search by meaning. Resolves with { embeddings: number[][], model,
 * dimensions, route, usage, budget }, one vector per text in the order given.
 *
 * `input` is one text or a list (at most 256 texts and 500 000 characters in one call). Vectors from
 * different models cannot be compared: keep `model` with every vector you store, and embed again when
 * it changes. A vector is 6 to 12 kB as JSON, so a collection of them does not fit in one memory
 * value (1024 kB); store them per record or in small groups.
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function embed(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  if (opts.input == null || (Array.isArray(opts.input) && !opts.input.length)) throw new Error('opts.input required');
  const body = { input: opts.input, model: opts.model, app_id: opts.app_id, ...routing(opts) };
  return paid(opts, {
    key: ['ai-embed', opts.app_id, opts.model, opts.provider, opts.role, JSON.stringify(opts.input)],
    what: 'Make embeddings on your own AI provider.',
    label: 'The embedding',
    remember: 'ai-embed:' + (opts.app_id || 'app'),
  }, () => postJson('/v1/ai/embed', body, 'Embedding failed'));
}
