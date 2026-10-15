/**
 * @file blocked-ip.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address rules of the outbound SSRF guard, shared by the two places that apply
 *   them: the check before a request (utils/url-validator.ts validateOutboundUrl) and the check at
 *   connect time (utils/outbound-connect-guard.ts), which decides on the address the socket is
 *   actually opened to. Moved out of url-validator.ts so both import it without an import cycle.
 * @structure blockedIpReason(ip) · isLoopbackIp(ip) · isLoopbackLiteral(host) · loopbackEgressAllowed()
 * @usage if (blockedIpReason(address) && !(loopbackEgressAllowed() && isLoopbackIp(address))) refuse();
 * @version-history
 *   v1.0.0 — 2026-10-16 — blockedIpReason moved from url-validator.ts unchanged; isLoopbackIp,
 *     isLoopbackLiteral and loopbackEgressAllowed added so the loopback exception is decided on an
 *     address, never on the text of a host name (QA audit S4-01, S4-02).
 */

/**
 * Return a reason string if `ip` (a literal IPv4 or IPv6 address) is in a
 * private/reserved/loopback range, else null. Normalises IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`) down to its IPv4 form first.
 */
export function blockedIpReason(ipRaw: string): string | null {
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

/** A literal IPv4 address in 127.0.0.0/8, in the dotted form URL parsing produces. */
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

/**
 * Whether a resolved or literal ADDRESS is loopback: 127.0.0.0/8, ::1, or either written as an
 * IPv4-mapped IPv6 address. Takes an address, never a host name.
 */
export function isLoopbackIp(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return LOOPBACK_V4.test(mapped[1]);
  if (ip === '::ffff:7f00:1') return true;
  return LOOPBACK_V4.test(ip);
}

/**
 * Whether a URL host names this machine without a lookup: `localhost`, `::1` or a literal
 * 127.0.0.0/8 address. A DNS name that starts with "127." is a name, so it is not one of these.
 */
export function isLoopbackLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || LOOPBACK_V4.test(h);
}

/**
 * Whether this node lets server-side requests reach loopback. config.ts normalises
 * AIMEAT_ALLOW_PRIVATE_EGRESS from the security profile at boot (`local` true, `public` false);
 * AIMEAT_DEV_MODE stays a back-compat alias. Private, link-local and carrier-grade addresses are
 * never opened by it.
 */
export function loopbackEgressAllowed(): boolean {
  return process.env.AIMEAT_ALLOW_PRIVATE_EGRESS === 'true' || process.env.AIMEAT_DEV_MODE === 'true';
}
