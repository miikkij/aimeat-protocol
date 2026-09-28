/**
 * @file ai/media.js
 * @description The JSON calls of AIMEAT.ai beyond text: image() (POST /v1/ai/image), transcribe()
 *   (POST /v1/ai/transcribe) and embed() (POST /v1/ai/embed). Each asks for a capability, not a
 *   model: the owner's providers and model policy choose, and the answer's `route` says which
 *   provider answered and whether the call moved on to another one (`route.fellBack`).
 *
 *   `provider` names one of the owner's providers (its id, or a type such as 'openai') and `fallback:
 *   false` keeps the call on it. Both only narrow what the owner allows; neither adds a provider.
 * @structure image(opts) · transcribe(opts) · embed(opts)
 * @usage const pic = await AIMEAT.ai.image({ app_id, prompt, confirm: true }); img.src = pic.src;
 * @version-history
 *   v1.0.1 - 2026-09-28 - image() answers `src`, which loads for a private picture too (the signed
 *     download_url); `url` needed storage:read. Found by the V5 browser check.
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: image, transcribe and embed for apps.
 */
import { paid, postJson, isBlob, blobToBase64 } from './call.js';
import { capabilities, priceEstimate } from './capabilities.js';

/**
 * The routing fields every capability call shares, left out when the caller did not set them.
 * @param {any} opts
 * @returns {{ provider?: string, fallback?: boolean }}
 */
export function routing(opts) {
  return {
    ...(typeof opts.provider === 'string' && opts.provider ? { provider: opts.provider } : {}),
    ...(typeof opts.fallback === 'boolean' ? { fallback: opts.fallback } : {}),
  };
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
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function image(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  if (!opts.prompt) throw new Error('opts.prompt required');
  const body = {
    prompt: opts.prompt, model: opts.model, size: opts.size, storage_key: opts.storage_key,
    public: opts.public === true ? true : undefined, app_id: opts.app_id, ...routing(opts),
  };
  return paid(opts, {
    key: ['ai-image', opts.app_id, opts.model, opts.size, opts.storage_key, opts.provider, opts.prompt],
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
    key: ['ai-transcribe', opts.app_id, opts.model, opts.language, opts.storage_key || audio || ''],
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
    key: ['ai-embed', opts.app_id, opts.model, opts.provider, JSON.stringify(opts.input)],
    what: 'Make embeddings on your own AI provider.',
    label: 'The embedding',
    remember: 'ai-embed:' + (opts.app_id || 'app'),
  }, () => postJson('/v1/ai/embed', body, 'Embedding failed'));
}
