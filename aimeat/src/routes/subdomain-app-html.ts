/**
 * @file src/routes/subdomain-app-html.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two rewrites a published app's HTML bytes get before the per-app origin serves
 *   them: the seamless-SSO shim script, and the author's own CSP meta opened to the apex for the
 *   silent sign-in bridge. Moved unchanged out of routes/subdomains.ts, which had passed the 800-line
 *   limit; subdomains.ts serves with them.
 * @structure injectAppScript(data, src) · relaxAppCspMeta(data, apexOrigin) · cspEnsure (internal)
 * @usage import { relaxAppCspMeta } from './subdomain-app-html.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Moved unchanged from routes/subdomains.ts (max-file-lines).
 */

/**
 * Inject a `<script src>` (the seamless-SSO shim) into HTML body bytes, returning a Buffer. Handles
 * a Node Buffer (SQLite), a Uint8Array (MongoDB/Prisma `Bytes`), or a string — decoding bytes as
 * UTF-8 first. (Using `String()` on a Uint8Array would stringify it to "60,33,..." byte values — the
 * bug this guards against.)
 */
export function injectAppScript(data: Buffer | Uint8Array | string, src: string): Buffer {
  const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  const tag = `<script src="${src}"></script>`;
  let html: string;
  if (/<\/head>/i.test(raw)) html = raw.replace(/<\/head>/i, tag + '</head>');
  else if (/<body[^>]*>/i.test(raw)) html = raw.replace(/<body[^>]*>/i, (m) => m + tag);
  else html = tag + raw;
  return Buffer.from(html, 'utf-8');
}

/** Add `value` to a CSP directive's source list (deriving from default-src when the directive is
 *  absent), without duplicating it. Returns the new source-list array. */
function cspEnsure(dirs: Map<string, string[]>, dir: string, value: string): void {
  const base = dirs.get(dir) ?? dirs.get('default-src') ?? ["'self'"];
  const vals = [...base];
  if (!vals.includes(value)) vals.push(value);
  dirs.set(dir, vals);
}

/**
 * If a published app's HTML carries its OWN `<meta http-equiv="Content-Security-Policy">`, ensure its
 * `frame-src` AND `connect-src` allow the apex origin. Otherwise a strict app-author CSP (e.g.
 * `default-src 'self'`) blocks the H-2 silent-SSO bridge (a hidden iframe → apex) and the apex grant
 * token exchange, so seamless sign-in silently fails. Only those two directives gain the apex; every
 * other protection the author set is preserved. Apps with no CSP meta are returned unchanged (the
 * response-header CSP governs them).
 */
export function relaxAppCspMeta(data: Buffer | Uint8Array | string, apexOrigin: string): Buffer {
  const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  if (!apexOrigin) return Buffer.from(raw, 'utf-8');
  const out = raw.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']content-security-policy["']/i.test(tag)) return tag;
    const cm = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!cm) return tag;
    const dirs = new Map<string, string[]>();
    for (const part of cm[2].split(';').map((s) => s.trim()).filter(Boolean)) {
      const [name, ...vals] = part.split(/\s+/);
      dirs.set(name.toLowerCase(), vals);
    }
    cspEnsure(dirs, 'frame-src', apexOrigin);
    cspEnsure(dirs, 'connect-src', apexOrigin);
    const rebuilt = [...dirs.entries()].map(([n, v]) => (v.length ? `${n} ${v.join(' ')}` : n)).join('; ');
    return tag.replace(cm[0], cm[0].replace(cm[2], rebuilt));
  });
  return Buffer.from(out, 'utf-8');
}
