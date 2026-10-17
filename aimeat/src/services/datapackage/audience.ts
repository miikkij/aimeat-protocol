/**
 * @file src/services/datapackage/audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads a data package (plan doc-mvcn6c7e4e5q, V3.8), in the words
 *   services/audience.ts decides.
 *
 *   A data package was always public. A publish may now name `visibility`:
 *     public           (the default, unchanged) anyone, at the permanent session-free address
 *     members          any account of this node
 *     organism:<id>    the active members of one organism the publisher is in
 *     private          the publisher's account only
 *   The owner reads their own package always.
 *
 *   WHERE IT IS KEPT. On the package's `latest.json` pointer, so the package has one audience and every
 *   version read through the data-package routes, the OData feed, the MCP tools and the extension
 *   capability asks the same value. The files a publish writes carry the storage tier nearest to it
 *   ('public', 'members', or 'private' for an organism or private package, since a file has no organism
 *   tier), so the session-free address `/v1/pub/...` stays public only for a public package. The
 *   catalogue entry beside the bytes takes the same audience (services/knowledge-audience.ts), so a
 *   non-public package is not listed in the public catalogue.
 * @structure DATAPACKAGE_LEVELS · fileVisibilityOf · catalogueAudienceOf · catalogueEntryVisibilityOf
 *   · datapackageReadable · ownerAuthOf
 * @usage
 *   if (!(await datapackageReadable(storage, ownerGhii, pointer?.visibility, req.auth))) return null;
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.8).
 */
import type { Storage, StorageFileRecord, KnowledgeEntryDescriptor } from '../../storage/interface.js';
import { parseAudience, audienceAllows, isNodeAccount, type AudienceAuth, type AudienceLevel } from '../audience.js';
import { localAccountName } from '../../utils/gaii.js';

/** What a data package's `visibility` takes. */
export const DATAPACKAGE_LEVELS: readonly AudienceLevel[] = ['private', 'members', 'organism', 'public'];

/** The storage tier a package file is written at. */
export function fileVisibilityOf(visibility: string): StorageFileRecord['visibility'] {
  return visibility === 'public' ? 'public' : visibility === 'members' ? 'members' : 'private';
}

/** The catalogue manifest's sharing.audience: the package's own, with 'owner' for private. */
export function catalogueAudienceOf(visibility: string): 'owner' | 'members' | 'public' | `organism:${string}` {
  if (visibility === 'public' || visibility === 'members') return visibility;
  return visibility.startsWith('organism:') ? visibility as `organism:${string}` : 'owner';
}

/** A catalogue entry's visibility for this package. */
export function catalogueEntryVisibilityOf(visibility: string): KnowledgeEntryDescriptor['visibility'] {
  return catalogueAudienceOf(visibility);
}

/**
 * May this caller read the package? The owner's account (and its agents and apps) always; else the
 * package's audience, with a pointer written before this field reading as public.
 */
export async function datapackageReadable(
  storage: Storage, ownerGhii: string, visibility: string | undefined, reader: AudienceAuth | null | undefined,
): Promise<boolean> {
  if (isNodeAccount(reader) && reader!.owner === localAccountName(ownerGhii)) return true;
  const audience = parseAudience(visibility ?? 'public');
  if (!audience || audience.level === 'private') return false;
  return audienceAllows(storage, audience, reader);
}

/** The owner as a reader, for a service that reads on the owner's behalf (the extension capability). */
export function ownerAuthOf(ownerGhii: string): AudienceAuth {
  return { sub: ownerGhii, owner: localAccountName(ownerGhii) };
}
