/** @file voice-config.test.ts
 * @description Voice configuration refuses misspelled knobs and keeps per-session copies.
 * @version-history v1.0.0 - 2026-09-19 - Regression contract for configurable voice sessions.
 */
import { describe, expect, it } from 'vitest';
import { configure } from '../../src/static/sdk-libs/voice/config.js';
import { segments } from '../../src/static/sdk-libs/voice/segments.js';

describe('voice configuration', () => {
  it('merges individual knobs, preserves defaults and isolates sessions', () => {
    const a = configure({ preset: 'responsive', turn: { silenceMs: 700 }, llm: { temperature: 0 } });
    const b = configure();
    expect(a.turn.silenceMs).toBe(700);
    expect(a.llm.temperature).toBe(0);
    a.tts.voice = 'changed';
    expect(b.tts.voice).not.toBe('changed');
    expect(a.chunking.maxChars).toBeGreaterThan(a.chunking.minChars);
  });
  it('rejects unknown keys, invalid limits and unsupported providers before recording', () => {
    expect(() => configure({ turn: { silenseMs: 500 } })).toThrow('silenseMs');
    expect(() => configure({ turn: { silenceMs: -1 } })).toThrow('silenceMs');
    expect(() => configure({ chunking: { minChars: 200, maxChars: 100 } })).toThrow('maxChars');
    expect(() => configure({ stt: { provider: 'secret-cloud' } })).toThrow('provider');
  });
});

describe('incremental speech segments', () => {
  it('keeps a slowly generated sentence together in sentence mode', async () => {
    async function* text() { yield 'This sentence'; await new Promise(r => setTimeout(r, 40)); yield ' stays together. '; yield 'And ends.'; }
    const parts: string[] = [];
    for await (const part of segments(text(), { mode: 'sentence', minChars: 2, maxChars: 1200, maxWaitMs: 5 }, new AbortController().signal)) parts.push(part);
    expect(parts).toEqual(['This sentence stays together.', 'And ends.']);
  });
  it('joins a short opening sentence and bounds a single oversized token chunk', async () => {
    async function* text() { yield 'Hi. This is a sentence. ' + 'x'.repeat(105) + '.'; }
    const parts: string[] = [];
    for await (const part of segments(text(), { minChars: 10, maxChars: 30, maxWaitMs: 500 }, new AbortController().signal)) parts.push(part);
    expect(parts[0]).toBe('Hi. This is a sentence.');
    expect(parts.every(part => part.length <= 30)).toBe(true);
    expect(parts.join('').replaceAll(' ', '')).toBe(('Hi. This is a sentence. ' + 'x'.repeat(105) + '.').replaceAll(' ', ''));
  });
  it('yields a complete sentence before the model finishes and keeps final text', async () => {
    let finished = false;
    async function* text() { yield 'Hello there. '; yield 'Second sentence'; finished = true; }
    const iterator = segments(text(), { minChars: 5, maxChars: 80, maxWaitMs: 500 }, new AbortController().signal);
    expect((await iterator.next()).value).toBe('Hello there.');
    expect(finished).toBe(false);
    expect((await iterator.next()).value).toBe('Second sentence');
    expect((await iterator.next()).done).toBe(true);
  });
  it('flushes a slow incomplete sentence without reading the next token twice', async () => {
    let reads = 0;
    async function* text() { reads++; yield 'A slow reply'; await new Promise(r => setTimeout(r, 35)); reads++; yield ' continues.'; }
    const iterator = segments(text(), { minChars: 2, maxChars: 80, maxWaitMs: 10 }, new AbortController().signal);
    expect((await iterator.next()).value).toBe('A slow reply');
    expect(reads).toBe(1);
    expect((await iterator.next()).value).toBe('continues.');
  });
  it('stops a pending token wait on interruption', async () => {
    const controller = new AbortController();
    const source = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => ({ done: true }) }; } };
    const iterator = segments(source, { minChars: 2, maxChars: 80, maxWaitMs: 10 }, controller.signal);
    const waiting = iterator.next();
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
