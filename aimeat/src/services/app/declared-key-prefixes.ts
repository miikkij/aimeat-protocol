/**
 * @file src/services/app/declared-key-prefixes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The memory key prefixes an owner's apps read from the OWNER's namespace: `apps.<id>.`
 *   for each app, and the literal start of every data map row the app keeps in the owner's memory
 *   (`where` owner-memory-private or owner-memory-public). Two readers: an agent's memory write under
 *   such a prefix, which lands in the agent's own namespace unless it says owner_scope
 *   (services/memory/write-app-prefix.ts), and a skill bound to an app whose text tells the AI to
 *   write the app's keys without owner_scope (services/skill/owner-scope-check.ts).
 *
 *   A ROW THAT NAMES AN AGENT IS LEFT OUT. Such a row says the app shows that agent's work
 *   (data-map-types.ts `agent`), so the app reads the agent's namespace there by design.
 *
 *   THE OWNER'S LIST IS CACHED FOR A MINUTE. It reads every app of the owner and each one's data map,
 *   and an agent may write many times a minute. A publish drops it (the `domain:apps` tag) and a data
 *   map write drops it (forgetOwnerAppKeyPrefixes from services/data-map/data-map-access.ts).
 * @structure rowKeyPrefix · keyUnderPrefix · prefixesOfMap · appKeyPrefixes · ownerAppKeyPrefixes ·
 *   appPrefixOfKey · forgetOwnerAppKeyPrefixes
 * @usage
 *   const hit = await appPrefixOfKey(storage, 'alice@node', 'scores.round1');
 *   if (hit) warnings.push(appPrefixWarning(key, landedIn, hit));
 * @version-history
 *   2026-11-21 — Initial: the agent write under an app's key prefix, and the bound skill's owner_scope check.
 */
import type { Storage } from '../../storage/interface.js';
import { cached, invalidateKey } from '../cache.js';
import { appDataMapKey, DATA_MAP_SPEC, type DataMap } from '../data-map/data-map-types.js';
import { appDataMapId } from './app-ref.js';

/** One prefix and the app that reads it. `app` is the app's file name. */
export interface AppKeyPrefix { app: string; prefix: string }

/** Where a row's data sits for the app to read it from the owner's namespace. */
const OWNER_MEMORY = new Set(['owner-memory-private', 'owner-memory-public']);

/** How many apps one owner's list reads; past this the rest are not checked. */
const MAX_APPS = 500;
const CACHE_TTL_MS = 60_000;
const cacheKey = (ownerGhii: string): string => `app-key-prefixes:${ownerGhii}`;

/**
 * The literal start of a row's key family: `news.<date>.*` → `news.`, `scores.*` → `scores.`,
 * `profile` → `profile`. Null when the family starts with a placeholder or is shorter than three
 * characters, which would match nearly every key.
 */
export function rowKeyPrefix(what: string): string | null {
  const text = String(what ?? '').trim();
  const cut = text.search(/[<{[*\s(`'"]/);
  const literal = cut === -1 ? text : text.slice(0, cut);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(literal)) return null;
  if (literal.replace(/\.+$/, '').length < 3) return null;
  // A sentence ("the notes the person writes") is not a key family: a word cut at a space counts
  // only when it already has a dot in it.
  if (cut !== -1 && /[\s(`'"]/.test(text[cut]) && !literal.includes('.')) return null;
  return literal;
}

/** Whether `key` is in the family `prefix` names: under it when it ends in a dot, else it or below it. */
export function keyUnderPrefix(key: string, prefix: string): boolean {
  if (prefix.endsWith('.')) return key.startsWith(prefix);
  return key === prefix || key.startsWith(`${prefix}.`);
}

/** One app's prefixes from its data map (null: the app has none). */
export function prefixesOfMap(appId: string, map: DataMap | null): string[] {
  const out = new Set<string>([`apps.${appId}.`]);
  for (const row of map?.held ?? []) {
    if (!row || !OWNER_MEMORY.has(String(row.where)) || row.agent) continue;
    const prefix = rowKeyPrefix(row.what);
    if (prefix) out.add(prefix);
  }
  return [...out];
}

/** One app's prefixes, read from its data map record (data-map-store.ts readAppDataMap reads the same record). */
export async function appKeyPrefixes(storage: Storage, ownerGhii: string, filename: string): Promise<string[]> {
  const appId = appDataMapId(filename);
  const rec = await storage.getMemory(ownerGhii, appDataMapKey(appId));
  const value = rec?.value as DataMap | undefined;
  const map = value && typeof value === 'object' && value.spec === DATA_MAP_SPEC ? value : null;
  return prefixesOfMap(appId, map);
}

/** Every prefix the owner's apps read from the owner's namespace, cached for a minute. */
export async function ownerAppKeyPrefixes(storage: Storage, ownerGhii: string): Promise<AppKeyPrefix[]> {
  return cached(cacheKey(ownerGhii), CACHE_TTL_MS, async () => {
    const out: AppKeyPrefix[] = [];
    for (let offset = 0; offset < MAX_APPS;) {
      const { apps, total } = await storage.listApps({ ownerGaii: ownerGhii, adminView: true, limit: 200, offset });
      for (const app of apps) {
        for (const prefix of await appKeyPrefixes(storage, ownerGhii, app.filename)) out.push({ app: app.filename, prefix });
      }
      offset += apps.length;
      if (!apps.length || offset >= total) break;
    }
    return out;
  }, ['domain:apps']);
}

/** The longest prefix of the owner's apps `key` is under, or null. */
export async function appPrefixOfKey(storage: Storage, ownerGhii: string, key: string): Promise<AppKeyPrefix | null> {
  let best: AppKeyPrefix | null = null;
  for (const hit of await ownerAppKeyPrefixes(storage, ownerGhii)) {
    if (keyUnderPrefix(key, hit.prefix) && (!best || hit.prefix.length > best.prefix.length)) best = hit;
  }
  return best;
}

/** Drop the owner's cached list, after a data map write. */
export function forgetOwnerAppKeyPrefixes(ownerGhii: string): void {
  invalidateKey(cacheKey(ownerGhii));
}
