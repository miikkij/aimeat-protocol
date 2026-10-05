/**
 * @file test/unit/read-capped-forms.test.ts
 * @description The capped forms of json() and text() in utils/read-capped.ts (secaudit 2026-10, C6):
 *   a body over the ceiling is refused, not read whole; the prefix read cuts and stops.
 * @usage pnpm test -- read-capped-forms
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C6).
 */
import { describe, it, expect } from 'vitest';
import {
  readJson, readText, readJsonCapped, readTextCapped, readBodyPrefix, ResponseTooLargeError,
} from '../../src/utils/read-capped.js';

/** A response whose body arrives in `n` chunks of `size` bytes, counting how many were pulled. */
function chunked(n: number, size: number, byte = 0x61): { resp: Response; pulled: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= n) { controller.close(); return; }
      sent++;
      controller.enqueue(new Uint8Array(size).fill(byte));
    },
  });
  return { resp: new Response(stream), pulled: () => sent };
}

describe('readJson and readText', () => {
  it('read a body under the ceiling as json() and text() would', async () => {
    expect(await readJson(new Response('{"a":1}'), 100)).toEqual({ a: 1 });
    expect(await readText(new Response('hello'), 100)).toBe('hello');
  });

  it('throw ResponseTooLargeError past the ceiling and stop reading', async () => {
    const big = chunked(1000, 1024);
    await expect(readText(big.resp, 4096)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(big.pulled()).toBeLessThan(10);
  });

  it('throw the parse error for a body that is not JSON', async () => {
    await expect(readJson(new Response('not json'), 100)).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe('readJsonCapped and readTextCapped', () => {
  it('answer the reason instead of throwing', async () => {
    expect(await readJsonCapped(new Response('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonCapped(chunked(10, 100).resp, 50)).toEqual({ ok: false, reason: 'too-large' });
    expect(await readJsonCapped(new Response('oops'), 100)).toEqual({ ok: false, reason: 'not-json', text: 'oops' });
    expect(await readTextCapped(chunked(10, 100).resp, 50)).toBeNull();
  });
});

describe('readBodyPrefix', () => {
  it('returns exactly the first bytes and stops reading', async () => {
    const big = chunked(1000, 1024);
    const head = await readBodyPrefix(big.resp, 1500);
    expect(head.length).toBe(1500);
    expect(big.pulled()).toBeLessThan(10);
  });

  it('returns a short body whole', async () => {
    expect((await readBodyPrefix(new Response('short'), 1500)).toString()).toBe('short');
  });
});
