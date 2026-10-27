/**
 * @file src/config-private-host.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the node's base URL names a private host, which decides the default security
 *   profile in config.ts. Moved out of config.ts unchanged when that file reached the line limit.
 * @structure isPrivateHost(baseUrl) → boolean · listensBeyondLoopback(bindHost) · defaultSecurityProfile(baseUrl, nodeType, bindHost)
 * @usage const profile = defaultSecurityProfile(baseUrl, nodeType, process.env.AIMEAT_BIND_HOST);
 * @version-history
 *   v1.1.0 -- 2026-10-27 -- defaultSecurityProfile: a node whose AIMEAT_BIND_HOST is beyond this
 *     computer does not take the local profile by default; an empty bind address changes nothing
 *     (secaudit2026oct26, local-profile-from-default-baseurl-on-network-reachable-listener).
 *   v1.0.1 — 2026-10-16 — An IPv6 literal is compared without its brackets: `new URL().hostname` keeps
 *     them, so `http://[::1]` and a unique-local address read as public (QA audit F20-02,
 *     test/unit/security-profile.test.ts).
 *   v1.0.0 — 2026-10-06 — Pure extraction from config.ts (max-file-lines), no change in behaviour.
 */

/**
 * True if `baseUrl` points at localhost / loopback / RFC1918 / link-local / IPv6-ULA — i.e. NOT a
 * public host. Drives the default security profile (private host → `local`, public host → `public`).
 * A host-less or unparseable baseUrl is treated as private (fail safe toward localhost-flexible dev).
 */
export function isPrivateHost(baseUrl: string): boolean {
  let host: string;
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return true; }
  // The URL standard keeps the brackets of an IPv6 literal in `hostname` ('[::1]'), so the two IPv6
  // tests below matched nothing until they were removed here.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;      // link-local (incl. cloud metadata)
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // IPv6 unique-local
  return false;
}

/**
 * True when AIMEAT_BIND_HOST names an address beyond this computer (0.0.0.0, ::, a network address).
 * Empty is false: a node with no bind address listens on every address as it always has, and keeps
 * the profile its base URL gives it, so no existing install changes.
 */
export function listensBeyondLoopback(bindHost: string | undefined): boolean {
  const h = (bindHost ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  return !(h === 'localhost' || h === '::1' || /^127\./.test(h));
}

/**
 * The security profile when AIMEAT_SECURITY_PROFILE does not name one: `local` for a private base URL
 * or a personal node, `public` otherwise, and never `local` for a node set to listen beyond this
 * computer, since every network that reaches it would get the local profile's loopback reach.
 */
export function defaultSecurityProfile(baseUrl: string, nodeType: string, bindHost: string | undefined): 'local' | 'public' {
  if (listensBeyondLoopback(bindHost)) return 'public';
  return (isPrivateHost(baseUrl) || nodeType === 'personal') ? 'local' : 'public';
}
