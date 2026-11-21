/**
 * @file src/services/content/risk-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the content risk marks of a person's messages and posts and of a workspace's items
 *   are kept, as keys, and the removal of one item's entry when the item is deleted. It imports only
 *   the record write helper, so the delete paths (a workspace document, a comment, a row, a message, a
 *   post) can call it without an import cycle through the content pipeline. risk-store.ts reads and
 *   writes the same records.
 *
 *   A DELETED ITEM TAKES ITS MARKS WITH IT. The marks keep no words of the content (risk-store.ts
 *   strips the excerpt), but their entry names the item and who wrote it, so it goes with the item.
 * @structure personRiskKey · workspaceRiskKey · dropPersonRiskEntry · dropPersonRiskPrefix · dropWorkspaceRiskEntry ·
 *   pruneRowRiskEntries
 * @usage await dropWorkspaceRiskEntry(storage, nodeId, org, ws, `comment:${key}`);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { Storage } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';

/** A person's record of the marks of their messages, posts and agent messages. */
export const personRiskKey = 'contentclass.risk';
/** A workspace's record of the marks of its documents, comments and rows, held by the node's identity. */
export function workspaceRiskKey(org: string, ws: string): string { return `organism.${org}.w.${ws}.meta.contentrisk`; }

interface Items { v: 1; items: Record<string, unknown> }
const parse = (v: unknown): Items => ({ v: 1, items: { ...((v as Items | null)?.items ?? {}) } });

async function drop(storage: Storage, owner: string, key: string, id: string): Promise<void> {
  if (!(await storage.getMemory(owner, key))) return;
  await updateRecord(storage, owner, key, parse, (cur) => {
    if (!(id in cur.items)) return UNCHANGED;
    delete cur.items[id];
    return cur;
  }, { tag: 'contentrisk', visibility: 'private' });
}

/** Remove one entry from a person's record (`dm:<id>`, `board:<board>:<id>`, `agent-message:<agent>:<id>`). */
export async function dropPersonRiskEntry(storage: Storage, ownerGhii: string, id: string): Promise<void> {
  await drop(storage, ownerGhii, personRiskKey, id);
}

/** Remove every entry of a person's record whose id starts with `prefix` (`board:<board>:` when a board goes). */
export async function dropPersonRiskPrefix(storage: Storage, ownerGhii: string, prefix: string): Promise<void> {
  if (!(await storage.getMemory(ownerGhii, personRiskKey))) return;
  await updateRecord(storage, ownerGhii, personRiskKey, parse, (cur) => {
    const gone = Object.keys(cur.items).filter((id) => id.startsWith(prefix));
    for (const id of gone) delete cur.items[id];
    return gone.length ? cur : UNCHANGED;
  }, { tag: 'contentrisk', visibility: 'private' });
}

/** Remove one entry from a workspace's record (`memory:<key>`, `comment:<key>`, `row:<namespace>:<id>`). */
export async function dropWorkspaceRiskEntry(storage: Storage, nodeId: string, org: string, ws: string, id: string): Promise<void> {
  await drop(storage, `system@${nodeId}`, workspaceRiskKey(org, ws), id);
}

/**
 * After rows of one space were removed in bulk (a retention sweep, a cutoff): remove the entries of
 * the space's rows that `existing` no longer finds. One lookup for every marked row of the space.
 */
export async function pruneRowRiskEntries(
  storage: Storage, nodeId: string, org: string, ws: string, namespace: string,
  existing: (rowIds: string[]) => Promise<Set<string>>,
): Promise<void> {
  const owner = `system@${nodeId}`;
  const key = workspaceRiskKey(org, ws);
  const rec = await storage.getMemory(owner, key);
  if (!rec) return;
  const prefix = `row:${namespace}:`;
  const ids = Object.keys(parse(rec.value).items).filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  if (!ids.length) return;
  const still = await existing(ids);
  const gone = ids.filter((id) => !still.has(id));
  if (!gone.length) return;
  await updateRecord(storage, owner, key, parse, (cur) => {
    let changed = false;
    for (const id of gone) if (`${prefix}${id}` in cur.items) { delete cur.items[`${prefix}${id}`]; changed = true; }
    return changed ? cur : UNCHANGED;
  }, { tag: 'contentrisk', visibility: 'private' });
}
