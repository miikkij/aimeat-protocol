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
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: NAT64 (64:ff9b::/96), 6to4 (2002::/16) and the long
 *     IPv4-mapped form are decided on the IPv4 address they carry; local-use NAT64, Teredo,
 *     IPv4-compatible (::/96), site-local (fec0::/10), 198.18.0.0/15 and 192.0.0.0/24 are refused.
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

  // Other IPv6 prefixes that carry an IPv4 address. NAT64 (64:ff9b::/96) and 6to4 (2002::/16) are
  // decided on the IPv4 address they carry, so an IPv6-only node still reaches public IPv4 sites
  // through NAT64. The prefixes no public service needs are refused outright.
  const hextets = ip.includes(':') ? expandIpv6(ip) : null;
  if (hextets) {
    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) ip = v4Of(h6, h7);
    else if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) ip = v4Of(h6, h7);
    else if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return 'IPv6 local-use NAT64 (64:ff9b:1::/48)';
    else if (h0 === 0x2002) ip = v4Of(h1, h2);
    else if (h0 === 0x2001 && h1 === 0) return 'IPv6 Teredo (2001::/32)';
    else if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && (h6 !== 0 || h7 > 1)) {
      return 'IPv4-compatible IPv6 address (::/96)';
    }
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
    if (a === 192 && b === 0 && c === 0) return 'IETF protocol assignments (192.0.0/24) address';
    if (a === 198 && (b === 18 || b === 19)) return 'Benchmarking (198.18/15) address';
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
  if (/^fe[c-f][0-9a-f]:/.test(ip)) return 'IPv6 site-local (fec0::/10)';
  if (/^ff[0-9a-f]{2}:/.test(ip)) return 'IPv6 multicast (ff00::/8)';
  return null;
}

/** Dotted IPv4 from two 16-bit groups. */
function v4Of(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when the text is not one. Accepts the `::`
 * shorthand and a trailing dotted IPv4 part (`::10.0.0.1`, `64:ff9b::8.8.8.8`); a zone id is cut.
 */
function expandIpv6(raw: string): number[] | null {
  let s = raw.replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const o = dotted.slice(2).map(Number);
    if (o.some(n => n > 255)) return null;
    s = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (t: string): string[] => (t === '' ? [] : t.split(':'));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
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
