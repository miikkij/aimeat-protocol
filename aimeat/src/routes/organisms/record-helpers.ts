/**
 * @file src/routes/organisms/record-helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism/workspace helpers that need no config and no closure: the namespace write
 *   rule, the role ladder, the freshest-copy tie-break, the member-GHII normaliser and the fork
 *   collapse. Extracted from ./shared.ts by pure move on 2026-08-11 when that file passed the
 *   800-line limit; the bodies are byte-identical and ./shared.ts re-exports the public ones, so
 *   every existing import (including src/mcp/workspaces.ts) resolves unchanged.
 * @structure canWriteNamespaceRule · roleSatisfies · fresherRec · ownerGhiiOf · collapseKeyTo · revertRecordToDraft
 * @usage import { fresherRec, ownerGhiiOf } from './record-helpers.js';
 * @version-history
 *   v1.1.0 — 2026-09-13 — revertRecordToDraft(): the body of shared.ts revertToDraft, moved unchanged
 *     (max-file-lines) when the UNDECLARED_SPACE refusal took that file past 800 lines. The closure
 *     in shared.ts keeps the refusal and calls this.
 *   v1.0.0 — 2026-08-11 — Extracted from shared.ts (max-file-lines); no behaviour change.
 */
import type { MemoryRecord, Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/**
 * Who may write in which namespace of a workspace: `meta.*` is the organism's own structure — its
 * manifest, its config, the roster of spaces — so only a creator or an admin may change it. Every
 * other namespace is content, and membership is enough.
 *
 * Module-level rather than a closure since 2026-08-11: the MCP workspace tools publish and revert
 * too, and they checked membership only. Any member's agent could publish over the manifest or the
 * config, and the config is where the gates are written.
 */
export function canWriteNamespaceRule(role: string, namespace: string): boolean {
  return namespace.startsWith('meta.') ? (role === 'creator' || role === 'admin') : true;
}

export function roleSatisfies(approverRole: string, membershipRole: string): boolean {
  if (approverRole === 'member') return true;                                  // any active member
  if (approverRole === 'admin') return membershipRole === 'creator' || membershipRole === 'admin';
  if (approverRole === 'owner') return membershipRole === 'creator';           // the organism owner
  return false;
}

/** Freshest of two records for the same key: higher version wins, then newer updatedAt. Guards workspace
 *  reads/writes against a key that has forked into duplicate-owner copies (a GHII + a legacy agent GAII). */
export function fresherRec(a: MemoryRecord | null | undefined, b: MemoryRecord): MemoryRecord {
  if (!a) return b;
  if (b.version !== a.version) return b.version > a.version ? b : a;
  return (b.updatedAt ?? '') >= (a.updatedAt ?? '') ? b : a;
}

/** The member GHII behind any identity: `agent#owner@node` → `owner@node`; a bare GHII is returned as-is.
 *  Workspace current-state records (.draft/.latest) are owned by this so a key never forks per-agent. */
export function ownerGhiiOf(identity: string): string {
  return identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity;
}

// Reopen a published record for editing: copy organism.{id}.{ns}.{instance}.latest → .draft so the
// existing edit → publish flow applies. The published .latest stays live (and keeps serving readers)
// until the edited draft is re-published. Refuses to clobber an in-progress draft.
export async function revertRecordToDraft(
  storage: Storage, organismId: string, ws: string | undefined, namespace: string, instance: string, reverter: string,
): Promise<{ ok: true } | { ok: false; code: 'NO_LATEST' | 'DRAFT_EXISTS' }> {
    const wsRoot = ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;
    const base = `${wsRoot}.${namespace}.${instance}`;
    // Reopening needs only .draft/.latest/bare — never the `.version.N` history values.
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000, excludeVersionRows: true });
    if (items.find(r => r.key === `${base}.draft`)) return { ok: false, code: 'DRAFT_EXISTS' };
    // Mirror the workspace read: the published current state is .latest, or the bare key as fallback.
    const latest = items.find(r => r.key === `${base}.latest`) ?? items.find(r => r.key === base);
    if (!latest) return { ok: false, code: 'NO_LATEST' };
    const now = new Date().toISOString();
    await storage.setMemory({
      key: `${base}.draft`, ownerGaii: reverter, value: latest.value,
      visibility: latest.visibility, tags: latest.tags ?? [], ttlHours: null,
      version: 1, createdAt: now, updatedAt: now,
    });
    return { ok: true };
}

/** Delete every copy of `key` NOT owned by `keepOwner` — collapses a forked key back to a single owner. */
export async function collapseKeyTo(storage: Storage, key: string, keepOwner: string): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  await Promise.all(items
    .filter(r => r.key === key && r.ownerGaii !== keepOwner)
    .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(err => { logger.warn('collapseKeyTo: best-effort collapse', { error: String(err) }); })));
}
