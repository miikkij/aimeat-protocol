/**
 * @file ai/stream.js
 * @description The NDJSON calls of AIMEAT.ai: stream() reads POST /v1/ai/stream (a text reply that
 *   arrives piece by piece) and speak() reads POST /v1/ai/speak (audio in base64 chunks).
 *
 *   session.fetch parses the whole body as JSON, so these two calls use fetch directly with the
 *   session's bearer token, refresh the token once on a 401, and read the body line by line. The
 *   same event shapes are read by voice/adapters.js: { type: 'start' | 'text' | 'audio' | 'done' |
 *   'error' }, one JSON object per line, and a stream without a `done` line did not finish.
 * @structure postStream(path, body, signal) · ndjson(response) · stream(opts) · speak(opts)
 * @usage const r = await AIMEAT.ai.stream({ app_id, prompt, onText: (d, all) => (el.textContent = all) });
 *   const s = await AIMEAT.ai.speak({ app_id, input: 'Hello' }); new Audio(URL.createObjectURL(s.blob)).play();
 * @version-history
 *   v1.2.0 - 2026-10-08 - speak() returns `audio` (mime, sample_rate, channels, sample_format) from the
 *     node's start and done frames, takes onStart, and types the blob by the provider's real mime.
 *   v1.1.0 - 2026-09-28 - stream() and speak() send `role`, the AI role the call runs as.
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: stream() and speak() for apps.
 */
import { getSession } from '../_core/session.js';
import { NODE_URL } from '../_core/config.js';
import { noteBudget } from '../_core/spend.js';
import { aiError, paid, postJson } from './call.js';
import { capabilities, priceEstimate } from './capabilities.js';

/**
 * POST a JSON body and return the streaming Response. A refused call answers with a JSON envelope
 * before any line is written, and becomes aiError.
 * @param {string} path
 * @param {any} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
async function postStream(path, body, signal) {
  const session = /** @type {any} */ (getSession('aimeat-ai.js'));
  const send = () => fetch(NODE_URL + path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.jwt },
    body: JSON.stringify(body),
  });
  let response = await send();
  if (response.status === 401 && typeof session.refresh === 'function') {
    await session.refresh();
    if (signal) signal.throwIfAborted();
    response = await send();
  }
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw aiError(envelope, 'The AI stream failed (HTTP ' + response.status + ')');
  }
  if (!response.body) throw aiError(null, 'The AI stream returned no body');
  return response;
}

/**
 * The events of an NDJSON body, one parsed object per line. An `error` line throws with its code;
 * a body that ends without a `done` line throws STREAM_INCOMPLETE.
 * @param {Response} response
 * @returns {AsyncGenerator<any>}
 */
async function* ndjson(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let done = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 2_000_000) throw aiError({ error: { code: 'STREAM_FRAME_TOO_LARGE' } }, 'An AI stream line exceeds 2 MB');
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw aiError({ error: { code: event.code, message: event.message, details: event.details } }, 'The AI stream failed');
        if (event.type === 'done') { done = true; if (event.budget) noteBudget(event.budget); }
        yield event;
      }
      if (chunk.done) break;
    }
    if (!done || pending.trim()) throw aiError({ error: { code: 'STREAM_INCOMPLETE' } }, 'The AI stream ended before it finished');
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    reader.releaseLock();
  }
}

/**
 * The `done` event's fields without its `type`, which is what a caller receives as the result.
 * @param {any} event
 * @returns {any}
 */
function withoutType(event) {
  const out = { ...event };
  delete out.type;
  return out;
}

/**
 * A text reply that arrives piece by piece. `onText(delta, soFar)` runs for each piece; the promise
 * resolves when the reply is complete, with { content, model, finish_reason, truncated, usage,
 * budget, provenance }.
 *
 * Give `messages` ([{ role: 'system' | 'user' | 'assistant', content }]) for a conversation, or
 * `prompt` with an optional `systemPrompt` for one question. `signal` (an AbortSignal) stops it; what
 * was generated before the stop is still billed. Identical calls in flight collapse into one, and the
 * second caller gets the finished result without its own onText calls; `allowDuplicate` opts out.
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function stream(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  const messages = Array.isArray(opts.messages) ? opts.messages
    : opts.prompt
      ? [...(opts.systemPrompt ? [{ role: 'system', content: String(opts.systemPrompt) }] : []), { role: 'user', content: String(opts.prompt) }]
      : null;
  if (!messages || !messages.length) throw new Error('opts.messages or opts.prompt required');
  // The route validates strictly: only these keys, and undefined ones are dropped by JSON.stringify.
  const body = {
    app_id: opts.app_id, messages, model: opts.model,
    temperature: opts.temperature, top_p: opts.top_p, max_tokens: opts.max_tokens, reasoning: opts.reasoning,
    role: typeof opts.role === 'string' && opts.role ? opts.role : undefined,
  };
  return paid(opts, {
    key: ['ai-stream', opts.app_id, opts.model, opts.role, JSON.stringify(messages)],
    what: 'Run an AI request on your own AI provider.',
  }, async () => {
    const response = await postStream('/v1/ai/stream', body, opts.signal);
    let content = '';
    let start = null;
    let done = null;
    for await (const event of ndjson(response)) {
      if (event.type === 'start') start = event;
      else if (event.type === 'text' && typeof event.text === 'string') {
        content += event.text;
        if (opts.onText) opts.onText(event.text, content);
      } else if (event.type === 'done') done = event;
    }
    const rest = withoutType(done);
    return { ...rest, content, model: rest.model || (start && start.model) };
  });
}

/** The MIME type of a speech format. */
const SPEECH_MIME = { mp3: 'audio/mpeg', pcm: 'audio/pcm' };

/**
 * Speech from text. Resolves with { blob, mime_type, format, bytes, audio, model, usage, budget, provenance }:
 * play it with new Audio(URL.createObjectURL(r.blob)) and revoke the URL afterwards. `audio` is
 * { mime, sample_rate, channels, sample_format }: for 'pcm' the layout of the raw samples (null when
 * the provider did not say), for 'mp3' the type and nulls. `onStart(frame)` receives the start frame,
 * which carries the same `audio`, before the first chunk.
 *
 * `input` (or `text`) is the text, at most 4000 characters. `format` is 'mp3' (the default here, which
 * an audio element plays) or 'pcm' (raw samples for a Web Audio player). `voice` and `model` are
 * optional: the owner's speech provider gives them. `onAudio(bytes)` receives each chunk as it
 * arrives, for playback before the whole clip is in. `store: true` keeps the clip as a private file
 * in the person's storage instead and resolves with { storage_key, fetch_url, mime_type, size_bytes }.
 * `confirm: true` asks first and shows the price when the catalogue knows it.
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function speak(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts object required');
  const input = opts.input != null ? opts.input : opts.text;
  if (!input) throw new Error('opts.input required');
  const format = opts.format || opts.response_format || 'mp3';
  const body = {
    app_id: opts.app_id, input: String(input), model: opts.model, voice: opts.voice,
    response_format: format, speed: opts.speed, instructions: opts.instructions,
    role: typeof opts.role === 'string' && opts.role ? opts.role : undefined,
  };
  return paid(opts, {
    key: ['ai-speak', opts.app_id, opts.model, opts.voice, format, opts.role, opts.store ? 'store' : '', String(input)],
    what: 'Read text aloud on your own AI provider.',
    remember: 'ai-speak:' + (opts.app_id || 'app'),
    estimate: async () => {
      const caps = await capabilities({ app_id: opts.app_id });
      return priceEstimate(caps && caps.capabilities && caps.capabilities.speech, Array.from(String(input)).length);
    },
  }, async () => {
    if (opts.store) return postJson('/v1/ai/speak?json=1', body, 'Speech failed');
    const response = await postStream('/v1/ai/speak', body, opts.signal);
    /** @type {Uint8Array<ArrayBuffer>[]} */
    const chunks = [];
    let bytes = 0;
    let done = null;
    let audio = null;
    for await (const event of ndjson(response)) {
      // The start frame says what the bytes are (mime, sample_rate, channels, sample_format), so a
      // PCM player can be set up before the first chunk; onStart hands it on.
      if (event.type === 'start') { audio = event.audio || null; if (opts.onStart) opts.onStart(event); }
      else if (event.type === 'audio' && typeof event.data === 'string') {
        const chunk = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
        chunks.push(chunk);
        bytes += chunk.length;
        if (opts.onAudio) opts.onAudio(chunk);
      } else if (event.type === 'done') done = event;
    }
    const rest = withoutType(done);
    const said = (rest.audio || audio || {}).mime;
    const mime = typeof said === 'string' && said ? said : SPEECH_MIME[format] || 'application/octet-stream';
    return { ...rest, audio: rest.audio || audio, blob: new Blob(chunks, { type: mime }), mime_type: mime, format, bytes };
  });
}
