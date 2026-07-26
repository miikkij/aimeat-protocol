/**
 * @file app-protect.ts
 * @description Opt-in, per-app copy-protection transforms applied to an app's inline
 *   (runnable) HTML at serve time — the narrowly-scoped sibling of injectAimeatBadge.
 *   Each is gated by a manifest.protection flag the owner sets; ALL default OFF:
 *     - obfuscate    — mangle the app's inline <script> blocks (raises theft cost)
 *     - domainLock   — a guard script so the app only runs on this node's app origin
 *     - watermark    — an invisible, operator-decodable per-serve fingerprint
 *                      (self-describing via AES-256-GCM — no registry table)
 *     - noRawDownload — enforced at the ROUTE (block the raw attachment), not here
 *   HONEST LIMITS: viewable client HTML is always copyable by anyone who can run it —
 *   these raise the cost of casual theft, deter rehosting, and make leaks traceable;
 *   they do NOT prevent copying. The real moat is keeping value in a server-side
 *   extension. See docs/app-developer-ai-guide.md.
 * @structure
 *   - sanitizeProtection() / hasAnyProtection() — validate/inspect the flags
 *   - applyAppProtection() — obfuscate + domainLock (cached per version) + watermark
 *   - makeWatermark() / decodeWatermark() — encrypt/decrypt the fingerprint token
 *   - invalidateProtectionCache() — drop cached bases on republish/delete
 * @usage routes/apps.ts (apex inline serve) + routes/subdomains.ts (app-origin serve)
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial: domainLock, watermark, obfuscate (Phase 3).
 *   v1.1.0 — 2026-07-16 — domainLock/watermark inject before the LAST closing tag (shared
 *     html-inject helper), not the first — first-match landed inside app JS containing '</body>'.
 */
import type { AimeatConfig } from '../config.js';
import type { AppProtection } from '../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from '../services/encryption.js';
import { obfuscateInlineScripts } from './app-obfuscate.js';
import { injectBeforeClosingTag } from './html-inject.js';

const PROTECTION_KEYS = ['obfuscate', 'domainLock', 'watermark', 'noRawDownload'] as const;
const WM_MARKER = 'aimeat-wm';

/**
 * Validate an untrusted protection object down to the four known boolean flags.
 * Returns undefined when the input is not an object, so callers can distinguish
 * "omitted" (carry forward) from "provided" (set/clear).
 */
export function sanitizeProtection(v: unknown): AppProtection | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const src = v as Record<string, unknown>;
  const out: AppProtection = {};
  for (const k of PROTECTION_KEYS) if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  return out;
}

/** True when at least one protection flag is enabled. */
export function hasAnyProtection(p: AppProtection | undefined | null): boolean {
  return !!p && PROTECTION_KEYS.some((k) => p[k]);
}

export interface ProtectContext {
  protection: AppProtection;
  config: AimeatConfig;
  viewer: string;        // req.auth?.sub ?? 'anon'
  appOwner: string;      // source app's bare owner name
  appFilename: string;
  version: number;
  servedAt: string;      // ISO timestamp of this serve
}

// obfuscate + domainLock output is deterministic per (app version, flags), and
// obfuscation is expensive — cache it. The watermark is per-serve, applied on top.
const baseCache = new Map<string, string>();
const BASE_CACHE_MAX = 200;

/**
 * Build an invisible, operator-decodable watermark comment for this serve. The
 * payload (viewer, app, version, time) is AES-256-GCM encrypted with the node key,
 * so a thief cannot read it but the operator can trace a leaked copy. Returns '' when
 * no encryption key is configured (the watermark then no-ops rather than leak plaintext).
 */
export function makeWatermark(ctx: ProtectContext): string {
  const key = getEncryptionKey(ctx.config);
  if (!key) return '';
  const payload = JSON.stringify({ v: ctx.viewer, a: `${ctx.appOwner}/${ctx.appFilename}`, ver: ctx.version, t: ctx.servedAt });
  return `<!--${WM_MARKER}:${encrypt(payload, key)}-->`;
}

export interface DecodedWatermark { viewer: string; app: string; version: number; servedAt: string }

/**
 * Decode a watermark token (pulled from a leaked copy) back to its origin. Needs the
 * node key, so it is operator-only in practice. The token may be the raw
 * `iv:tag:ct` string or the full `<!--aimeat-wm:...-->` comment. Returns null when it
 * cannot be decoded (wrong key, tampered, or not a watermark).
 */
export function decodeWatermark(token: string, config: AimeatConfig): DecodedWatermark | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  const m = token.match(new RegExp(`${WM_MARKER}:([0-9a-f:]+)`, 'i'));
  const cipher = (m ? m[1] : token).trim();
  try {
    const o = JSON.parse(decrypt(cipher, key)) as { v: string; a: string; ver: number; t: string };
    return { viewer: o.v, app: o.a, version: o.ver, servedAt: o.t };
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    return null;
  }
}

/**
 * Client-side guard so the app only runs on this node's app origin (config.appHost)
 * or a per-app subdomain of it; a rehosted copy blanks itself and redirects home.
 * HONEST: client-side, so a determined thief can strip it — it deters casual reuse.
 */
function domainLockScript(config: AimeatConfig): string {
  const host = config.appHost || '';
  const home = config.baseUrl || '';
  if (!host) return '';
  return '<script>(function(){try{var h=location.hostname,ah=' + JSON.stringify(host) + ';'
    + "if(ah&&h!==ah&&h.indexOf('.'+ah)<0&&h!=='localhost'&&h!=='127.0.0.1'){"
    + 'document.documentElement.innerHTML="";location.replace(' + JSON.stringify(home) + ');}}catch(e){}})();</script>';
}

/**
 * Apply the inline-HTML protections for one serve. obfuscate + domainLock are cached
 * per (app version, active flags); the watermark is added per serve. On ANY error the
 * ORIGINAL html is returned unchanged — protection must never break an app.
 */
export function applyAppProtection(html: Buffer, ctx: ProtectContext): Buffer {
  const p = ctx.protection;
  if (!p || (!p.obfuscate && !p.domainLock && !p.watermark)) return html;
  try {
    const cacheKey = `${ctx.appOwner}/${ctx.appFilename}@${ctx.version}:${p.obfuscate ? 'o' : ''}${p.domainLock ? 'd' : ''}`;
    let base = baseCache.get(cacheKey);
    if (base === undefined) {
      let text = html.toString('utf8');
      if (p.obfuscate) text = obfuscateInlineScripts(text);
      if (p.domainLock) text = injectBeforeClosingTag(text, domainLockScript(ctx.config));
      base = text;
      if (baseCache.size >= BASE_CACHE_MAX) baseCache.clear();
      baseCache.set(cacheKey, base);
    }
    let out = base;
    if (p.watermark) {
      const wm = makeWatermark(ctx);
      if (wm) out = injectBeforeClosingTag(out, wm);
    }
    return Buffer.from(out, 'utf8');
  } catch {
    return html;   // never break the app
  }
}

/** Drop cached protected bases for an app (call on republish / delete). */
export function invalidateProtectionCache(appOwner: string, appFilename: string): void {
  const prefix = `${appOwner}/${appFilename}@`;
  for (const k of [...baseCache.keys()]) if (k.startsWith(prefix)) baseCache.delete(k);
}
