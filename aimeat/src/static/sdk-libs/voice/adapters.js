/**
 * @file voice/adapters.js
 * @description Authenticated node adapters. Provider keys and endpoint selection remain on the server.
 * @structure request, events, nodeAdapters
 * @usage nodeAdapters(config, emit).complete(messages, { signal })
 * @version-history v1.0.0 - 2026-09-19 - STT plus NDJSON completion and speech streaming.
 */
import { getSession } from '../_core/session.js';
import { NODE_URL } from '../_core/config.js';
import { noteBudget } from '../_core/spend.js';

/** @param {any} body @param {string} path @param {AbortSignal} signal */
async function request(body, path, signal) {
  const session = /** @type {any} */ (getSession('aimeat-voice.js'));
  const send = () => fetch(NODE_URL + path, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.jwt }, body: JSON.stringify(body) });
  let response = await send();
  if (response.status === 401 && session.refresh) { await session.refresh(); signal.throwIfAborted(); response = await send(); }
  if (!response.ok) {
    const envelope = await response.json();
    throw Object.assign(new Error(envelope.error?.message || 'Voice request failed'), { code: envelope.error?.code || 'PROVIDER_ERROR' });
  }
  return response;
}
/** @param {Response} response @param {(event:any) => void} emit */
async function* events(response, emit) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; let done = false;
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 2_000_000) throw new Error('Voice stream frame is too large');
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw Object.assign(new Error(event.message), { code: event.code });
        if (event.type === 'done') { done = true; if (event.budget) noteBudget(event.budget); emit(event); }
        yield event;
      }
      if (chunk.done) break;
    }
    if (!done || pending.trim()) throw new Error('Voice stream ended before completion');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
/** @param {any} config @param {(event:any) => void} emit */
export function nodeAdapters(config, emit) {
  return {
    async transcribe(blob, { signal }) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const response = await request({ audio_base64: btoa(binary), mime: blob.type, filename: 'voice.wav',
        model: config.stt.model || undefined, language: config.stt.language || config.language.split('-')[0],
        temperature: config.stt.temperature, app_id: config.appId }, '/v1/ai/transcribe', signal);
      const envelope = await response.json();
      if (envelope.data?.budget) noteBudget(envelope.data.budget);
      emit({ type: 'usage', stage: 'stt', ...envelope.data });
      return envelope.data.text;
    },
    async *complete(messages, { signal }) {
      const response = await request({ messages, app_id: config.appId, model: config.llm.model || undefined,
        temperature: config.llm.temperature, top_p: config.llm.topP, max_tokens: config.llm.maxTokens ?? undefined,
        reasoning: config.llm.reasoning }, '/v1/ai/stream', signal);
      for await (const event of events(response, e => emit({ ...e, stage: 'llm' }))) if (event.type === 'text') yield event.text;
    },
    async *speak(text, { signal }) {
      const response = await request({ input: text, app_id: config.appId, model: config.tts.model,
        voice: config.tts.voice, response_format: config.tts.format, speed: config.tts.speed,
        instructions: config.tts.instructions }, '/v1/ai/speak', signal);
      for await (const event of events(response, e => emit({ ...e, stage: 'tts' }))) {
        if (event.type === 'audio') yield Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
      }
    },
  };
}
