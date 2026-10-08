/**
 * @file ai-voice-result.ts
 * @description Collect streamed voice results for agents; audio becomes a private file, never base64 in model context.
 * @version-history
 *   v1.1.0 - 2026-10-08 - The stored file's type is the one the provider sent (done.audio.mime), and the
 *     result carries `audio` { mime, sample_rate, channels, sample_format } from the done frame instead
 *     of a note saying the PCM layout "follows the provider". A size cap is 413 TOO_LARGE and a stream
 *     without its done frame the node's 500, both typed (aiprov plan, A4, A8).
 *   v1.0.0 - 2026-09-19 - Bounded JSON delivery using the same metered voice stages.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { writeStorageFile } from './storage-file-write.js';
import { AiCompletionError } from './ai/completion.js';

export function createVoiceResult() {
  let text = '', size = 0, done: Record<string, unknown> | undefined;
  const audio: Buffer[] = [];
  const incomplete = (what: string) => new AiCompletionError('INTERNAL_ERROR', 500, `The ${what} stream ended without its done frame.`);
  return {
    async emit(event: Record<string, unknown>) {
      if (event.type === 'text') text += String(event.text);
      if (event.type === 'audio') {
        const bytes = Buffer.from(String(event.data), 'base64'); size += bytes.length;
        if (size > 16_000_000) throw new AiCompletionError('TOO_LARGE', 413, 'The speech passed 16 MB. Send a shorter input.');
        audio.push(bytes);
      }
      if (event.type === 'done') done = event;
    },
    reply() { if (!done) throw incomplete('voice'); return { ...done, text }; },
    async speech(storage: Storage, config: AimeatConfig, owner: string, format: 'pcm' | 'mp3', signal: AbortSignal) {
      if (!done || !size) throw incomplete('speech');
      signal.throwIfAborted();
      const key = `ai-speech/${randomUUID()}.${format}`;
      // The type the provider sent (services/ai-voice-audio.ts), so an mp3 that came as audio/mp3 or a
      // PCM that came as audio/L16 is stored as what it is.
      const said = (done.audio as { mime?: unknown } | undefined)?.mime;
      const mime = typeof said === 'string' && said.startsWith('audio/') ? said : format === 'mp3' ? 'audio/mpeg' : 'audio/pcm';
      const stored = await writeStorageFile({ storage, config }, owner, { key, visibility: 'private', mimeType: mime,
        data: Buffer.concat(audio), tags: ['ai-generated', 'voice'] });
      if (!stored.ok) throw new AiCompletionError(stored.code, stored.status, stored.message);
      return { ...done, storage_key: key, mime_type: mime, size_bytes: size, visibility: 'private',
        fetch_url: '/v1/storage/' + encodeURIComponent(key),
        note: 'Stored privately in the calling principal\'s storage namespace. `audio` says the PCM layout (sample_rate, channels, sample_format); null means the provider did not say. Delete the file through storage when it is no longer needed.' };
    },
  };
}
