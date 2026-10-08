/**
 * @file test/unit/ai-provider-errors.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one status table and reason policy every AI path uses (services/ai/errors.ts), the
 *   speech answer's audio block and voice check (services/ai-voice-audio.ts) and the picture sniffer
 *   (services/openrouter.ts sniffImage). aiprov plan, workstream A (A1, A2, A4, A6, A8, A13): until
 *   2026-10-08 a permanent 4xx was 502 "try again shortly" on six of seven AI paths.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  AiCompletionError, PROVIDER_KEY_REFUSED_STATUS, nodeFailureOf, providerFailureOf, providerReason,
  providerReasonFromText, providerStatusError, redactKeyShaped, retryAfterHeader,
} from '../../src/services/ai/errors.js';
import { speechAudioOf, checkSpeechVoice, speechFormatHint } from '../../src/services/ai-voice-audio.js';
import { sniffImage } from '../../src/services/openrouter.js';
import type { AiCandidate } from '../../src/services/ai/route-plan.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { writeCatalog } from '../../src/services/ai/catalog/store.js';

describe('providerStatusError: one table for every AI path', () => {
  const cases: Array<[number, string, string, number]> = [
    [400, 'bad parameter', 'PROVIDER_REJECTED', 422],
    [404, 'No endpoints found', 'PROVIDER_REJECTED', 422],
    [413, 'too big', 'PROVIDER_REJECTED', 422],
    [415, 'unsupported format', 'PROVIDER_REJECTED', 422],
    [422, 'invalid voice', 'PROVIDER_REJECTED', 422],
    [400, 'Your input was flagged by moderation', 'CONTENT_REFUSED', 422],
    [403, 'content_filter triggered', 'CONTENT_REFUSED', 422],
    [401, 'User not found', 'INVALID_API_KEY', PROVIDER_KEY_REFUSED_STATUS],
    [403, 'forbidden', 'INVALID_API_KEY', PROVIDER_KEY_REFUSED_STATUS],
    [402, 'Insufficient credits', 'PROVIDER_NO_CREDIT', 402],
    [429, 'slow down', 'RATE_LIMITED', 429],
    [408, 'request timeout', 'PROVIDER_ERROR', 502],
    [500, 'boom', 'PROVIDER_ERROR', 502],
    [503, 'overloaded', 'PROVIDER_ERROR', 502],
  ];
  for (const [status, reason, code, http] of cases) {
    it(`${status} "${reason}" is ${code} ${http}`, () => {
      const e = providerStatusError(status, reason);
      expect(e).toBeInstanceOf(AiCompletionError);
      expect([e.code, e.status]).toEqual([code, http]);
      expect(e.details).toMatchObject({ provider_status: status, provider_message: reason });
    });
  }

  it('a repeated refusal never says "try again", and carries the hint it was given', () => {
    const e = providerStatusError(400, 'mp3 not supported', { hint: speechFormatHint('mp3') });
    expect(e.message).toMatch(/fails again/);
    expect(e.message).toMatch(/pcm/);
    expect(e.details?.hint).toMatch(/pcm/);
    expect(speechFormatHint('pcm')).toBeUndefined();
  });

  it('a rate limit carries the provider\'s Retry-After in details.retry_after_sec', () => {
    expect(providerStatusError(429, '', { retryAfter: 9 }).details?.retry_after_sec).toBe(9);
    expect(providerStatusError(429, '').details?.retry_after_sec).toBeUndefined();
  });
});

describe('providerFailureOf and nodeFailureOf', () => {
  it('a refusal the node named passes as it is', () => {
    const named = new AiCompletionError('INVALID_PROVIDER', 400, 'no');
    expect(providerFailureOf(named)).toBe(named);
    expect(nodeFailureOf(named, 'test')).toBe(named);
  });
  it('an error with a provider status is mapped, with the reason the transport read', () => {
    const e = providerFailureOf(Object.assign(new Error('Provider 400: x'), { status: 400, providerMessage: 'the real reason', retryAfter: 3 }));
    expect([e.code, e.status, e.details?.provider_message]).toEqual(['PROVIDER_REJECTED', 422, 'the real reason']);
  });
  it('a failure without a status on the way to the provider is 502 PROVIDER_ERROR', () => {
    expect(providerFailureOf(new Error('fetch failed')).code).toBe('PROVIDER_ERROR');
  });
  it('a failure that is not typed is the node\'s 500, with no internal text in the answer', () => {
    const e = nodeFailureOf(new TypeError('cannot read x of undefined'), 'test');
    expect([e.code, e.status]).toEqual(['INTERNAL_ERROR', 500]);
    expect(e.message).not.toMatch(/undefined/);
  });
});

describe('the reason policy', () => {
  it('reads the JSON message, and OpenRouter\'s inner reason from metadata.raw', () => {
    expect(providerReasonFromText('{"error":{"message":"bad voice"}}')).toBe('bad voice');
    expect(providerReasonFromText('{"error":"plain"}')).toBe('plain');
    const wrapped = JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ error: { message: 'Unsupported response_format: mp3' } }) } } });
    expect(providerReasonFromText(wrapped)).toBe('Provider returned error: Unsupported response_format: mp3');
    expect(providerReasonFromText('upstream down')).toBe('upstream down');
  });
  it('redacts key-shaped strings and caps at 300 characters', () => {
    const leaked = providerReasonFromText('{"error":{"message":"bad key sk-or-v1-0123456789abcdef0123456789abcdef and Bearer abc.def.ghi"}}');
    expect(leaked).not.toMatch(/0123456789abcdef0123/);
    expect(leaked).not.toMatch(/abc\.def\.ghi/);
    expect(redactKeyShaped('"api_key": "secret123"')).toBe('"api_key": "[redacted]"');
    expect(redactKeyShaped('max_tokens: 4096')).toBe('max_tokens: 4096');
    expect(providerReasonFromText('x'.repeat(5000)).length).toBeLessThanOrEqual(300);
  });
  it('reads at most 4 KB of a body', async () => {
    const r = new Response('{"error":{"message":"' + 'y'.repeat(100_000) + '"}}', { status: 400 });
    const reason = await providerReason(r);
    expect(reason.length).toBeLessThanOrEqual(300);
  });
  it('reads Retry-After in seconds and as a date', () => {
    expect(retryAfterHeader(new Headers({ 'retry-after': '12' }))).toBe(12);
    expect(retryAfterHeader(new Headers({ 'retry-after': new Date(Date.now() + 30_000).toUTCString() }))).toBeGreaterThan(20);
    expect(retryAfterHeader(new Headers())).toBeUndefined();
  });
});

describe('the speech audio block and the voice check', () => {
  const of = (type: string, speech: Record<string, unknown> = {}) =>
    ({ provider: { type, capabilities: { speech: { enabled: true, pool: false, ...speech } } } }) as unknown as Pick<AiCandidate, 'provider'>;
  it('OpenAI and OpenRouter PCM is 24000 Hz mono s16le', () => {
    expect(speechAudioOf(of('openrouter'), 'pcm', 'audio/pcm')).toEqual({ mime: 'audio/pcm', sample_rate: 24000, channels: 1, sample_format: 's16le' });
    expect(speechAudioOf(of('openai'), 'pcm', 'application/octet-stream').sample_rate).toBe(24000);
  });
  it('an OpenAI-compatible server says nothing unless its content type or its record does', () => {
    expect(speechAudioOf(of('openai-compatible'), 'pcm', 'audio/pcm')).toEqual({ mime: 'audio/pcm', sample_rate: null, channels: null, sample_format: null });
    expect(speechAudioOf(of('local', { sampleRate: 22050, channels: 1, sampleFormat: 's16le' }), 'pcm', 'audio/pcm'))
      .toEqual({ mime: 'audio/pcm', sample_rate: 22050, channels: 1, sample_format: 's16le' });
    expect(speechAudioOf(of('local'), 'pcm', 'audio/L16; rate=16000; channels=2'))
      .toEqual({ mime: 'audio/l16', sample_rate: 16000, channels: 2, sample_format: 's16be' });
    expect(speechAudioOf(of('extension'), 'pcm', 'audio/pcm', { sampleRate: 44100, channels: 1, sampleFormat: 'f32le' }))
      .toEqual({ mime: 'audio/pcm', sample_rate: 44100, channels: 1, sample_format: 'f32le' });
  });
  it('mp3 carries the real type and no layout', () => {
    expect(speechAudioOf(of('openrouter'), 'mp3', 'audio/mp3')).toEqual({ mime: 'audio/mp3', sample_rate: null, channels: null, sample_format: null });
    expect(speechAudioOf(of('openrouter'), 'mp3', '').mime).toBe('audio/mpeg');
  });
  it('a model with a listed set of voices refuses another one before the call; a model with none passes', async () => {
    const storage = new SqliteStorage(':memory:');
    const caps = {
      textIn: true, imageIn: false, fileIn: false, audioIn: false, videoIn: false, textOut: false, imageOut: false, audioOut: true,
      tools: false, reasoning: false, structuredOutput: false, embeddings: false, speech: true, transcription: false, voices: ['Kore', 'Puck'],
    };
    await writeCatalog(storage as never, { nodeId: 'unit-node' } as never, [
      { type: 'openrouter', id: 'google/gemini-3.8-flash-tts', name: 'tts', caps, limits: {}, price: {}, status: 'active', sources: ['openrouter'], seenAt: '2026-10-08T00:00:00.000Z' },
    ], { snapshot: 's', refreshedAt: '2026-10-08T00:00:00.000Z', origin: 'refresh', sources: {}, sizes: {} });
    const gemini = { provider: { type: 'openrouter' }, model: 'google/gemini-3.8-flash-tts' } as unknown as Pick<AiCandidate, 'provider' | 'model'>;
    expect(() => checkSpeechVoice(gemini, 'kore')).not.toThrow();
    expect(() => checkSpeechVoice(gemini, 'alloy')).toThrow(expect.objectContaining({ code: 'INVALID_VOICE', status: 400 }));
    expect(() => checkSpeechVoice({ provider: { type: 'openai-compatible' }, model: 'anything' } as never, 'whatever')).not.toThrow();
  });
});

describe('sniffImage', () => {
  it('reads PNG, GIF and WebP sizes, and leaves an unknown format without a type', () => {
    const png = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
    expect(sniffImage(png)).toEqual({ mime: 'image/png', width: 800, height: 600 });
    expect(sniffImage(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0]))).toEqual({ mime: 'image/gif', width: 10, height: 20 });
    const vp8l = Buffer.alloc(25); vp8l.write('RIFF', 0, 'latin1'); vp8l.write('WEBPVP8L', 8, 'latin1');
    vp8l.writeUInt32LE((99 & 0x3fff) | ((49 & 0x3fff) << 14), 21);
    expect(sniffImage(vp8l)).toEqual({ mime: 'image/webp', width: 100, height: 50 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 64, 0, 128, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(jpeg)).toEqual({ mime: 'image/jpeg', width: 128, height: 64 });
    expect(sniffImage(Buffer.from('not an image'))).toEqual({});
  });
});
