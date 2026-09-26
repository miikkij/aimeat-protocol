/**
 * @file test/unit/mcp-response-ceiling.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every answer a remote MCP server sends is read with a ceiling that holds WHILE it
 *   arrives (secaudit 2026-09, A2-2). The SDK reads a JSON answer with response.json(), which holds
 *   the whole body in this process before anything can measure it, so the tool-list ceiling in
 *   invoke.ts was asked only after a server had sent as much as it liked. The guarded fetch every
 *   MCP request travels through now hands the SDK a body that stops at the ceiling.
 * @structure
 *   - guardedFetchNaming: a JSON answer twice the ceiling, with no Content-Length, is cut at the
 *     ceiling and the rest of the stream is cancelled
 *   - capResponseBody: whole under and at the ceiling; an event stream counted per event, with LF,
 *     CRLF and CR line ends and a blank line split over two pieces; one event past the ceiling cut
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-response-ceiling.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, A2-2). Failed on the old code first.
 */
import { describe, it, expect, vi } from 'vitest';

const CHUNK = 64 * 1024;
/** The ceiling guardedFetch reads one answer to: 16 MB. */
const CEILING = 16 * 1024 * 1024;
/** The chunk that crosses the ceiling is the last one worth reading. */
const CHUNKS_TO_CROSS = CEILING / CHUNK + 1;

/** A stream of `totalChunks` chunks, counting what was pulled from it and whether it was cancelled. */
function farStream(totalChunks: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= totalChunks) { controller.close(); return; }
      state.pulled++;
      controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

let served: ReturnType<typeof farStream>;

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
  return {
    ...actual,
    // No Content-Length on purpose: the header is the one thing a hostile server leaves out.
    safeFetch: vi.fn(async () => new Response(served.stream, { status: 200, headers: { 'content-type': 'application/json' } })),
  };
});

const { guardedFetchNaming } = await import('../../src/services/mcp-client/transport.js');
const { capResponseBody } = await import('../../src/utils/read-capped.js');

/** A response whose body arrives in exactly these pieces. */
function inPieces(pieces: string[], contentType: string): Response {
  const bytes = pieces.map((p) => new TextEncoder().encode(p));
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const b of bytes) controller.enqueue(b); controller.close(); },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}
const SSE = 'text/event-stream';
const failed = (p: Promise<unknown>) => p.then(() => 'read', (err: { code?: string }) => err.code);

describe('the guarded fetch every MCP request travels through', () => {
  it('cuts a JSON answer at the ceiling and cancels the rest, before the SDK holds it whole', async () => {
    served = farStream(CHUNKS_TO_CROSS * 2);
    const res = await guardedFetchNaming([])('https://mcp.example/mcp', { method: 'POST' });
    const read = await res.json().then(() => 'parsed', (err: unknown) => err);
    // Until 2026-09-26 json() read all 32 MB before anything looked at its size.
    expect(served.state.pulled, `read ${served.state.pulled} of ${CHUNKS_TO_CROSS * 2} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 2);
    expect((read as { code?: string }).code).toBe('RESPONSE_TOO_LARGE');
    // The cut travels back up the pipe to the source, a moment after the reader hears it.
    await vi.waitFor(() => expect(served.state.cancelled).toBe(true));
  });
});

describe('capResponseBody, the ceiling a body handed on to a library carries', () => {
  it('hands on a body under the ceiling, and one exactly at it, whole', async () => {
    expect((await capResponseBody(new Response('x'.repeat(1000)), 4096).text()).length).toBe(1000);
    expect((await capResponseBody(new Response('x'.repeat(4096)), 4096).text()).length).toBe(4096);
    expect(await failed(capResponseBody(new Response('x'.repeat(4097)), 4096).text())).toBe('RESPONSE_TOO_LARGE');
  });

  it('counts an event stream event by event, so a stream of small events outlives the ceiling', async () => {
    const event = `data: ${'x'.repeat(50)}\n\n`;
    const text = await capResponseBody(inPieces(Array(100).fill(event), SSE), 1000).text();
    expect(text.length).toBe(event.length * 100);
    // CRLF and CR end a line as LF does, and a blank line split over two pieces still ends an event.
    const mixed = [`data: ${'a'.repeat(900)}\r\n\r\n`, `data: ${'b'.repeat(900)}\r\r`, `data: ${'c'.repeat(900)}\n`, '\n', `data: ${'d'.repeat(900)}\n\n`];
    expect((await capResponseBody(inPieces(mixed, 'text/event-stream; charset=utf-8'), 1000).text()).length).toBe(mixed.join('').length);
  });

  it('cuts one event larger than the ceiling, and a body that is not a stream as a whole', async () => {
    expect(await failed(capResponseBody(inPieces([`data: ${'x'.repeat(2000)}\n\n`], SSE), 1000).text())).toBe('RESPONSE_TOO_LARGE');
    // The same small events are one piece when the body does not say it is an event stream.
    expect(await failed(capResponseBody(inPieces(Array(100).fill(`data: ${'x'.repeat(50)}\n\n`), 'application/json'), 1000).text())).toBe('RESPONSE_TOO_LARGE');
  });

  it('hands on a response with no body as it is', () => {
    const empty = new Response(null, { status: 204 });
    expect(capResponseBody(empty, 10)).toBe(empty);
  });

  it('refuses a status outside 200 to 599, which fetch hands back and a Response cannot carry, and cancels its body unread', async () => {
    const odd = farStream(4);
    const answer = { status: 999, body: odd.stream, headers: new Headers() } as unknown as Response;
    expect(() => capResponseBody(answer, 10)).toThrow(/status 999/);
    await vi.waitFor(() => expect(odd.state.cancelled).toBe(true));
    expect(odd.state.pulled).toBe(0);
  });
});
