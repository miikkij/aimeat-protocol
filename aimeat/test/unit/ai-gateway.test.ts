/**
 * @file test/unit/ai-gateway.test.ts
 * @description What the System 2 gateway (services/ai/gateway.ts) keeps from the transport it
 *   replaced, and the two things it must never do, against the OpenAI-compatible stub on loopback.
 *
 *   Kept: a 200 that carries an error answers with the error's own status on BOTH AI SDK packages;
 *   the provider's own finish reason comes back unmapped; a reported cost is read wherever the
 *   package leaves it; an empty transcript of a silent recording is an answer (the AI SDK's
 *   transcribe() throws on it); an image answered as a data: URL is read and sniffed.
 *   Never: download an image URL the caller attached (the AI SDK would, with the global fetch and
 *   no SSRF check), and never send an OpenRouter call without an explicit key (the OpenRouter
 *   package would read OPENROUTER_API_KEY from the environment, which is the operator's key).
 * @usage pnpm test -- ai-gateway
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startFakeAiProvider, chatJson, chatErrorBody, transcriptionJson, imageJson, type FakeAiProvider,
} from '../helpers/fake-ai-provider.js';
import { text, image, transcribeAudio } from '../../src/services/ai/gateway.js';
import type { AiTarget } from '../../src/services/ai/types.js';

let provider: FakeAiProvider;
const envBefore = { egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, orKey: process.env.OPENROUTER_API_KEY };

beforeAll(async () => {
  process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
  provider = await startFakeAiProvider(0);
});
afterAll(async () => {
  await provider.close();
  for (const [name, value] of [['AIMEAT_ALLOW_PRIVATE_EGRESS', envBefore.egress], ['OPENROUTER_API_KEY', envBefore.orKey]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
beforeEach(() => provider.reset());

const compatible = (): AiTarget => ({ type: 'openai-compatible', baseUrl: provider.baseUrl, key: undefined });
const openrouter = (): AiTarget => ({ type: 'openrouter', baseUrl: provider.baseUrl, key: 'sk-or-unit-0001' });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);

describe('a 200 that carries an error is the error it names', () => {
  it('on the OpenAI-compatible package', async () => {
    provider.queue('chat', chatErrorBody('rate limited by the vendor', 429));
    await expect(text({ target: compatible(), model: 'm', prompt: 'x' })).rejects.toMatchObject({ status: 429 });
  });

  it('on the OpenRouter package', async () => {
    provider.queue('chat', chatErrorBody('rate limited by the vendor', 429));
    await expect(text({ target: openrouter(), model: 'm', prompt: 'x' })).rejects.toMatchObject({ status: 429 });
  });

  it('without a code it is a 502, and the message is carried', async () => {
    provider.queue('chat', chatErrorBody('the vendor refused the parameter'));
    await expect(text({ target: compatible(), model: 'm', prompt: 'x' }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('refused the parameter') });
  });
});

describe('what the provider said comes back as it said it', () => {
  it('the raw finish reason, not the AI SDK\'s mapped one', async () => {
    provider.queue('chat', chatJson('partial', { finishReason: 'content_filter' }));
    const r = await text({ target: compatible(), model: 'm', prompt: 'x' });
    expect(r.finishReason).toBe('content_filter');
  });

  it('a reported cost on an OpenAI-compatible answer', async () => {
    provider.queue('chat', chatJson('ok', { usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0003 } }));
    const r = await text({ target: compatible(), model: 'm', prompt: 'x' });
    expect(r.usage).toMatchObject({ promptTokens: 7, completionTokens: 11, costUsd: 0.0003 });
  });

  it('a reported cost on an OpenRouter answer, and the key it was sent with', async () => {
    provider.queue('chat', chatJson('ok', { usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0004 } }));
    const r = await text({ target: openrouter(), model: 'm', prompt: 'x' });
    expect(r.usage.costUsd).toBe(0.0004);
    expect(provider.lastRequest('chat')!.headers.authorization).toBe('Bearer sk-or-unit-0001');
  });
});

describe('what the gateway never does', () => {
  it('download an attached image URL: the URL goes to the provider untouched', async () => {
    // example.invalid never resolves, so a download attempt would fail the call.
    provider.queue('chat', chatJson('a bicycle'));
    await text({ target: compatible(), model: 'm', prompt: 'what is this', images: ['https://example.invalid/pic.png'] });
    const sent = provider.lastRequest('chat')!.json as { messages: Array<{ content: unknown }> };
    const parts = sent.messages[sent.messages.length - 1].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.find(p => p.type === 'image_url')?.image_url?.url).toBe('https://example.invalid/pic.png');
  });

  it('send an OpenRouter call without an explicit key, even with OPENROUTER_API_KEY in the environment', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-operator-env-key';
    const before = provider.requests.length;
    const keyless: AiTarget = { type: 'openrouter', baseUrl: provider.baseUrl, key: undefined };
    await expect(text({ target: keyless, model: 'm', prompt: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(provider.requests.length).toBe(before);
    delete process.env.OPENROUTER_API_KEY;
  });
});

describe('images and transcription through their adapters', () => {
  it('an image answered as a data: URL is read, sniffed and its cost carried', async () => {
    provider.queue('images', imageJson({ dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}`, cost: 0.04 }));
    const r = await image({ target: compatible(), model: 'img', prompt: 'a red bicycle', size: '1024x1024' });
    expect(r.mime).toBe('image/jpeg');
    expect(Buffer.compare(r.data, JPEG)).toBe(0);
    expect(r.costUsd).toBe(0.04);
    expect((provider.lastRequest('images')!.json as { size?: string }).size).toBe('1024x1024');
  });

  it('an empty transcript is an answer, with what it cost', async () => {
    provider.queue('transcriptions', transcriptionJson({ text: '', usage: { seconds: 2, cost: 0.0001 } }));
    const r = await transcribeAudio({
      target: compatible(), model: 'whisper',
      audio: { data: Buffer.from('RIFFsilence'), mime: 'audio/webm', filename: 'silence.webm' },
    });
    expect(r.text).toBe('');
    expect(r.usage).toMatchObject({ seconds: 2, cost_usd: 0.0001 });
  });

  it('the recording is sent as the caller named it, not as the AI SDK guesses it', async () => {
    provider.queue('transcriptions', transcriptionJson({ text: 'hello' }));
    await transcribeAudio({
      target: compatible(), model: 'whisper', language: 'fi',
      audio: { data: Buffer.from('RIFFvoice'), mime: 'audio/webm', filename: 'note.webm' },
    });
    const form = provider.lastRequest('transcriptions')!.body;
    expect(form).toContain('filename="note.webm"');
    expect(form).toContain('Content-Type: audio/webm');
    expect(form).toContain('name="language"');
  });
});
