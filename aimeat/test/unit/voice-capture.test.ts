/**
 * @file voice-capture.test.ts
 * @description Replays speaker feedback into capture and verifies safe automatic turn recovery.
 * @version-history v1.0.0 - 2026-09-19 - Echo while busy, echo tail, next user turn and opt-in interruption.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapture } from '../../src/static/sdk-libs/voice/capture.js';
import { configure } from '../../src/static/sdk-libs/voice/config.js';

afterEach(() => vi.unstubAllGlobals());
async function harness(turn: Record<string, unknown> = {}) {
  let processor: any;
  const connect = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const track = { stop: vi.fn() };
  vi.stubGlobal('AudioContext', class {
    sampleRate = 1000; state = 'running'; destination = {};
    audioWorklet = { addModule: vi.fn() };
    resume = vi.fn(); close = vi.fn();
    createMediaStreamSource = connect;
    createGain = () => ({ ...connect(), gain: { value: 1 } });
  });
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: null, close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn();
    constructor() { processor = this; }
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  let busy = false;
  const hooks = { busy: () => busy, level: vi.fn(), utterance: vi.fn(), interrupt: vi.fn(() => { busy = false; }) };
  const capture = createCapture(configure({ input: { mode: 'vad' }, turn }), hooks);
  await capture.start();
  function feed(value: number, ms: number) {
    for (let i = 0; i < ms; i += 50) processor.port.onmessage({ data: new Float32Array(50).fill(value) });
  }
  return { capture, hooks, feed, track, busy: (value: boolean) => { busy = value; } };
}
describe('speaker-safe voice capture', () => {
  it('does not interrupt itself and rejects echo after playback until a quiet interval', async () => {
    const h = await harness();
    h.busy(true); h.feed(0.2, 1200);
    expect(h.hooks.interrupt).not.toHaveBeenCalled();
    h.busy(false); h.feed(0.2, 700); h.feed(0, 200); h.feed(0.2, 400);
    expect(h.hooks.utterance).not.toHaveBeenCalled();
    h.feed(0, 700);
    expect(h.hooks.utterance).not.toHaveBeenCalled();
    h.feed(0.2, 500); h.feed(0, 700);
    expect(h.hooks.utterance).toHaveBeenCalledTimes(1);
    await h.capture.close(); expect(h.track.stop).toHaveBeenCalledOnce();
  });
  it('keeps spoken interruption available when explicitly enabled', async () => {
    const h = await harness({ bargeIn: true });
    h.busy(true); h.feed(0.2, 500); h.feed(0, 700);
    expect(h.hooks.interrupt).toHaveBeenCalledOnce();
    expect(h.hooks.utterance).toHaveBeenCalledOnce();
    await h.capture.close();
  });
});
