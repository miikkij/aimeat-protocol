/**
 * @file src/services/compliance-docs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the compliance documents of plan doc-mvlftkh9zmc9 are kept, for which scope, and
 *   how one is read, replaced, appended to and removed. Who may do any of it is decided in
 *   services/compliance-docs-access.ts; what a valid document is, in compliance-docs-schemas.ts.
 *
 *   THREE SCOPES (decisions 10.1, 10.6, 10.10). The node's own documents, an organism's (its creator
 *   or admins keep them) and an app's (its owner keeps them). Which documents a scope has:
 *     registers, requests, breaches, dpias   node, organism, app
 *     frameworks                            node, organism
 *     processors                            node (the node is what sends data to them)
 *
 *   EVERY DOCUMENT IS A RECORD OF `system@<node>`, as the AI use-case register is
 *   (compliance-register.ts): the node's own configuration, outside every owner's key quota and
 *   memory listing, written by no memory route. Keys:
 *     compliance.<kind>                         the node's
 *     compliance.<kind>.org.<organismId>        an organism's
 *     compliance.<kind>.app.<owner>.<slug>      an app's (its owner's account name and the app's slug)
 *
 *   A WRITE REPLACES THE DOCUMENT, through a conditional write (record-cas.ts updateRecord): a
 *   concurrent writer's change is never overwritten with a stale copy. appendRequest() adds one data
 *   subject request the same way, which is how an export or an erasure the node carried out logs
 *   itself while a person edits the list.
 *
 *   A SCOPE THAT GOES TAKES ITS DOCUMENTS. removeComplianceDocs() is called when an organism is
 *   deleted, an app is deleted or an owner is erased (their apps' documents).
 * @structure ComplianceScope · SCOPES_OF · scopeAllows() · docKey() · scopeOfKey() · readDoc() · writeDoc() ·
 *   patchDocItem() · appendRequest() · listDocs() · removeComplianceDocs() · removeAppDocsOfOwner()
 * @usage
 *   const doc = await readDoc(storage, nodeId, 'registers', { kind: 'organism', organismId });
 *   await writeDoc(storage, nodeId, 'registers', scope, { items }, 'alice@node');
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1.2, C4.3, C5, C6).
 *   v1.1.0 — 2026-10-24 — patchDocItem(): one entry changed in place, the rest untouched (C7.7).
 */
import type { Storage } from '../storage/interface.js';
import { appSlug } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { systemGhiiFor } from './compliance-register.js';
import {
  emptyDoc, COMPLIANCE_DOC_KINDS, type ComplianceDocKind, type ComplianceDocs, type ComplianceRequest,
} from './compliance-docs-schemas.js';

export type ComplianceScope =
  | { kind: 'node' }
  | { kind: 'organism'; organismId: string }
  | { kind: 'app'; ownerName: string; app: string };

/** Which scopes keep which document. */
export const SCOPES_OF: Record<ComplianceDocKind, ReadonlyArray<ComplianceScope['kind']>> = {
  registers: ['node', 'organism', 'app'],
  requests: ['node', 'organism', 'app'],
  breaches: ['node', 'organism', 'app'],
  dpias: ['node', 'organism', 'app'],
  frameworks: ['node', 'organism'],
  processors: ['node'],
};

export function scopeAllows(kind: ComplianceDocKind, scope: ComplianceScope): boolean {
  return SCOPES_OF[kind].includes(scope.kind);
}

/** An id that goes into a key: no dot, no slash, no space, so it cannot reach another key. */
const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

/** The record key of a document, or null when an id in the scope cannot be part of a key. */
export function docKey(kind: ComplianceDocKind, scope: ComplianceScope): string | null {
  if (scope.kind === 'node') return `compliance.${kind}`;
  if (scope.kind === 'organism') return SAFE.test(scope.organismId) ? `compliance.${kind}.org.${scope.organismId}` : null;
  const slug = appSlug(scope.app);
  return SAFE.test(scope.ownerName) && SAFE.test(slug) ? `compliance.${kind}.app.${scope.ownerName}.${slug}` : null;
}

/** The scope a stored key belongs to (the inverse of docKey), or null for a key of another shape. */
export function scopeOfKey(key: string): { kind: ComplianceDocKind; scope: ComplianceScope } | null {
  const m = /^compliance\.([a-z]+)(?:\.org\.([^.]+)|\.app\.([^.]+)\.([^.]+))?$/.exec(key);
  if (!m || !(COMPLIANCE_DOC_KINDS as readonly string[]).includes(m[1]!)) return null;
  const kind = m[1] as ComplianceDocKind;
  if (m[2]) return { kind, scope: { kind: 'organism', organismId: m[2] } };
  if (m[3] && m[4]) return { kind, scope: { kind: 'app', ownerName: m[3], app: m[4] } };
  return { kind, scope: { kind: 'node' } };
}

function parseDoc<K extends ComplianceDocKind>(kind: K) {
  return (v: unknown): ComplianceDocs[K] => {
    if (kind === 'frameworks') {
      return (v && typeof v === 'object' && (v as { answers?: unknown }).answers ? v : emptyDoc(kind)) as ComplianceDocs[K];
    }
    return (v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) ? v : emptyDoc(kind)) as ComplianceDocs[K];
  };
}

/** The document, or the empty one when nothing is stored. */
export async function readDoc<K extends ComplianceDocKind>(
  storage: Storage, nodeId: string, kind: K, scope: ComplianceScope,
): Promise<ComplianceDocs[K]> {
  const key = docKey(kind, scope);
  if (!key) return emptyDoc(kind);
  const rec = await storage.getMemory(systemGhiiFor(nodeId), key);
  return parseDoc(kind)(rec?.value);
}

/** Stamp each entry (or the whole answers document) with the node's clock and the writer. */
function stamped<K extends ComplianceDocKind>(kind: K, doc: ComplianceDocs[K], by: string): ComplianceDocs[K] {
  const now = new Date().toISOString();
  if (kind === 'frameworks') return { ...(doc as ComplianceDocs['frameworks']), updatedAt: now, updatedBy: by } as ComplianceDocs[K];
  const items = (doc as { items: Array<Record<string, unknown>> }).items
    .map(it => ({ ...it, updatedAt: now, updatedBy: by }));
  return { items } as ComplianceDocs[K];
}

/** Replace the document. Answers what was stored. */
export async function writeDoc<K extends ComplianceDocKind>(
  storage: Storage, nodeId: string, kind: K, scope: ComplianceScope, doc: ComplianceDocs[K], by: string,
): Promise<ComplianceDocs[K]> {
  const key = docKey(kind, scope);
  if (!key) throw new Error(`no ${kind} document for this scope`);
  const next = stamped(kind, doc, by);
  const out = await updateRecord(storage, systemGhiiFor(nodeId), key, parseDoc(kind), () => next, { tag: 'compliance', tags: ['compliance', kind] });
  emitChange('compliance');
  return out;
}

/**
 * Change one entry of a document in place (C7.7): `change` gets the stored entry and answers the new
 * one, `validate` checks the whole document before it is written, and only the changed entry is
 * stamped. Atomic like writeDoc. Answers the stored entry, or null when no entry has that id.
 */
export async function patchDocItem<K extends Exclude<ComplianceDocKind, 'frameworks'>>(
  storage: Storage, nodeId: string, kind: K, scope: ComplianceScope, itemId: string,
  change: (item: Record<string, unknown>) => Record<string, unknown>,
  validate: (doc: { items: Array<Record<string, unknown>> }) => ComplianceDocs[K], by: string,
): Promise<Record<string, unknown> | null> {
  const key = docKey(kind, scope);
  if (!key) return null;
  let found: Record<string, unknown> | null = null;
  await updateRecord(storage, systemGhiiFor(nodeId), key, parseDoc(kind), (cur) => {
    const items = (cur as { items: Array<Record<string, unknown>> }).items;
    const at = items.findIndex(it => it.id === itemId);
    if (at < 0) { found = null; return UNCHANGED; }
    const next = { ...change(items[at]!), id: itemId, updatedAt: new Date().toISOString(), updatedBy: by };
    found = next;
    return validate({ items: items.map((it, i) => (i === at ? next : it)) });
  }, { tag: 'compliance', tags: ['compliance', kind] });
  if (found) emitChange('compliance');
  return found;
}

/** One month after an ISO time, the GDPR art. 12(3) deadline. */
export function oneMonthAfter(iso: string): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/**
 * Add one data subject request (C4.3). The node calls this when it carries one out itself (an
 * export, an account erasure), so the list says it was done and when; a person edits the rest.
 */
export async function appendRequest(
  storage: Storage, nodeId: string, scope: ComplianceScope,
  req: Omit<ComplianceRequest, 'id' | 'dueAt'> & { id?: string },
): Promise<void> {
  const key = docKey('requests', scope);
  if (!key) return;
  const now = new Date().toISOString();
  const entry: ComplianceRequest = {
    ...req, id: req.id ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    dueAt: oneMonthAfter(req.receivedAt), updatedAt: now, updatedBy: `system@${nodeId}`,
  };
  await updateRecord(storage, systemGhiiFor(nodeId), key, parseDoc('requests'),
    cur => ({ items: [...cur.items, entry].slice(-2000) }), { tag: 'compliance', tags: ['compliance', 'requests'] });
  emitChange('compliance');
}

/** Every stored document of a kind across all scopes, for the operator's node-wide report. */
export async function listDocs<K extends ComplianceDocKind>(
  storage: Storage, nodeId: string, kind: K,
): Promise<Array<{ scope: ComplianceScope; doc: ComplianceDocs[K] }>> {
  const { items } = await storage.listAllMemory({
    ownerPrefix: systemGhiiFor(nodeId), prefix: `compliance.${kind}`, limit: 5000, excludeVersionRows: true,
  });
  const out: Array<{ scope: ComplianceScope; doc: ComplianceDocs[K] }> = [];
  for (const r of items) {
    if (r.ownerGaii !== systemGhiiFor(nodeId)) continue;
    const at = scopeOfKey(r.key);
    if (!at || at.kind !== kind) continue;
    out.push({ scope: at.scope, doc: parseDoc(kind)(r.value) });
  }
  return out;
}

/** Remove every document of a scope that went (an organism or an app deleted). */
export async function removeComplianceDocs(storage: Storage, nodeId: string, scope: ComplianceScope): Promise<number> {
  let n = 0;
  for (const kind of COMPLIANCE_DOC_KINDS) {
    if (!scopeAllows(kind, scope)) continue;
    const key = docKey(kind, scope);
    if (key && await storage.deleteMemory(systemGhiiFor(nodeId), key)) n++;
  }
  if (n) emitChange('compliance');
  return n;
}

/** Remove the documents of every app of an owner who is erased. */
export async function removeAppDocsOfOwner(storage: Storage, nodeId: string, ownerName: string): Promise<number> {
  if (!SAFE.test(ownerName)) return 0;
  let n = 0;
  for (const kind of COMPLIANCE_DOC_KINDS) {
    if (!scopeAllows(kind, { kind: 'app', ownerName, app: 'x' })) continue;
    const { items } = await storage.listAllMemoryMeta({
      ownerPrefix: systemGhiiFor(nodeId), prefix: `compliance.${kind}.app.${ownerName}.`, limit: 1000, excludeVersionRows: true,
    });
    for (const r of items) if (r.ownerGaii === systemGhiiFor(nodeId) && await storage.deleteMemory(r.ownerGaii, r.key)) n++;
  }
  if (n) emitChange('compliance');
  return n;
}
