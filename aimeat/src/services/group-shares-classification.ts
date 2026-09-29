/**
 * @file src/services/group-shares-classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a read may hand an organism's content to a reader outside that organism
 *   (TARGET-082 review, item 1). A memory record is the owner's, but an `organism.<id>.*` key is the
 *   ORGANISM's content wherever it is held (classification/labels.ts memoryTarget). A reader who is
 *   an active member of that organism reads it inside the organism, so the read carries it. Anyone
 *   else takes it out of the organism, so the key passes the classification component's leave()
 *   with the destination `share` first; a label that may not leave its organism keeps it behind, and
 *   the answer names the label and why. Personal content is the owner's to share, and
 *   classification off reads nothing.
 *
 *   The rule is the same whatever let the reader in: a group share (a key-space share), or the
 *   record's own visibility (`public` for anyone, `members` for any signed-in account). A person, an
 *   agent or an ecosystem app counts as a member through its owner's membership; an anonymous reader
 *   and a visitor from another node are never members.
 *
 *   WHY NOT IN THE ACCESS GUARD. authorizeRead (services/access-guard.ts) decides the share, and
 *   the classification reader sits above it: reader → labels → workspace-access → access-guard. A
 *   call from the guard into the reader closes that loop, which the dependency rules refuse. So each
 *   route or service that serves another account's memory by visibility or by share asks here:
 *   GET /v1/memory/:gaii/:key (routes/memory/public-read.ts), the node MCP tool
 *   aimeat_memory_read_public (mcp/memory-extended.ts), an extension's ctx.memory.getPublic
 *   (services/extension-ctx.ts), discovery's public scope (discovery/sources/memory-source.ts) and
 *   the librarian's public scope (services/librarian.ts).
 * @structure ShareCarried · OrganismLeft · organismKeysCarried(deps, records, accessor) ·
 *   shareCarriesKey(deps, ownerGaii, key, accessor)
 * @usage
 *   const carried = await shareCarriesKey({ storage, config }, record.ownerGaii, key, accessor);
 *   if (!carried.carries) refuse(403, 'CLASSIFIED', carried.reason, { label: carried.label });
 *   const { kept } = await organismKeysCarried({ storage, config }, hits, viewerGaii);
 * @version-history
 *   v1.1.0 — 2026-09-30 — TARGET-082 review, item 1, second part: the rule holds for a read the
 *     record's visibility let in (public, members), not only a share. organismKeysCarried() for a
 *     list, one membership read per organism; an anonymous reader is never a member.
 *   v1.0.0 — 2026-09-29 — TARGET-082 review, item 1. Initial.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { localAccountOf } from '../utils/gaii.js';
import { memoryTarget } from './classification/labels.js';
import { scopeOrganism } from './classification/policy.js';
import { systemReader } from './classification/reader.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> };

export type ShareCarried = { carries: true } | { carries: false; label: string; reason: string };

/** A record that stayed inside its organism: the record, its label id, and why. */
export interface OrganismLeft<T> { item: T; label: string; reason: string }

/** The workspace a key sits in (`organism.<id>.w.<ws>.…`), or '' for the organism's own keys. */
function wsOf(key: string): string {
  const parts = key.split('.');
  return parts[2] === 'w' && parts[3] ? parts[3] : '';
}

/**
 * The records of `records` that may be handed to `accessorGaii`, in their order, and the ones that
 * stay inside their organism. A record outside every organism is kept; so is an organism's record
 * for an active member of that organism. `accessorGaii` null, '' or 'anonymous' is a reader with no
 * account here.
 */
export async function organismKeysCarried<T extends { ownerGaii: string; key: string }>(
  deps: Deps, records: readonly T[], accessorGaii: string | null,
): Promise<{ kept: T[]; left: Array<OrganismLeft<T>> }> {
  if (deps.config.classificationMode === 'off' || !records.length) return { kept: [...records], left: [] };
  const orgOf = (r: T) => scopeOrganism(memoryTarget(r.ownerGaii, r.key).scope);
  const orgs = [...new Set(records.map(orgOf).filter((o): o is string => !!o))];
  if (!orgs.length) return { kept: [...records], left: [] };

  const anonymous = !accessorGaii || accessorGaii === 'anonymous';
  const name = anonymous ? null : localAccountOf(accessorGaii);
  const member = new Set<string>();
  if (name) {
    await Promise.all(orgs.map(async o => {
      const m = await deps.storage.getMembership(o, name);
      if (m && m.status === 'active') member.add(o);
    }));
  }

  // One leave() per organism and workspace, because the destination names both. The reader names
  // the accessor, so a refusal in the audit log says who was kept out.
  const reader = systemReader(deps, anonymous ? 'anonymous' : accessorGaii!);
  const groups = new Map<string, { organismId: string; ws: string; idx: number[] }>();
  records.forEach((r, i) => {
    const o = orgOf(r);
    if (!o || member.has(o)) return;
    const ws = wsOf(r.key);
    const g = `${o}\u0000${ws}`;
    const entry = groups.get(g) ?? { organismId: o, ws, idx: [] };
    entry.idx.push(i);
    groups.set(g, entry);
  });
  const stayed = new Map<number, { label: string; reason: string }>();
  for (const { organismId, ws, idx } of groups.values()) {
    const { left } = await reader.leave(idx, i => memoryTarget(records[i]!.ownerGaii, records[i]!.key), { kind: 'share', organismId, ws });
    for (const l of left) stayed.set(l.item, { label: l.label, reason: l.reason });
  }
  const kept: T[] = [];
  const left: Array<OrganismLeft<T>> = [];
  records.forEach((r, i) => {
    const s = stayed.get(i);
    if (s) left.push({ item: r, ...s }); else kept.push(r);
  });
  return { kept, left };
}

/** May a read hand `key` (held by `ownerGaii`) to `accessorGaii`? */
export async function shareCarriesKey(
  deps: Deps,
  ownerGaii: string,
  key: string,
  accessorGaii: string | null,
): Promise<ShareCarried> {
  const { left } = await organismKeysCarried(deps, [{ ownerGaii, key }], accessorGaii);
  const l = left[0];
  return l ? { carries: false, label: l.label, reason: l.reason } : { carries: true };
}
