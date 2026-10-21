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
 *   The owner in person reads their own package always. The owner's agent, app grant or ecosystem
 *   app reads a private one only with storage:read (readsAsPackageOwner), and the other levels as any
 *   reader they admit.
 *
 *   A VERSION KEEPS ITS OWN AUDIENCE. The pointer's audience covers the version it names; an earlier
 *   version answers on the audience recorded on its descriptor file (versionOpenTo), so approving one
 *   version public opens no earlier private one.
 *
 *   WHERE IT IS KEPT. On the package's `latest.json` pointer, so the package has one audience and every
 *   version read through the data-package routes, the OData feed, the MCP tools and the extension
 *   capability asks the same value. The files a publish writes carry the storage tier nearest to it
 *   ('public', 'members', or 'private' for an organism or private package, since a file has no organism
 *   tier), so the session-free address `/v1/pub/...` stays public only for a public package. The
 *   catalogue entry beside the bytes takes the same audience (services/knowledge-audience.ts), so a
 *   non-public package is not listed in the public catalogue.
 * @structure DATAPACKAGE_LEVELS · fileVisibilityOf · catalogueAudienceOf · catalogueEntryVisibilityOf
 *   · DatapackageReader · readsAsPackageOwner · lacksPackageReadScope · datapackageReadable
 *   · withAudienceTag · recordedAudienceOf · versionOpenTo · ownerAuthOf
 * @usage
 *   if (!(await datapackageReadable(storage, ownerGhii, pointer?.visibility, req.auth))) return null;
 * @version-history
 *   v1.2.0 — 2026-10-21 — No use that worked before is lost (capability-loss review of v41 and v42): a
 *     principal of the owner without storage:read reads on the package's audience like any reader, so
 *     only a PRIVATE package asks the word; an earlier version answers on its own audience, recorded
 *     as a tag on its descriptor file (withAudienceTag), and a version written before that keeps the
 *     tier rule with a members tier admitting an account of the node.
 *   v1.1.0 — 2026-10-20 — The owner name is not a permission: a principal of the owner other than the
 *     owner in person reads a non-public package only with storage:read (readsAsPackageOwner; secaudit
 *     2026-10 v41, standing ruling 5). A reader that does not read as the owner opens an earlier
 *     version only at the tier its files were stored at (versionOpenTo; secaudit 2026-10 v42).
 *     ownerAuthOf names the owner in person.
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.8).
 */
import type { Storage, StorageFileRecord, KnowledgeEntryDescriptor } from '../../storage/interface.js';
import { parseAudience, audienceAllows, isNodeAccount, type AudienceAuth, type AudienceLevel } from '../audience.js';
import { localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';

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
 * A reader of a package: the audience facts, plus the token's roles and scopes. A route passes
 * req.auth, an MCP tool its session caller's `auth`, the extension capability ownerAuthOf(). A reader
 * without roles is not the owner in person, and one without scopes holds no permission word.
 */
export interface DatapackageReader extends AudienceAuth {
  roles?: readonly string[];
  scopes?: readonly string[];
}

/** The permission word a principal of the owner, other than the owner in person, reads a private package with. */
export const DATAPACKAGE_READ_SCOPE = 'storage:read';

/** A principal acting in the package owner's account: the owner in person, or the owner's agent, app grant or ecosystem app. */
function actsForOwner(ownerGhii: string, reader: DatapackageReader | null | undefined): boolean {
  return isNodeAccount(reader) && reader!.owner === localAccountName(ownerGhii);
}

/**
 * Does this reader read the package as its owner: every version, private ones included? The owner in
 * person always. Another principal of the same owner (agent, app grant, ecosystem app) only with
 * storage:read, the word GET /v1/datapackages and /v1/pub ask for the same bytes (standing ruling
 * 2026-10-20: a data package is a publish and share primitive, not private memory).
 */
export function readsAsPackageOwner(ownerGhii: string, reader: DatapackageReader | null | undefined): boolean {
  if (!actsForOwner(ownerGhii, reader)) return false;
  return isOwnerInPerson(reader) || scopeIsCovered(reader!.scopes ?? [], DATAPACKAGE_READ_SCOPE);
}

/**
 * A principal of the owner that lacks storage:read. A route asks this after a refused read, so the
 * refusal names the missing word (403 SCOPE_DENIED) instead of reading as a missing package.
 */
export function lacksPackageReadScope(ownerGhii: string, reader: DatapackageReader | null | undefined): boolean {
  return actsForOwner(ownerGhii, reader) && !readsAsPackageOwner(ownerGhii, reader);
}

/**
 * May this caller read the package? The owner in person always, and another principal of the owner
 * with storage:read (readsAsPackageOwner). Everyone else, the owner's own principals without that
 * word included, reads on the package's audience: public, members and organism:<id> admit whom they
 * admit, and a private package admits nobody else. So storage:read is the word for the owner's
 * PRIVATE packages only; on a closed node, where every package is stored at members, an agent of the
 * owner keeps reading them as any account of the node does. A pointer written before this field
 * reads as public.
 */
export async function datapackageReadable(
  storage: Storage, ownerGhii: string, visibility: string | undefined, reader: DatapackageReader | null | undefined,
): Promise<boolean> {
  if (readsAsPackageOwner(ownerGhii, reader)) return true;
  const audience = parseAudience(visibility ?? 'public');
  if (!audience || audience.level === 'private') return false;
  return audienceAllows(storage, audience, reader);
}

/**
 * THE AUDIENCE OF ONE VERSION, recorded as a tag on its descriptor file. Not inside the descriptor's
 * bytes: those bytes are the version's permanent identity and the hash its provenance record carries,
 * and an audience changes after the write (setVersionAudience, an approved publish request) where the
 * bytes may not. A tag is file metadata and is rewritten with the audience.
 */
const AUDIENCE_TAG = 'datapackage-audience:';

/** The descriptor file's tags with this version's audience recorded, any earlier one replaced. */
export function withAudienceTag(tags: readonly string[] | undefined, visibility: string): string[] {
  return [...(tags ?? []).filter(t => !t.startsWith(AUDIENCE_TAG)), `${AUDIENCE_TAG}${visibility}`];
}

/** The audience recorded on a version's descriptor file, or undefined for a version written before 2026-10-21. */
export function recordedAudienceOf(tags: readonly string[] | undefined): string | undefined {
  const found = (tags ?? []).find(t => t.startsWith(AUDIENCE_TAG));
  return found ? found.slice(AUDIENCE_TAG.length) : undefined;
}

/** How wide a storage tier is, for comparing a version's files with the pointer's tier. */
function tierRank(visibility: string | undefined): number {
  return visibility === 'public' ? 2 : visibility === 'members' ? 1 : 0;
}

/**
 * May a reader who is not reading as the owner open this stored version? The caller has already let
 * the reader through the package's audience (the pointer's). The pointer's audience covers the version
 * it names. An earlier version answers on its OWN audience, recorded on its descriptor file, so an
 * approval that made one version public opens no other, and a member of an organism keeps the earlier
 * organism versions after the newest goes public. A version written before the audience was recorded
 * answers on the tier its files were stored at: refused when narrower than the pointer's tier, except
 * that a members tier admits an account of the node.
 */
export async function versionOpenTo(
  storage: Storage, ownerGhii: string, reader: DatapackageReader | null | undefined,
  pointer: { contentHash?: string; visibility?: string } | undefined, contentHash: string,
  versionFile: { visibility?: string; tags?: readonly string[] },
): Promise<boolean> {
  if (readsAsPackageOwner(ownerGhii, reader)) return true;
  const bareHash = (h: string) => h.replace(/^sha256:/, '');
  if (pointer?.contentHash && bareHash(pointer.contentHash) === bareHash(contentHash)) return true;
  const recorded = recordedAudienceOf(versionFile.tags);
  if (recorded !== undefined) {
    const audience = parseAudience(recorded);
    if (!audience || audience.level === 'private') return false;
    return audienceAllows(storage, audience, reader);
  }
  if (tierRank(versionFile.visibility) >= tierRank(fileVisibilityOf(pointer?.visibility ?? 'public'))) return true;
  return versionFile.visibility === 'members' && isNodeAccount(reader);
}

/**
 * The owner as a reader, for a service that reads on the owner's behalf (the extension capability):
 * an unattended run acts as the owner, so it reads as the owner in person does.
 */
export function ownerAuthOf(ownerGhii: string): DatapackageReader {
  return { sub: ownerGhii, owner: localAccountName(ownerGhii), roles: ['owner'], scopes: [] };
}
