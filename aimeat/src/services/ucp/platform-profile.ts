/**
 * @file src/services/ucp/platform-profile.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The UCP platform on the other end of a checkout: who it says it is (the `UCP-Agent`
 *   header, an RFC 8941 dictionary `profile="https://…"`), and what its profile publishes: the keys
 *   it signs with and the address it takes order webhooks at
 *   (`ucp.capabilities["dev.ucp.shopping.order"][].config.webhook_url`).
 *
 *   FETCHED THROUGH safeFetch, under a size ceiling, cached ten minutes per address. A profile that
 *   cannot be fetched is not an error at create: UCP lets a business run an open checkout, and the
 *   webhook delivery tries the profile again later.
 * @structure parseUcpAgent · platformProfile · PlatformProfile · resetPlatformProfileCache (tests)
 * @usage const p = await platformProfile(profileUrl);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E: the own UCP checkout).
 */
import { safeFetch } from '../../utils/url-validator.js';
import { readText } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { PublicJwk } from './ucp-keys.js';

export interface PlatformProfile {
  url: string;
  keys: PublicJwk[];
  webhookUrl: string | null;
  version: string | null;
}

const CACHE_MS = 10 * 60_000;
const MAX_BYTES = 256 * 1024;
const cache = new Map<string, { at: number; profile: PlatformProfile | null }>();

export function resetPlatformProfileCache(): void { cache.clear(); }

/**
 * The profile address in a `UCP-Agent` header: the dictionary form, or a bare URL. https only;
 * `allowHttp` is for a node that itself runs on http (a developer's machine, a test run).
 */
export function parseUcpAgent(header: string | null | undefined, allowHttp = false): string | null {
  if (!header) return null;
  const m = /profile="(https?:\/\/[^"\s]{1,1500})"/.exec(header) ?? /^(https?:\/\/[^\s",;]{1,1500})$/.exec(header.trim());
  const url = m?.[1] ? URL.parse(m[1]) : null;
  return url && (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) ? url.toString() : null;
}

/** The platform's profile, or null when it cannot be fetched or read. */
export async function platformProfile(url: string): Promise<PlatformProfile | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile;
  let profile: PlatformProfile | null = null;
  try {
    const res = await safeFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const doc = JSON.parse(await readText(res, MAX_BYTES)) as { ucp?: Record<string, unknown>; keys?: unknown };
      const caps = (doc.ucp?.capabilities ?? {}) as Record<string, Array<{ config?: { webhook_url?: unknown } }>>;
      const orderCap = Array.isArray(caps['dev.ucp.shopping.order']) ? caps['dev.ucp.shopping.order'] : [];
      const hook = orderCap.map((c) => c?.config?.webhook_url).find((v): v is string => typeof v === 'string');
      const hookUrl = hook ? URL.parse(hook) : null;
      profile = {
        url,
        keys: Array.isArray(doc.keys)
          ? (doc.keys as PublicJwk[]).filter((k) => k && typeof k.kid === 'string' && typeof k.x === 'string').slice(0, 20)
          : [],
        webhookUrl: hookUrl && (hookUrl.protocol === 'https:' || (url.startsWith('http:') && hookUrl.protocol === 'http:')) ? hookUrl.toString() : null,
        version: typeof doc.ucp?.version === 'string' ? doc.ucp.version : null,
      };
    }
  } catch (e) {
    logger.warn('ucp: a platform profile could not be read', { url, error: String(e) });
  }
  if (cache.size > 500) cache.clear();
  cache.set(url, { at: Date.now(), profile });
  return profile;
}
