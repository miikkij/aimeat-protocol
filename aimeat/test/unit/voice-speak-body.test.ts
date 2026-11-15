/**
 * @file voice-speak-body.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The voice library's node speech adapter (src/static/sdk-libs/voice/adapters.js) sends a
 *   body POST /v1/ai/speak accepts. voiceSpeechSchema (src/models/ai-voice-contract.ts) takes model and
 *   voice as optional strings of at least one character, and the speech role fills in what is left
 *   out. The defaults (voice/config.js) hold model '', so the adapter leaves an empty model or voice
 *   out, as the transcribe and complete adapters already do for their model.
 * @usage cd aimeat && pnpm exec vitest run test/unit/voice-speak-body.test.ts
 * @version-history
 *   v1.1.0 - 2026-11-15 - A session created from the default configuration (session.js createSession)
 *     speaks, and its speech request carries no model.
 *   v1.0.0 - 2026-11-15 - Initial: an empty model or voice is left out of the speech request.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { voiceSpeechSchema } from '../../src/models/ai-voice-contract.js';

vi.mock('../../src/static/sdk-libs/_core/config.js', () => ({ NODE_URL: 'http://node.test' }));
vi.mock('../../src/static/sdk-libs/_core/session.js', () => ({ getSession: () => ({ jwt: 'token' }) }));
vi.mock('../../src/static/sdk-libs/_core/spend.js', () => ({ noteBudget: () => {} }));

afterEach(() => { vi.unstubAllGlobals(); });

/** The JSON body one speak() call sends, read from a stubbed fetch that answers a finished stream. */
async function speakBody(patch: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { configure } = await import('../../src/static/sdk-libs/voice/config.js');
  const { nodeAdapters } = await import('../../src/static/sdk-libs/voice/adapters.js');
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response('{"type":"done"}\n', { status: 200 });
  });
  const config = configure({ appId: 'companion', tts: patch });
  const frames: unknown[] = [];
  for await (const frame of nodeAdapters(config, () => {}).speak('hello', { signal: new AbortController().signal })) frames.push(frame);
  return bodies[0];
}

describe('voice speak request body', () => {
  it('leaves out an empty model, so the speech role chooses it, and the route takes the body', async () => {
    const body = await speakBody();
    expect('model' in body).toBe(false);
    expect(body.voice).toBe('alloy');
    expect(voiceSpeechSchema.safeParse(body).success).toBe(true);
  });

  it('leaves out an empty voice as well', async () => {
    const body = await speakBody({ voice: '' });
    expect('voice' in body).toBe(false);
    expect(voiceSpeechSchema.safeParse(body).success).toBe(true);
  });

  it('a session on the default configuration speaks without a model, and the route takes the body', async () => {
    const { createSession } = await import('../../src/static/sdk-libs/voice/session.js');
    const { nodeAdapters } = await import('../../src/static/sdk-libs/voice/adapters.js');
    const sent: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname; sent[path] = JSON.parse(init.body);
      const frames = path === '/v1/ai/stream'
        ? [{ type: 'text', text: 'Hello there.' }, { type: 'done' }]
        : [{ type: 'start' }, { type: 'audio', data: 'AAA=' }, { type: 'done' }];
      return new Response(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n', { status: 200 });
    });
    const heard: number[] = [];
    const player = { open: async () => {}, stop() {}, close: async () => {},
      async play(stream: AsyncIterable<Uint8Array>) { for await (const bytes of stream) heard.push(bytes.byteLength); } };
    // Only the input mode differs from the defaults, so the test needs no microphone.
    const session = createSession({ appId: 'companion', input: { mode: 'text' } }, {}, { player: () => player, capture: () => null, adapters: nodeAdapters });
    expect(session.config.tts).toMatchObject({ provider: 'node', model: '' });
    await session.start();
    const turn = await session.sendText('Question');
    expect(turn.spoken).toBe('Hello there.');
    expect(heard.length).toBeGreaterThan(0);
    const body = sent['/v1/ai/speak'];
    expect(body).toMatchObject({ input: 'Hello there.', app_id: 'companion', voice: 'alloy' });
    expect('model' in body).toBe(false);
    expect(voiceSpeechSchema.safeParse(body).success).toBe(true);
    await session.close();
  });

  it('sends a model and a voice the app names', async () => {
    const body = await speakBody({ model: 'gpt-4o-mini-tts', voice: 'nova' });
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'hello', app_id: 'companion' });
  });
});
