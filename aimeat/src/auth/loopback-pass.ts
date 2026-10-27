/**
 * @file src/auth/loopback-pass.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own credential for a request it makes to itself over loopback with a
 *   caller's bearer, so the REST layer can tell that request from the same bearer sent from outside.
 *
 *   WHY IT EXISTS. Three MCP tools reach the node's REST routes over loopback with the session's
 *   bearer: `aimeat_invoke` (services/node-invoke.ts, through the connector's name-to-route table)
 *   and `aimeat_capabilities_invoke` and `aimeat_app_tool_invoke` (services/capability-invoke.ts, an
 *   extension-backed capability over `POST /v1/ext/:name/:action`). When the session signed in over
 *   MCP OAuth, that bearer is bound to the MCP endpoint (RFC 8707, `aud`), and from 4.0.0 the REST
 *   layer refuses such a token (auth/mcp-token-on-rest.ts). The pass is what lets these three keep
 *   working: the request carries the caller's own token, so identity, scopes and every gate are the
 *   caller's exactly as before, and the pass says the node itself sent it.
 *
 *   WHY NOT IN-PROCESS. `aimeat_invoke` runs any capability in the catalogue through the route that
 *   serves it, which is the whole of its safety argument (node-invoke.ts header): a service call per
 *   capability would be a second implementation of several hundred routes. The extension case runs
 *   through `POST /v1/ext/:name/:action`, whose paywall writes the HTTP response itself and whose
 *   gates (scope word, paywall, members-only, workspace, sandbox) would need a second copy. A pass
 *   keeps one implementation of each.
 *
 *   WHAT MAKES IT SAFE. The pass is a random value held in this process's memory, bound to the hash
 *   of the one bearer it was minted for. It is never minted from user input, never returned to a
 *   client, and travels only on the request the node makes to 127.0.0.1. A pass that arrives from
 *   anywhere else is not in the map; a pass sent with another bearer does not match its hash; a pass
 *   that arrives on a socket that is not loopback is ignored. It grants nothing on its own: the
 *   bearer still has to verify, and only the refusal of an MCP-bound token on REST stands down.
 *   It lives for the call that minted it (revoked in that call's `finally`) and at most TTL_MS.
 *
 *   Not single use, unlike routes/extensions/internal-pass.ts: one `aimeat_invoke` may make several
 *   REST calls for one capability, and every one of them is the same caller's.
 * @structure LOOPBACK_PASS_HEADER · mintLoopbackPass(bearer) · revokeLoopbackPass(pass) ·
 *   loopbackPassCovers(pass, bearer, remoteAddress) · isLoopbackAddress(addr) · SELF_REQUEST_HEADER ·
 *   fromNodeMachine(req)
 * @usage
 *   const pass = mintLoopbackPass(bearer);
 *   try { await fetch(`http://127.0.0.1:${port}/v1/...`, { headers: { Authorization, [LOOPBACK_PASS_HEADER]: pass } }); }
 *   finally { revokeLoopbackPass(pass); }
 *   // auth/mcp-token-on-rest.ts:
 *   if (loopbackPassCovers(req.header(LOOPBACK_PASS_HEADER), token, req.socket.remoteAddress)) accept();
 * @version-history
 *   2026-10-27 — SELF_REQUEST_HEADER and fromNodeMachine(req): a request the node makes to itself for a
 *     principal is not the node's own machine for the setup code's loopback waiver (secaudit2026oct26).
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-tokeni-ei-kelpaa-rest-reiteill-4-0-0-sta-ensin-kolme-mcp).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The header the node's own loopback request carries. Meaningless to an outside caller. */
export const LOOPBACK_PASS_HEADER = 'x-aimeat-loopback-pass';

/**
 * The longest a pass can outlive the call that minted it, if that call never reached its `finally`.
 * Long enough for a slow extension action or a capability that makes several requests; the call
 * revokes it as soon as it ends.
 */
const TTL_MS = 5 * 60_000;

const passes = new Map<string, { bearerHash: Buffer; expiresAt: number }>();

function hashOf(bearer: string): Buffer {
  return createHash('sha256').update(bearer).digest();
}

/** Drop anything expired. Cheap: the map holds at most the calls in flight. */
function sweep(now: number): void {
  for (const [pass, held] of passes) {
    if (held.expiresAt <= now) passes.delete(pass);
  }
}

/** Mint a pass for one bearer. The caller sends it on its loopback request and revokes it after. */
export function mintLoopbackPass(bearer: string): string {
  const now = Date.now();
  sweep(now);
  const pass = randomBytes(24).toString('base64url');
  passes.set(pass, { bearerHash: hashOf(bearer), expiresAt: now + TTL_MS });
  return pass;
}

/** End a pass. Safe to call with an unknown or already ended one. */
export function revokeLoopbackPass(pass: string | undefined | null): void {
  if (pass) passes.delete(pass);
}

/** 127.0.0.0/8 and ::1, also in their IPv4-mapped IPv6 form. */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/**
 * The header every request the node makes to itself FOR a principal carries: the connector tunnel's
 * forward of an agent's request frame, `aimeat_invoke` and the capability invoke. Its presence is all
 * it says, and it can only take a waiver away, so a caller who sends it gains nothing.
 */
export const SELF_REQUEST_HEADER = 'x-aimeat-self-request';

/**
 * True when the request comes from a person on the node's own machine: it came in on a loopback
 * socket, and it is not a request the node made to itself for someone else. The setup code's
 * loopback waiver asks this (services/setup-code.ts): a request the connector tunnel replays onto
 * loopback for a remote agent arrives on a loopback socket too (secaudit2026oct26,
 * setup-code/loopback-waiver-honours-connect-tunnel-self-fetch).
 */
export function fromNodeMachine(req: { socket?: { remoteAddress?: string | null } | null; headers: Record<string, unknown> }): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  return req.headers[SELF_REQUEST_HEADER] === undefined && req.headers[LOOPBACK_PASS_HEADER] === undefined;
}

/**
 * True when this request is the node's own loopback call for this bearer: the pass is one this
 * process minted, it has not ended, it was minted for this exact bearer, and the request came in on
 * a loopback socket. Any other answer means the request is treated as if it carried no pass.
 */
export function loopbackPassCovers(
  pass: string | undefined | null, bearer: string, remoteAddress: string | undefined | null,
): boolean {
  if (!pass || !bearer || !isLoopbackAddress(remoteAddress)) return false;
  const held = passes.get(pass);
  if (!held) return false;
  if (held.expiresAt <= Date.now()) {
    passes.delete(pass);
    return false;
  }
  return timingSafeEqual(held.bearerHash, hashOf(bearer));
}
