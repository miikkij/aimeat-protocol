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
 *   v1.0.0 — pre-2026-06 — Initial single-hop validator.
 *   v2.0.0 — 2026-06-20 — Security (H-3): block-all-resolved-records, CGNAT +
 *     IPv4-mapped-IPv6 + alt-encoding coverage, and add redirect-revalidating
 *     safeFetch to close the redirect/DNS-rebind SSRF bypass.
 *   v2.1.0 — 2026-07-10 — Loopback egress now gated by AIMEAT_ALLOW_PRIVATE_EGRESS (config resolves
 *     it from the security profile; AIMEAT_DEV_MODE kept as a back-compat alias). RFC1918/link-local
 *     stay blocked regardless.
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

export async function validateOutboundUrl(urlStr: string): Promise<{ valid: boolean; reason?: string }> {
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

export interface SafeFetchInit extends RequestInit {
  /** Max redirect hops to follow (each re-validated). Default 5. */
  maxRedirects?: number;
}

/**
 * Web Bot Auth seam: when set (AIMEAT_WEB_BOT_AUTH_SIGN=true at boot), every safeFetch hop is
 * stamped with the returned headers (RFC 9421 Signature / Signature-Input / Signature-Agent)
 * AFTER URL validation. Per-hop because @authority changes across redirects. Best-effort: a
 * signer error or null result leaves the request unsigned — signing must never break egress.
 */
type OutboundRequestSigner = (targetUrl: string) => Promise<Record<string, string> | null>;
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
  const { maxRedirects = 5, ...fetchInit } = init;
  let target = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await validateOutboundUrl(target);
    if (!check.valid) throw new Error(`Fetch blocked: ${check.reason}`);
    let hopInit: RequestInit = { ...fetchInit, redirect: 'manual' };
    if (outboundSigner) {
      try {
        const sigHeaders = await outboundSigner(target);
        if (sigHeaders) {
          const headers = new Headers(fetchInit.headers);
          for (const [k, v] of Object.entries(sigHeaders)) headers.set(k, v);
          hopInit = { ...hopInit, headers };
        }
      } catch (err) { logger.warn('safeFetch: unsigned is fine — signing is additive, never a gate', { error: String(err) }); }
    }
    const resp = await fetch(target, hopInit);
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
      target = new URL(resp.headers.get('location') as string, target).toString();
      continue;
    }
    return resp;
  }
  throw new Error('Fetch blocked: too many redirects');
}
