/**
 * @file src/services/classification/label-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a label is stored and how it is read back: a memory key's label address (one
 *   address per workspace document, whatever copy names it), the row a target's label is read from
 *   and written over, and the batch read of many targets' labels. Moved unchanged out of labels.ts
 *   so the effective label (effective.ts) reads labels without importing labels.ts, which imports
 *   it; labels.ts re-exports every public name, so no caller changed its import.
 *
 *   ONE LABEL PER DOCUMENT (decided 2026-09-30). A workspace document or an organism record is
 *   stored under several keys (bare, `.draft`, `.latest`, `.version.N`); memoryTarget gives them all
 *   the document's address (documentKeyOf), so a label on any copy is the document's. A label a copy
 *   carried under its own key before this reads into the document's label, the strictest one wins,
 *   and the next write folds those rows into the document's row (currentRow).
 * @structure documentKeyOf() · memoryTarget() · labelAddressOf() · documentContentKeys() · currentRow() ·
 *   labelsFor() · targetId()
 * @usage const rows = await labelsFor(storage, policy, targets); rows.get(targetId(t))?.label
 * @version-history
 *   v1.0.0 — 2026-10-18 — Extracted unchanged from labels.ts (plan doc-mvdipuyqraas, L1).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ContentLabelRow, ContentLabelTarget, ContentLabelKind } from '../../storage/interface.js';
import { labelById, type ClassificationPolicy } from './defaults.js';
import { scopeOrganism } from './policy.js';

/** The suffixes a workspace document or an organism record is stored under besides its bare key. */
const COPY_SUFFIX = /^(organism\.[^.]+\.(.+))\.(?:draft|latest|version\.\d+)$/;
const COPY_ROLE = /^(?:draft|latest|version\.\d+)$/;

/**
 * The one label address of a workspace document or an organism record (decided 2026-09-30): its key
 * without the `.draft`, `.latest` or `.version.N` suffix the workspace stores its copies under
 * (services/workspace-write.ts deleteWorkspaceInstance names the same family). A label set on any
 * copy is the document's, so publishing never makes an unlabelled copy. The address needs a
 * namespace and an instance before the suffix: `organism.<id>.w.<ws>.<ns>.<instance>` in a
 * workspace, `organism.<id>.<ns>.<instance>` outside one. Any other key is its own address.
 */
export function documentKeyOf(key: string): string {
  const m = COPY_SUFFIX.exec(key);
  if (!m) return key;
  const rest = m[2]!.split('.');
  return rest.length >= (rest[0] === 'w' ? 4 : 2) ? m[1]! : key;
}

/** A memory key's label address: an organism key belongs to the organism, whoever wrote it, and a
 *  document's copies share the document's address (documentKeyOf). */
export function memoryTarget(ownerGaii: string, key: string): ContentLabelTarget {
  if (key.startsWith('organism.')) {
    const id = key.split('.')[1];
    if (id) return { kind: 'memory', scope: `organism:${id}`, key: documentKeyOf(key) };
  }
  return { kind: 'memory', scope: ownerGaii, key };
}

/**
 * A target as its label address: an organism memory key named by one of its copies' keys (a queued
 * item or a caller that built the target itself) is moved to the document's address.
 */
export function labelAddressOf(t: ContentLabelTarget): ContentLabelTarget {
  if (t.kind !== 'memory' || !scopeOrganism(t.scope)) return t;
  const key = documentKeyOf(t.key);
  return key === t.key ? t : { ...t, key };
}

/**
 * The memory keys a document's current content is stored under (the bare key, `.latest`, `.draft`),
 * for a reader of its text such as the classifier's queue; any other key is only itself.
 */
export function documentContentKeys(key: string): string[] {
  const doc = documentKeyOf(key);
  if (!doc.startsWith('organism.') || documentKeyOf(`${doc}.latest`) !== doc) return [key];
  return [doc, `${doc}.latest`, `${doc}.draft`];
}

/**
 * The key prefix under which a document address's copies carried labels of their own before a
 * document had one address, or null when the target is not a document address.
 */
function copyPrefixOf(t: ContentLabelTarget): string | null {
  if (t.kind !== 'memory' || !scopeOrganism(t.scope)) return null;
  return documentKeyOf(`${t.key}.latest`) === t.key ? `${t.key}.` : null;
}

/** Is this stored row a label a copy of the document at `prefix` carried under its own key? */
const isCopyRow = (row: ContentLabelRow, prefix: string) => row.key.startsWith(prefix) && COPY_ROLE.test(row.key.slice(prefix.length));

/** The strictest of a document's rows: the highest rank in the policy, a person's label on a tie. */
function strictestRow(policy: ClassificationPolicy, rows: ContentLabelRow[]): ContentLabelRow | null {
  let best: ContentLabelRow | null = null;
  const rank = (r: ContentLabelRow) => labelById(policy, r.label)?.rank ?? -1;
  for (const r of rows) {
    if (!best || rank(r) > rank(best) || (rank(r) === rank(best) && r.locked && !best.locked)) best = r;
  }
  return best;
}

/**
 * The row a target's label is read from and written over. For a document address it is the
 * strictest of the document's own row and the rows its copies carried under their own keys before
 * (so nothing already labelled reads weaker), moved to the document address; `stale` names the copy
 * rows, which the next write folds away so the document keeps one row.
 */
export async function currentRow(storage: Storage, policy: ClassificationPolicy, target: ContentLabelTarget): Promise<{ row: ContentLabelRow | undefined; stale: ContentLabelTarget[] }> {
  const own = await storage.getContentLabel(target);
  const prefix = copyPrefixOf(target);
  if (!prefix) return { row: own, stale: [] };
  const copies = (await storage.getContentLabelsUnder(target.kind, target.scope, [prefix])).filter(r => isCopyRow(r, prefix));
  if (!copies.length) return { row: own, stale: [] };
  const best = strictestRow(policy, own ? [own, ...copies] : copies)!;
  const suggestion = best.suggestion ?? [own, ...copies].find(r => r?.suggestion)?.suggestion ?? null;
  const row: ContentLabelRow = { ...best, id: own?.id ?? randomUUID(), key: target.key, suggestion, history: [...best.history] };
  return { row, stale: copies.map(r => ({ kind: r.kind, scope: r.scope, key: r.key })) };
}

/**
 * The label of each target: its row, or the policy's default. One query per kind+scope,
 * and one more for an organism's document addresses: a document reads as the strictest of its own
 * row and the rows its copies carried under their own keys before (currentRow). A container's label
 * does not enter here; effective.ts adds it.
 */
export async function labelsFor(
  storage: Storage, policy: ClassificationPolicy, targets: ContentLabelTarget[],
): Promise<Map<string, { label: string; row: ContentLabelRow | null }>> {
  // `keys` are the caller's keys; each is read at its label address (labelAddressOf) and answered
  // under the caller's own target id.
  const groups = new Map<string, { kind: ContentLabelKind; scope: string; keys: string[] }>();
  for (const t of targets) {
    const g = `${t.kind}\u0000${t.scope}`;
    const cur = groups.get(g) ?? { kind: t.kind, scope: t.scope, keys: [] };
    cur.keys.push(t.key);
    groups.set(g, cur);
  }
  const out = new Map<string, { label: string; row: ContentLabelRow | null }>();
  for (const g of groups.values()) {
    const addr = (k: string) => labelAddressOf({ kind: g.kind, scope: g.scope, key: k });
    const rows = await storage.getContentLabels(g.kind, g.scope, g.keys.map(k => addr(k).key));
    const byKey = new Map(rows.map(r => [r.key, r]));
    const prefixes = new Map<string, string>();
    for (const k of g.keys) {
      const p = copyPrefixOf(addr(k));
      if (p) prefixes.set(k, p);
    }
    const copyRows = prefixes.size ? await storage.getContentLabelsUnder(g.kind, g.scope, [...new Set(prefixes.values())]) : [];
    for (const k of g.keys) {
      const own = byKey.get(addr(k).key) ?? null;
      const p = prefixes.get(k);
      const copies = p ? copyRows.filter(r => isCopyRow(r, p)) : [];
      const row = copies.length ? strictestRow(policy, own ? [own, ...copies] : copies) : own;
      out.set(targetId({ kind: g.kind, scope: g.scope, key: k }), { label: row?.label ?? policy.defaultLabel, row });
    }
  }
  return out;
}

/** The map key labelsFor answers under. */
export function targetId(t: ContentLabelTarget): string {
  return `${t.kind}\u0000${t.scope}\u0000${t.key}`;
}
