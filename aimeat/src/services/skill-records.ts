/**
 * @file src/services/skill-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading the skills registry's memory records across the members who hold copies of
 *   them. Moved unchanged out of services/skills.ts (max-file-lines).
 * @structure listAcrossOwners(storage, prefix) · freshestByKey(records) ·
 *   writtenByWsWriters(deps, org, ws, records)
 * @usage const freshest = freshestByKey(await listAcrossOwners(storage, mKey)).get(mKey);
 * @version-history
 *   v1.1.0 — 2026-10-20 — writtenByWsWriters(): a workspace copy whose OWNER may not write that
 *     workspace's content is left out before freshest-wins (secaudit 2026-10, defence in depth for
 *     `component-registrar.ts:memory-component:organism-workspace-skill-key-write`). A package
 *     install used to write an organism key under a non-member's identity, and these readers then
 *     served that copy to the organism's members as their operating instructions.
 *   v1.0.0 — 2026-10-08 — Moved from services/skills.ts (max-file-lines).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { localAccountName } from '../utils/gaii.js';

/** All owners' copies of the records under a key prefix (workspace records may be
 *  published by different members — the organism content-ownership invariant). */
export async function listAcrossOwners(storage: Storage, prefix: string): Promise<MemoryRecord[]> {
  const { items } = await storage.listAllMemory({ prefix, limit: 2000 });
  return items;
}

/**
 * The copies whose OWNER may write workspace content here, which is the only copy a reader should
 * take: a workspace skill is read as instructions, and freshest-wins means one copy replaces the
 * rest. Every write path asks this rule first (services/skill-workspace-gate.ts over
 * services/organism-namespace-access.ts), so this is the read side of the same rule, not a second
 * copy of it: a record that arrived some other way, as a package install's raw write did until
 * 2026-10-20, is left where it is and never served.
 *
 * ONE CHECK PER DISTINCT OWNER, not per record. The owners holding copies of a workspace's skills
 * are its members, so a workspace with twenty skills and two publishers costs two checks whatever
 * the list is. The question is about the PERSON, so the probe caller carries the owner role: the
 * same owner's agent gets the owner's answer, which is what a user-level workspace role means
 * (Core 2026-11 COL-09). The probe key is the skills prefix of this workspace, which is what every
 * key here shares (the form services/schema-lock-rule.ts uses).
 */
export async function writtenByWsWriters(
  deps: { storage: Storage; config: AimeatConfig }, org: string, ws: string, records: MemoryRecord[],
): Promise<MemoryRecord[]> {
  const verdicts = new Map<string, Promise<boolean>>();
  const mayWrite = (ownerGaii: string): Promise<boolean> => {
    let verdict = verdicts.get(ownerGaii);
    if (!verdict) {
      verdict = checkOrganismNamespaceAccess(
        deps,
        { principal: ownerGaii, owner: localAccountName(ownerGaii), roles: ['owner'] },
        `organism.${org}.w.${ws}.skills._writer`, 'write',
      ).then(refusal => refusal === null);
      verdicts.set(ownerGaii, verdict);
    }
    return verdict;
  };
  const kept = await Promise.all(records.map(r => mayWrite(r.ownerGaii)));
  return records.filter((_, i) => kept[i]);
}

/** Collapse multi-owner copies of the same key to the freshest one (freshest-wins). */
export function freshestByKey(records: MemoryRecord[]): Map<string, MemoryRecord> {
  const best = new Map<string, MemoryRecord>();
  for (const r of records) {
    const cur = best.get(r.key);
    if (!cur || String(r.updatedAt) > String(cur.updatedAt)) best.set(r.key, r);
  }
  return best;
}
