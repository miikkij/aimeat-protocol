/**
 * @file ai-voice-result.ts
 * @description Collect streamed voice results for agents; audio becomes a private file, never base64 in model context.
 * @version-history v1.0.0 - 2026-09-19 - Bounded JSON delivery using the same metered voice stages.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { writeStorageFile } from './storage-file-write.js';
import { AiCompletionError } from './ai-completion.js';

export function createVoiceResult() {
  let text = '', size = 0, done: Record<string, unknown> | undefined;
  const audio: Buffer[] = [];
  return {
    async emit(event: Record<string, unknown>) {
      if (event.type === 'text') text += String(event.text);
      if (event.type === 'audio') {
        const bytes = Buffer.from(String(event.data), 'base64'); size += bytes.length;
        if (size > 16_000_000) throw new Error('Speech result exceeds 16 MB');
        audio.push(bytes);
      }
      if (event.type === 'done') done = event;
    },
    reply() { if (!done) throw new Error('Voice stream did not complete'); return { ...done, text }; },
    async speech(storage: Storage, config: AimeatConfig, owner: string, format: 'pcm' | 'mp3', signal: AbortSignal) {
      if (!done || !size) throw new Error('Speech stream did not complete');
      signal.throwIfAborted();
      const key = `ai-speech/${randomUUID()}.${format}`;
      const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/pcm';
      const stored = await writeStorageFile({ storage, config }, owner, { key, visibility: 'private', mimeType: mime,
        data: Buffer.concat(audio), tags: ['ai-generated', 'voice'] });
      if (!stored.ok) throw new AiCompletionError(stored.code, stored.status, stored.message);
      return { ...done, storage_key: key, mime_type: mime, size_bytes: size, visibility: 'private',
        fetch_url: '/v1/storage/' + encodeURIComponent(key),
        note: 'Stored privately in the calling principal\'s storage namespace. PCM sample rate and channels follow the selected provider. Delete the file through storage when it is no longer needed.' };
    },
  };
}
