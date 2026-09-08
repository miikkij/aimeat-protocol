/**
 * @file app-record-keys.ts
 * @description Collision-free app record identities and verified legacy migration.
 * @version-history v1.0.0 - 2026-09-08 - Keep owner boundaries and filename case.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

export function canonicalAppId(appId: string): string {
  const slash = appId.indexOf('/');
  return slash < 0 ? appId : appId.slice(0, slash).toLowerCase() + appId.slice(slash);
}
export const appKeySegment = (id: string): string => `v2-${Buffer.from(canonicalAppId(id)).toString('hex')}`;
const legacySegment = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const equalAppId = (a: string, b: string): boolean => typeof a === 'string' && typeof b === 'string' && canonicalAppId(a) === canonicalAppId(b);

/** Copy only an identity-verified legacy row, then retire it in the same transaction. */
export async function readAppRecord(storage: Storage, ns: string, key: string, appId: string): Promise<MemoryRecord | null> {
  const current = await storage.getMemory(ns, key);
  if (current) return equalAppId((current.value as { appId: string })?.appId, appId) ? current : null;
  const legacyKey = key.replace(appKeySegment(appId), legacySegment(appId));
  const legacy = await storage.getMemory(ns, legacyKey);
  if (!legacy || !equalAppId((legacy.value as { appId: string })?.appId, appId)) return null;
  return storage.transaction(async () => {
    const existing = await storage.getMemory(ns, key);
    if (existing) return existing;
    const live = await storage.getMemory(ns, legacyKey);
    if (!live || !equalAppId((live.value as { appId: string })?.appId, appId)) return null;
    if (!storage.createMemoryIfAbsent) throw new Error('App record migration requires atomic storage creation.');
    const migrated = await storage.createMemoryIfAbsent({ ...live, key, visibility: 'private' });
    await storage.deleteMemory(ns, legacyKey);
    return migrated ?? await storage.getMemory(ns, key);
  });
}

/** Complete, namespace-pinned scans. Canonical rows take precedence over legacy duplicates. */
export async function listAppRecords(storage: Storage, ns: string, prefix: string, appId?: string): Promise<{ items: MemoryRecord[] }> {
  const rows: MemoryRecord[] = [];
  const prefixes = appId ? [`${prefix}${appKeySegment(appId)}.`, `${prefix}${legacySegment(appId)}.`] : [prefix];
  for (const scanPrefix of prefixes) {
    for (let offset = 0; ; ) {
      const page = await storage.listAllMemory({ ownerPrefix: ns, prefix: scanPrefix, limit: 1000, offset });
      rows.push(...page.items.filter(r => r.ownerGaii === ns));
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
  }
  const unique = new Map<string, MemoryRecord>();
  for (const row of rows.sort((a, b) => Number(a.key.includes('.v2-')) - Number(b.key.includes('.v2-')))) {
    const id = (row.value as { appId?: string })?.appId;
    if (appId && (!id || !equalAppId(id, appId))) continue;
    const key = id ? row.key.replace(legacySegment(id), appKeySegment(id)) : row.key;
    unique.set(key, row);
  }
  return { items: [...unique.values()] };
}
