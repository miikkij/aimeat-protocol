/**
 * @file src/services/knowledge-audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads a knowledge package and each of its entries, in the words services/audience.ts
 *   decides (plan doc-mvcn6c7e4e5q, V3.6).
 *
 *   A package has one audience, `sharing.audience` on its manifest:
 *     owner           the author's account only (the default)
 *     members         any account of this node
 *     organism:<id>   the active members of one organism
 *     public          anyone, and the public catalogue. `sharing.catalog_listed: true` means public,
 *                     as it always has, so a manifest written before this field reads the same.
 *   An entry takes the same two levels in between beside its own private, owner, group and public.
 *
 *   The memory record under the manifest or the entry carries the memory tier nearest to the audience:
 *   'public', 'members', or 'owner' for an organism audience (memory has no organism tier, so the
 *   generic memory reads keep it to the author, and the knowledge routes admit the organism through
 *   audienceAllows). Only a 'public' record reaches the catalogue, which reads public records only.
 * @structure KNOWLEDGE_PACKAGE_LEVELS · KNOWLEDGE_ENTRY_LEVELS · packageAudienceOf · manifestRecordVisibility
 *   · entryRecordVisibility · knowledgeAudienceAllows
 * @usage
 *   if (!(await knowledgeAudienceAllows(storage, packageAudienceOf(manifest), req.auth, ownerName))) → 404
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.6).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseAudience, audienceAllows, type AudienceAuth, type AudienceLevel } from './audience.js';

/** The audiences a package takes, as audience.ts names them; the package spells 'private' as 'owner'. */
export const KNOWLEDGE_PACKAGE_LEVELS: readonly AudienceLevel[] = ['private', 'members', 'organism', 'public'];
/** The two levels an entry takes through audience.ts; its other values keep their memory meaning. */
export const KNOWLEDGE_ENTRY_LEVELS: readonly AudienceLevel[] = ['members', 'organism'];
/** The package's word for a level audience.ts calls 'private'. */
export const KNOWLEDGE_PACKAGE_SPELLING: Record<string, string> = { owner: 'private' };

interface SharingShape { sharing?: { catalog_listed?: unknown; audience?: unknown } }

/** The package's audience: 'public' when listed, else 'members' or 'organism:<id>' when set, else 'owner'. */
export function packageAudienceOf(manifest: unknown): string {
  const sharing = (manifest as SharingShape | null)?.sharing;
  if (sharing?.catalog_listed === true) return 'public';
  const a = parseAudience(sharing?.audience);
  if (a && (a.level === 'members' || a.level === 'organism')) return sharing!.audience as string;
  return 'owner';
}

/** The memory tier the manifest record is stored at. */
export function manifestRecordVisibility(manifest: unknown): MemoryRecord['visibility'] {
  const audience = packageAudienceOf(manifest);
  return audience === 'public' ? 'public' : audience === 'members' ? 'members' : 'owner';
}

/** The memory tier an entry record is stored at: its own value, and 'owner' for an organism audience. */
export function entryRecordVisibility(visibility: string): MemoryRecord['visibility'] {
  return visibility.startsWith('organism:') ? 'owner' : visibility as MemoryRecord['visibility'];
}

/**
 * Does a package or entry audience admit this caller? 'public' admits anyone; 'members' and
 * 'organism:<id>' ask audienceAllows; 'owner' and anything else admit the author's account only.
 */
export async function knowledgeAudienceAllows(
  storage: Storage, audience: string, auth: AudienceAuth | null | undefined, ownerName: string,
): Promise<boolean> {
  const parsed = parseAudience(KNOWLEDGE_PACKAGE_SPELLING[audience] ?? audience);
  if (parsed && parsed.level !== 'private') return audienceAllows(storage, parsed, auth);
  return audienceAllows(storage, { level: 'private' }, auth, { ownerName });
}
