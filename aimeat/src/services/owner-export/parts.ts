/**
 * @file src/services/owner-export/parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts a person chooses for their data export, and how large each one is on their
 *   account, measured before anything is written. The account itself (profile, agents, consents,
 *   messages, tasks, bookkeeping and every other section of account-sections.ts) is always in it; the
 *   five parts below are what makes an export large, so each is a choice with its size beside it.
 *
 *   HOW THE SIZES ARE READ. Memory from the totals the database keeps per principal (getMemoryTotals),
 *   app versions and files from their metadata (sizes without bytes), AI provenance from its count
 *   times the mean length of the newest page. Nothing reads a value or a byte. A size is the bytes of
 *   the content; the ZIP compresses text, so the files are smaller.
 *
 *   FILES IN THE PERSON'S OWN STORE are a part of their own, off unless chosen: those bytes are already
 *   in a store the person holds, and copying them through the node costs both disks and the transfer.
 * @structure EXPORT_PARTS · ExportPartId · DEFAULT_PARTS · exportPrincipals · measureExport ·
 *   fileBelongsToPart
 * @usage const sizes = await measureExport(storage, principals);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { Storage, StorageFileRecord } from '../../storage/interface.js';
import { parseBlobRef } from '../../storage/blob/blob-types.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { isValidGHII } from '../../utils/gaii.js';
import { serviceNamespaceOf } from '../../utils/service-namespace.js';

export const EXPORT_PARTS = ['memories', 'ai_provenance', 'app_code', 'files', 'files_own_store'] as const;
export type ExportPartId = (typeof EXPORT_PARTS)[number];

/** What a part holds, in the words the page and the AI give the person. */
export const PART_WHAT: Readonly<Record<ExportPartId | 'account', string>> = Object.freeze({
  account: 'Your profile, your agents and their settings, consents, messages, tasks, work, bookkeeping, connections without their credentials, and the facts of every app and file. Always included.',
  memories: 'Every memory record of yours and of your agents, one JSON line each.',
  ai_provenance: 'The record of what an AI made for you: which model, when, and how much a person checked it.',
  app_code: 'The code of every app you published, every version of it.',
  files: 'The contents of the files this node keeps for you and your agents.',
  files_own_store: 'The contents of the files in a store you connected yourself. You hold these already, so they are left out unless you choose them.',
});

/** The parts chosen when the person names none: everything but the copy of their own store. */
export const DEFAULT_PARTS: readonly ExportPartId[] = ['memories', 'ai_provenance', 'app_code', 'files'];

export interface ExportPrincipals {
  ghii: string;
  agents: string[];
}

/** The account's GHII and its agents' GAIIs: the identities an export reads. */
export async function exportPrincipals(storage: Storage, name: string): Promise<ExportPrincipals | null> {
  const ghii = (await storage.getGHIIByOwner(name))?.ghii;
  if (!ghii) return null;
  const agents = (await loadOwnerAgents(storage, name)).map(a => a.gaii);
  return { ghii, agents };
}

/** Whether a file's bytes are in a store the person connected (its own part), or the node holds them. */
export function inOwnStore(file: Pick<StorageFileRecord, 'blobRef'>): boolean {
  return !!parseBlobRef(file.blobRef)?.storeId.startsWith('owner:');
}

/** The part a stored file's bytes belong to. */
export function fileBelongsToPart(file: Pick<StorageFileRecord, 'blobRef'>): ExportPartId {
  return inOwnStore(file) ? 'files_own_store' : 'files';
}

export interface PartSize { count: number; bytes: number }

/** How large each part is on this account: count and bytes. */
export async function measureExport(storage: Storage, p: ExportPrincipals): Promise<Record<ExportPartId, PartSize>> {
  const all = [p.ghii, ...p.agents];
  const sizes: Record<ExportPartId, PartSize> = {
    memories: { count: 0, bytes: 0 }, ai_provenance: { count: 0, bytes: 0 }, app_code: { count: 0, bytes: 0 },
    files: { count: 0, bytes: 0 }, files_own_store: { count: 0, bytes: 0 },
  };

  for (const ns of [...all, ...(isValidGHII(p.ghii) ? [serviceNamespaceOf(p.ghii)] : [])]) {
    const t = await storage.getMemoryTotals(ns);
    sizes.memories.count += t.keys;
    sizes.memories.bytes += t.bytes;
  }

  const sample = await storage.listAiProvenance({ ownerGhii: p.ghii, limit: 50 });
  const mean = sample.items.length ? sample.items.reduce((s, r) => s + JSON.stringify(r.record).length, 0) / sample.items.length : 0;
  sizes.ai_provenance = { count: sample.total, bytes: Math.round(sample.total * (mean + 200)) };

  for (const ownerGaii of all) {
    const { apps } = await storage.listApps({ ownerGaii, limit: 100_000 });
    for (const app of apps) {
      for (const v of await storage.listAppVersionSizes(app.ownerGaii, app.filename)) {
        sizes.app_code.count += 1;
        sizes.app_code.bytes += v.size;
      }
    }
  }

  const files = await storage.listStorageFilesForOwners(all);
  for (const list of Object.values(files)) {
    for (const f of list) {
      const part = sizes[fileBelongsToPart(f)];
      part.count += 1;
      part.bytes += f.size;
    }
  }
  return sizes;
}

/** The parts named in a request, or the default; null when a name is not a part. */
export function partsOf(raw: unknown): ExportPartId[] | null {
  if (raw === undefined) return [...DEFAULT_PARTS];
  if (!Array.isArray(raw)) return null;
  const out = new Set<ExportPartId>();
  for (const p of raw) {
    if (typeof p !== 'string' || !(EXPORT_PARTS as readonly string[]).includes(p)) return null;
    out.add(p as ExportPartId);
  }
  return EXPORT_PARTS.filter(p => out.has(p));
}
