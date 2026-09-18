/**
 * @file voice-session.test.ts
 * @description Behavioral voice contracts: early playback, queue bounds, interruption and cleanup.
 * @version-history v1.0.0 - 2026-09-19 - Tests exercise delayed adapters rather than interface presence.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/static/sdk-libs/voice/session.js';
import { delay } from '../../src/static/sdk-libs/voice/segments.js';

const options = { input: { mode: 'text' }, stt: { provider: 'custom' }, llm: { provider: 'custom' },
  tts: { provider: 'custom' }, chunking: { minChars: 2, maxChars: 40, maxWaitMs: 20 }, playback: { maxPendingSegments: 2 } };
function setup(overrides: any = {}, playMs = 5) {
  const calls: string[] = [];
  const player = { open: vi.fn(), stop: vi.fn(), close: vi.fn(), async play(stream: AsyncIterable<Uint8Array>, signal: AbortSignal) {
    for await (const bytes of stream) { expect(bytes.byteLength).toBeGreaterThan(0); await delay(playMs, signal); }
  } };
  const adapters = { transcribe: async () => 'Spoken input', async *complete() { yield 'First. '; yield 'Second.'; },
    async *speak(text: string) { calls.push(text); yield new Uint8Array([0, 0]); }, ...overrides };
  const session = createSession(options, adapters, { player: () => player, capture: vi.fn(), adapters: () => ({}) });
  return { session, player, calls };
}
describe('voice session', () => {
  it('speaks before the last model token and retains completed spoken history', async () => {
    let finish = false;
    const { session, calls } = setup({ async *complete() { yield 'First. '; await new Promise(r => setTimeout(r, 40)); finish = true; yield 'Second.'; } });
    await session.start(); const run = session.sendText('Question');
    await new Promise(r => setTimeout(r, 15));
    expect(calls).toEqual(['First.']); expect(finish).toBe(false);
    await run;
    expect(session.history).toEqual([{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'First. Second.' }]);
    await session.close();
  });
  it('interrupts a pending provider and discards unheard text', async () => {
    const { session, player, calls } = setup({}, 200);
    await session.start(); const run = session.sendText('Question'); const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(r => setTimeout(r, 15)); session.interrupt(); await rejected;
    expect(player.stop).toHaveBeenCalled(); expect(calls).toEqual(['First.']);
    expect(session.history).toEqual([{ role: 'user', content: 'Question' }]);
    await session.close();
  });
  it('bounds queued segments when speech is slower than model text', async () => {
    let produced = 0;
    const { session } = setup({ async *complete() { for (let i = 0; i < 100; i++) { produced++; yield `Phrase ${i}. `; } } }, 200);
    await session.start(); const run = session.sendText('Long'); const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(r => setTimeout(r, 20)); expect(produced).toBeLessThanOrEqual(4);
    session.interrupt(); await rejected; await session.close();
  });
  it('stops pending playback when the model stream fails', async () => {
    const { session, player } = setup({ async *complete() { yield 'First. '; await new Promise(r => setTimeout(r, 10)); throw new Error('upstream closed'); } }, 200);
    await session.start(); await expect(session.sendText('Question')).rejects.toThrow('upstream closed');
    expect(player.stop).toHaveBeenCalled(); expect(session.state).toBe('error'); await session.close();
  });
  it('requires a custom adapter and validates reconfiguration atomically', async () => {
    expect(() => createSession(options, {}, {})).toThrow('transcribe');
    const { session } = setup();
    expect(() => session.configure({ tts: { provider: 'node' } })).toThrow('tts.model');
    expect(session.config.tts.provider).toBe('custom');
    session.configure({ llm: { temperature: 0.2 } }); expect(session.config.llm.temperature).toBe(0.2);
    session.configure({ preset: 'patient', chunking: { maxChars: 300 } });
    expect(session.config.turn.silenceMs).toBe(1200);
    expect(session.config.chunking).toEqual({ minChars: 50, maxChars: 300, maxWaitMs: 700 });
    expect(session.config.llm.temperature).toBe(0.2);
    await session.start(); expect(() => session.configure({})).toThrow('Stop'); await session.close();
  });
});
