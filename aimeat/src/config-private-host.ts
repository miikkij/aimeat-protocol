/**
 * @file src/config-private-host.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the node's base URL names a private host, which decides the default security
 *   profile in config.ts. Moved out of config.ts unchanged when that file reached the line limit.
 * @structure isPrivateHost(baseUrl) → boolean
 * @usage const profile = isPrivateHost(baseUrl) ? 'local' : 'public';
 * @version-history
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
