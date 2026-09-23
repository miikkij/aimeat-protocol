/**
 * @file url-validator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SSRF guard for outbound HTTP. `validateOutboundUrl` rejects URLs
 *   that target private/reserved/loopback addresses (including via DNS — checks
 *   ALL resolved A/AAAA records, normalises IPv4-mapped IPv6, blocks CGNAT). Use
 *   `safeFetch` for any fetch of a user/peer-supplied URL: it re-validates every
 *   redirect hop with `redirect: 'manual'`, so an allowed host cannot 3xx-bounce
 *   the request to an internal target.
 * @usage const resp = await safeFetch(url, { method, headers, body });
 * @version-history
 *   v2.6.0 — 2026-09-23 — `allowOrigins`: the exact origins (scheme, host, port) ONE caller may reach
 *     although they are private, named by the operator. The decision provider call passes the
 *     origins in AIMEAT_DECIDE_PROVIDER_EGRESS, so a public node can reach its own model containers
 *     without AIMEAT_ALLOW_PRIVATE_EGRESS, which opens loopback to every fetch the server makes. A
 *     redirect to any other origin is checked as before, and link-local is never allowed.
 *   v1.0.0 — pre-2026-06 — Initial single-hop validator.
 *   v2.0.0 — 2026-06-20 — Security (H-3): block-all-resolved-records, CGNAT +
 *     IPv4-mapped-IPv6 + alt-encoding coverage, and add redirect-revalidating
 *     safeFetch to close the redirect/DNS-rebind SSRF bypass.
 *   v2.1.0 — 2026-07-10 — Loopback egress now gated by AIMEAT_ALLOW_PRIVATE_EGRESS (config resolves
 *     it from the security profile; AIMEAT_DEV_MODE kept as a back-compat alias). RFC1918/link-local
 *     stay blocked regardless.
 *   v2.5.0 — 2026-09-17 — A redirect that leaves the origin always drops Authorization, Cookie and
 *     Proxy-Authorization; 301/302 turn a POST into a GET and 303 anything into a GET, without the
 *     body; a 307/308 that would resend a body to another host is refused. Every hop repeated the
 *     method, the body and any credential the caller forgot to name, so an A2A push secret and an
 *     OAuth token call's client_secret reached whatever host a redirect named.
 *   v2.4.0 — 2026-09-06 — `sensitiveHeaders`: names the caller drops when a redirect leaves the
 *     origin they were meant for. The hop was re-validated for SSRF and then followed with the same
 *     headers, so an allowed address could 302 and collect whatever was in Authorization. It
 *     matters now because ctx.fetch resolves the owner's vault into that header, and the script
 *     that sent it was never allowed to see the value it would be handing away.
 *   v2.3.0 — 2026-09-06 — stripTrailingSlashes, for the callers that normalise an address someone
 *     else supplied before appending a path. `replace(/\/+$/, '')` on such an address is quadratic
 *     on a long run of slashes (CodeQL js/polynomial-redos, alerts 1609 and 1610).
 *   v2.2.0 — 2026-07-14 — Web Bot Auth seam: an optional outbound-request signer
 *     (setOutboundRequestSigner) stamps RFC 9421 Signature headers on every hop AFTER validation.
 *     Best-effort and additive only — a signer failure never blocks the fetch, and no guard changes.
 */
import { URL } from 'node:url';
import { lookup } from 'node:dns/promises';
import { logger } from '../utils/logger.js';

/**
 * Return a reason string if `ip` (a literal IPv4 or IPv6 address) is in a
 * private/reserved/loopback range, else null. Normalises IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`) down to its IPv4 form first.
 */
function blockedIpReason(ipRaw: string): string | null {
  let ip = ipRaw.toLowerCase();

  // IPv4-mapped / -compatible IPv6 → test as the embedded IPv4 (e.g. ::ffff:127.0.0.1, ::ffff:7f00:1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1];
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    ip = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // ── IPv4 ──
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some(n => n > 255)) return 'Malformed IPv4 address';
    const [a, b, c, d] = o;
    if (a === 127) return 'Loopback address';
    if (a === 10) return 'Private (10/8) address';
    if (a === 172 && b >= 16 && b <= 31) return 'Private (172.16/12) address';
    if (a === 192 && b === 168) return 'Private (192.168/16) address';
    if (a === 169 && b === 254) return 'Link-local / cloud-metadata address';
    if (a === 100 && b >= 64 && b <= 127) return 'Carrier-grade NAT (100.64/10) address';
    if (a === 0) return 'Unspecified (0/8) address';
    if (a === 192 && b === 0 && c === 2) return 'Reserved TEST-NET-1 address';
    if (a === 198 && b === 51 && c === 100) return 'Reserved TEST-NET-2 address';
    if (a === 203 && b === 0 && c === 113) return 'Reserved TEST-NET-3 address';
    if (a >= 224) return 'Multicast/reserved/broadcast address';
    void d;
    return null;
  }

  // ── IPv6 ──
  if (ip === '::1') return 'IPv6 loopback';
  if (ip === '::') return 'IPv6 unspecified';
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return 'IPv6 unique-local (fc00::/7)';
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return 'IPv6 link-local (fe80::/10)';
  if (/^ff[0-9a-f]{2}:/.test(ip)) return 'IPv6 multicast (ff00::/8)';
  return null;
}

/**
 * Whether an address is link-local (169.254/16, fe80::/10). The cloud metadata service lives there,
 * so no allowlist opens it: an origin naming one is refused where the list is read and here.
 */
export function isLinkLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return /^169\.254\./.test(h) || /^fe[89ab][0-9a-f]:/.test(h) || /^::ffff:169\.254\./.test(h);
}

export async function validateOutboundUrl(
  urlStr: string, opts: { allowOrigins?: readonly string[] } = {},
): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // An origin the operator named for this one caller: exact scheme, host and port, never a range.
  // The host is the operator's own word, so neither the private-range check nor DNS applies to it.
  if (opts.allowOrigins?.includes(parsed.origin) && !isLinkLocalHost(hostname)) {
    return { valid: true };
  }

  // Loopback egress is allowed only when private egress is permitted. config.ts normalises
  // AIMEAT_ALLOW_PRIVATE_EGRESS from the security profile at boot (`local` default true so a dev
  // node can reach a local Ollama / webhook; `public` default false); AIMEAT_DEV_MODE stays a
  // back-compat alias. RFC1918/link-local/cloud-metadata remain blocked below regardless.
  const allowPrivate = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS === 'true' || process.env.AIMEAT_DEV_MODE === 'true';
  if (allowPrivate && (hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname))) {
    return { valid: true };
  }

  // Block bare localhost hostnames outright.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'Localhost not allowed' };
  }

  // If the host is a literal IP, check it directly (covers ::ffff: forms etc.).
  const literalReason = blockedIpReason(hostname);
  if (literalReason) return { valid: false, reason: literalReason };

  // Resolve via DNS and reject if ANY resolved address is blocked. Using
  // { all: true } defeats round-robin records where only some entries are
  // private. (getaddrinfo also normalises decimal/octal/hex IPv4 encodings.)
  try {
    const records = await lookup(hostname, { all: true });
    if (records.length === 0) return { valid: false, reason: 'DNS resolution returned no records' };
    for (const { address } of records) {
      const reason = blockedIpReason(address);
      if (reason) return { valid: false, reason: `Resolved to ${reason}` };
    }
  } catch {
    return { valid: false, reason: 'DNS resolution failed' };
  }

  return { valid: true };
}

/**
 * A base URL with its trailing slashes off, ready to have a path appended.
 *
 * A scan rather than `replace(/\/+$/, '')`: that pattern makes the engine retry from every slash in
 * a run before it can fail, so an address someone else supplied ending in thousands of slashes
 * costs quadratic time. Same answer, one pass, whatever arrives.
 */
export function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return url.slice(0, end);
}

export interface SafeFetchInit extends RequestInit {
  /** Max redirect hops to follow (each re-validated). Default 5. */
  maxRedirects?: number;
  /**
   * Header names to DROP the moment a redirect leaves the origin they were meant for.
   *
   * A redirect is re-validated for SSRF and then followed with the same headers, which is fine for
   * `Accept` and wrong for a credential: an address the caller allowed can answer 302 and collect
   * whatever was in `Authorization`. curl and every browser drop the credential on a cross-host
   * redirect for exactly this reason.
   *
   * Opt-in rather than always-on, and named by the CALLER, because only the caller knows which of
   * its headers carry a secret. `ctx.fetch` passes the headers it resolved a `{{secret:NAME}}` into
   * — the ones that hold somebody's key and that the script itself was never allowed to see.
   *
   * Compared case-insensitively; the origin is scheme + host + port.
   */
  sensitiveHeaders?: string[];
  /**
   * Exact origins (`http://127.0.0.1:8811`, `http://laya:8000`) this call may reach although they are
   * private. Named by the operator, never by a user. Each hop is compared on its own, so a redirect
   * out of the list is checked like any other address.
   */
  allowOrigins?: readonly string[];
}

/**
 * Web Bot Auth seam: when set (AIMEAT_WEB_BOT_AUTH_SIGN=true at boot), every safeFetch hop is
 * stamped with the returned headers (RFC 9421 Signature / Signature-Input / Signature-Agent)
 * AFTER URL validation. Per-hop because @authority changes across redirects. Best-effort: a
 * signer error or null result leaves the request unsigned — signing must never break egress.
 */
/** Dropped on every redirect that leaves the original origin, whatever the caller named. */
const ALWAYS_SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

type OutboundRequestSigner =(targetUrl: string) => Promise<Record<string, string> | null>;
let outboundSigner: OutboundRequestSigner | null = null;

export function setOutboundRequestSigner(signer: OutboundRequestSigner | null): void {
  outboundSigner = signer;
}

/**
 * SSRF-safe fetch. Validates the URL, then fetches with `redirect: 'manual'` and
 * re-validates every `Location` before following it — so a host that passes
 * validation cannot 3xx-redirect the request to an internal address. Throws
 * `Fetch blocked: <reason>` on a blocked URL/hop or on exceeding the redirect cap.
 *
 * Residual: a determined DNS-rebind between the validating lookup and the fetch
 * connect remains possible (full closure needs connection pinning); the redirect
 * vector — the practically exploitable one — is closed.
 */
export async function safeFetch(urlStr: string, init: SafeFetchInit = {}): Promise<Response> {
  const { maxRedirects = 5, sensitiveHeaders = [], allowOrigins, ...fetchInit } = init;
  let target = urlStr;
  // The origin the caller's headers were meant for. Once a redirect leaves it, anything the caller
  // named as sensitive is dropped: the SSRF re-validation below proves the new host is not
  // internal, and proves nothing at all about whether it should be handed somebody's credential.
  const originOf = (u: string): string => {
    try { return new URL(u).origin; } catch (err) {
      // Unparseable: treat the whole string as its own origin, which makes the comparison below
      // FAIL and therefore drops the sensitive headers. The safe direction when we cannot tell.
      logger.warn('safeFetch: could not read an origin from this URL', { error: String(err) });
      return u;
    }
  };
  const firstOrigin = originOf(urlStr);
  const hostOf = (u: string): string => (URL.canParse(u) ? new URL(u).hostname.toLowerCase() : u);
  const firstHost = hostOf(urlStr);
  // The credential headers every browser drops on a cross-origin redirect, whether or not the caller
  // named them. A caller that forgot to name one (an A2A push target's Authorization did) handed its
  // secret to whatever host the first one redirected to.
  const sensitive = [...new Set([...ALWAYS_SENSITIVE_HEADERS, ...sensitiveHeaders.map(h => h.toLowerCase())])];
  // What the request is on this hop. A redirect can change the method and drop the body.
  let method = (fetchInit.method ?? 'GET').toUpperCase();
  let body = fetchInit.body;
  let headers = fetchInit.headers;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await validateOutboundUrl(target, allowOrigins ? { allowOrigins } : {});
    if (!check.valid) throw new Error(`Fetch blocked: ${check.reason}`);
    let hopHeaders = headers;
    if (originOf(target) !== firstOrigin) {
      const stripped = new Headers(headers);
      const dropped = sensitive.filter(name => stripped.has(name));
      for (const name of dropped) stripped.delete(name);
      hopHeaders = stripped;
      if (dropped.length) {
        logger.warn('safeFetch: a redirect left the original origin, so the sensitive headers were dropped', {
          from: firstOrigin, to: originOf(target), dropped: dropped.join(', '),
        });
      }
    }
    let hopInit: RequestInit = { ...fetchInit, method, body, headers: hopHeaders, redirect: 'manual' };
    if (outboundSigner) {
      try {
        const sigHeaders = await outboundSigner(target);
        if (sigHeaders) {
          // From hopHeaders, not fetchInit.headers: signing must not resurrect a credential the
          // cross-origin rule above just dropped.
          const headers = new Headers(hopHeaders);
          for (const [k, v] of Object.entries(sigHeaders)) headers.set(k, v);
          hopInit = { ...hopInit, headers };
        }
      } catch (err) { logger.warn('safeFetch: unsigned is fine — signing is additive, never a gate', { error: String(err) }); }
    }
    const resp = await fetch(target, hopInit);
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
      const next = new URL(resp.headers.get('location') as string, target).toString();
      // THE BODY. Every hop repeated the method and the body, so an OAuth token call's client_secret
      // or refresh token went to whatever host a 302 named. fetch's own rule: 301 and 302 turn a POST
      // into a GET, 303 turns anything but GET and HEAD into a GET, and the body goes with it.
      const becomesGet = ((resp.status === 301 || resp.status === 302) && method === 'POST')
        || (resp.status === 303 && method !== 'GET' && method !== 'HEAD');
      if (becomesGet) {
        method = 'GET';
        body = undefined;
        const trimmed = new Headers(headers);
        trimmed.delete('content-type');
        trimmed.delete('content-length');
        headers = trimmed;
      } else if (body !== undefined && body !== null && hostOf(next) !== firstHost) {
        // 307 and 308 keep the body by definition. To the same host (http upgraded to https) that is
        // what the caller sent it to; to another host it is somebody's secret handed on, so refuse.
        throw new Error('Fetch blocked: a redirect to another host would resend the request body');
      }
      target = next;
      continue;
    }
    return resp;
  }
  throw new Error('Fetch blocked: too many redirects');
}
