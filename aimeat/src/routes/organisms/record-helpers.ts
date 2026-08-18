/**
 * @file src/routes/organisms/record-helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism/workspace helpers that need no config and no closure: the namespace write
 *   rule, the role ladder, the freshest-copy tie-break, the member-GHII normaliser and the fork
 *   collapse. Extracted from ./shared.ts by pure move on 2026-08-11 when that file passed the
 *   800-line limit; the bodies are byte-identical and ./shared.ts re-exports the public ones, so
 *   every existing import (including src/mcp/workspaces.ts) resolves unchanged.
 * @structure canWriteNamespaceRule · roleSatisfies · fresherRec · ownerGhiiOf · collapseKeyTo
 * @usage import { fresherRec, ownerGhiiOf } from './record-helpers.js';
 * @version-history
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

/** Delete every copy of `key` NOT owned by `keepOwner` — collapses a forked key back to a single owner. */
export async function collapseKeyTo(storage: Storage, key: string, keepOwner: string): Promise<void> {
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  await Promise.all(items
    .filter(r => r.key === key && r.ownerGaii !== keepOwner)
    .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(err => { logger.warn('collapseKeyTo: best-effort collapse', { error: String(err) }); })));
}
