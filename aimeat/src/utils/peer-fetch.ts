/**
 * @file src/utils/peer-fetch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one fetch for a request to another node of the federation: a peer the operator
 *   linked, at the address its own card answered with.
 *
 *   WHY NOT safeFetch. safeFetch refuses private and loopback addresses, and a federation may run
 *   on a private network, so peer calls were written as bare fetch() calls, each listed in
 *   security/outbound-fetch-exemptions.json with the same sentence (34 of them). Each of those
 *   followed redirects, waited as long as the peer liked unless it set its own timeout, and read the
 *   whole answer with json() or text() (secaudit 2026-10, C6). A redirect is how a peer address
 *   becomes another address, which the operator never approved.
 *
 *   WHAT IT DOES. Refuses a redirect (`redirect: 'error'`), stops after `timeoutMs`, and hands back the
 *   status, the headers and the body read under `maxBytes` (utils/read-capped.ts). It does not sign:
 *   the caller adds its signed headers, as each signed request type has its own message.
 * @structure PEER_ANSWER_MAX_BYTES · PeerAnswer · peerFetch(url, init, opts)
 * @usage
 *   const out = await peerFetch(`${peer.url}/v1/federation/card`, { headers }, { timeoutMs: 10_000 });
 *   if (!out.ok) return refuse(out.reason);
 *   const card = out.json;
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C6).
 */
import { readBodyCapped } from './read-capped.js';

/** The most of one answer this node reads from a peer: 4 MB, the outbound read ceiling. */
export const PEER_ANSWER_MAX_BYTES = 4 * 1024 * 1024;

export type PeerAnswer =
  | { ok: true; status: number; headers: Headers; text: string; json: unknown }
  | { ok: false; reason: 'unreachable' | 'redirect' | 'too-large' | 'timeout'; message: string; status?: number };

/**
 * One request to a peer node. `ok` is about the transport, not the status: a 404 from the peer is
 * `{ ok: true, status: 404 }`, so a caller reads the peer's own refusal. `json` is the parsed body,
 * or undefined when it is not JSON.
 */
export async function peerFetch(
  url: string, init: RequestInit = {},
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<PeerAnswer> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as { name?: string; cause?: { message?: string } };
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `The peer did not answer within ${timeoutMs} ms.` };
    }
    // fetch reports a refused redirect as a TypeError whose cause names it.
    if (/redirect/i.test(String(e?.cause?.message ?? err))) {
      return { ok: false, reason: 'redirect', message: 'The peer answered with a redirect, which a peer request does not follow.' };
    }
    return { ok: false, reason: 'unreachable', message: `The peer could not be reached: ${String(err).slice(0, 200)}` };
  }
  const maxBytes = opts.maxBytes ?? PEER_ANSWER_MAX_BYTES;
  const body = await readBodyCapped(res, maxBytes);
  if (body === null) {
    return { ok: false, reason: 'too-large', status: res.status, message: `The peer's answer passed ${maxBytes} bytes.` };
  }
  const text = body.toString('utf8');
  let json: unknown;
  // eslint-disable-next-line aimeat/no-silent-catch -- a body that is not JSON is answered as text: `json` undefined is the answer
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { ok: true, status: res.status, headers: res.headers, text, json };
}
