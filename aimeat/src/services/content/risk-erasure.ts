/**
 * @file src/services/content/risk-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An account erasure (services/owner/erasure.ts) and the content risk marks.
 *
 *   The person's own marks go with their memory: their facts shards and `contentclass.risk` are their
 *   records. What stays is the marks of content they wrote into other people's places: a message in
 *   another person's inbox, a post on another person's board, a document, a comment or a row of a
 *   workspace. Those entries name the writer (`writtenBy`, and `hold.decidedBy` when they released a
 *   hold), and the erasure gives each of them the erasure's pseudonym, as it does every other record it
 *   keeps for the other side. The marks themselves keep no words of the content (risk-store.ts).
 *
 *   WHERE IT LOOKS. Every person's `contentclass.risk` (one prefix query), and the risk record of every
 *   workspace of every organism the person is a member of: a person writes into no other workspace.
 *   It runs inside the cascade, before the memberships go.
 * @structure eraseContentRiskOf
 * @usage const renamed = await eraseContentRiskOf(storage, nodeId, name, identities, pseudonym);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { personRiskKey } from './risk-keys.js';

interface Entry { writtenBy?: string; hold?: { decidedBy?: string } }
interface Items { v: 1; items: Record<string, Entry> }
const parse = (v: unknown): Items => ({ v: 1, items: { ...((v as Items | null)?.items ?? {}) } });

async function rename(storage: Storage, rec: MemoryRecord, who: Set<string>, pseudonym: string): Promise<number> {
  let n = 0;
  await updateRecord(storage, rec.ownerGaii, rec.key, parse, (cur) => {
    n = 0;
    for (const [id, e] of Object.entries(cur.items)) {
      if (!e || typeof e !== 'object') continue;
      let changed = false;
      const next: Entry = { ...e };
      if (e.writtenBy && who.has(e.writtenBy)) { next.writtenBy = pseudonym; changed = true; }
      if (e.hold?.decidedBy && who.has(e.hold.decidedBy)) { next.hold = { ...e.hold, decidedBy: pseudonym }; changed = true; }
      if (changed) { cur.items[id] = next; n++; }
    }
    return n ? cur : UNCHANGED;
  }, { tag: 'contentrisk', visibility: 'private' });
  return n;
}

/**
 * Give the erasure's pseudonym to every entry that names one of `identities` (the person, their GHII,
 * their agents) as its writer or as who released its hold. Answers how many entries were renamed.
 */
export async function eraseContentRiskOf(
  storage: Storage, nodeId: string, name: string, identities: readonly string[], pseudonym: string,
): Promise<number> {
  const who = new Set(identities);
  let renamed = 0;
  const { items: people } = await storage.listAllMemory({ prefix: personRiskKey, limit: 100_000 });
  for (const rec of people) if (rec.key === personRiskKey) renamed += await rename(storage, rec, who, pseudonym);
  const system = `system@${nodeId}`;
  for (const m of await storage.listMembershipsByGhii(name)) {
    const recs = await storage.listMemory(system, { prefix: `organism.${m.organismId}.w.` });
    for (const rec of recs) if (rec.key.endsWith('.meta.contentrisk')) renamed += await rename(storage, rec, who, pseudonym);
  }
  return renamed;
}
