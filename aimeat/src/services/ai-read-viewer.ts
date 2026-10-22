/**
 * @file src/services/ai-read-viewer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a model reads the owner scope FOR, and what that principal may hand it: the
 *   viewer the one AI input loader (services/ai-inputs.ts) holds a same-owner record or file to.
 *
 *   WHY. A key without a namespace is read across the owner scope, the owner and every agent and
 *   ecosystem app of theirs, which is the owner's own reach. An agent reading its owner's or a
 *   sibling's private record that way rides the human's ownership, which every other owner-scope
 *   read on this node refuses without memory:read-as-owner (services/owner-scope-read.ts): the memory
 *   route, the MCP memory tools, the librarian, discovery and the workflow ai step. An AI job did not,
 *   so an agent with ai:use got the record back in the model's answer (secaudit 2026-10, r49), and an
 *   extension's ctx.ai.start did the same past the owner's 'installer' setting (v75).
 *
 *   WHO READS EVERYTHING. The owner in person, an app grant of the owner, and a principal holding
 *   memory:read-as-owner, exactly as readsAsOwner decides for the memory route. Everyone else reads
 *   their own records and files, the records whose visibility admits a same-owner reader, and the
 *   files authorizeRead admits them to (the guard GET /v1/pub and ctx.files ask).
 * @structure AiReadViewer · AiInputHiddenError · aiReadViewerOf(who, note?) · hiddenRecordError(key, viewer) ·
 *   aiFileRefusal(storage, config, viewer, file)
 * @usage
 *   const viewer = aiReadViewerOf(job.started_by);
 *   const refusal = await aiFileRefusal(storage, config, viewer, meta);
 * @version-history
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10, r49, v75).
 */
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { READ_AS_OWNER_NOTE, READ_AS_OWNER_SCOPE } from './owner-scope-read.js';
import { authorizeRead } from './access-guard.js';

/**
 * Who a model reads the owner scope for. `readsAll`: the owner in person, an app grant of the owner,
 * or a principal holding memory:read-as-owner. Everyone else reads their own records and what
 * visibility admits a same-owner reader (`owner`, `members`, `public`).
 */
export interface AiReadViewer {
  principal: string;
  /** The bare account name the principal acts for. */
  owner: string;
  readsAll: boolean;
  /** A session from another node. */
  federated?: boolean;
  /** Said after READ_AS_OWNER_NOTE in a refusal, when the reach was narrowed by something the owner can change. */
  note?: string;
}

/** A named input the viewer may not read. `code` and `status` are what an endpoint answers with. */
export class AiInputHiddenError extends Error {
  readonly code = 'SCOPE_DENIED';
  readonly status = 403;
}

/**
 * The viewer for a principal's credential facts (an AI job's starter, or the principal an extension's
 * code reads as). Undefined in, undefined out: no viewer reads as before.
 */
export function aiReadViewerOf(
  who: { principal: string; owner: string; roles: readonly string[]; scopes: readonly string[]; federated?: boolean } | undefined,
  note?: string,
): AiReadViewer | undefined {
  if (!who) return undefined;
  const readsAll = isOwnerInPerson(who) || who.roles.includes('app') || scopeIsCovered(who.scopes, READ_AS_OWNER_SCOPE);
  return {
    principal: who.principal, owner: who.owner, readsAll,
    ...(who.federated ? { federated: true } : {}),
    ...(note ? { note } : {}),
  };
}

/** The refusal for a record of the owner scope the viewer may not see. */
export function hiddenRecordError(key: string, viewer: AiReadViewer): AiInputHiddenError {
  return new AiInputHiddenError(`"${key}" is a record the owner or another of their agents keeps private, and ${viewer.principal} may not read it. `
    + READ_AS_OWNER_NOTE + (viewer.note ? ` ${viewer.note}` : ''));
}

/**
 * Why `viewer` may not hand this file to a model, or null when it may. No viewer, a viewer that reads
 * as the owner, and a file in the viewer's own storage pass; any other file is asked of authorizeRead
 * as the viewer, so a private file of the owner stays out. Takes the metadata (no bytes are read).
 */
export async function aiFileRefusal(
  storage: Storage,
  config: AimeatConfig,
  viewer: AiReadViewer | undefined,
  file: Pick<StorageFileRecord, 'key' | 'ownerGaii' | 'visibility' | 'groupId' | 'workspaceRef'>,
): Promise<string | null> {
  if (!viewer || viewer.readsAll || file.ownerGaii === viewer.principal) return null;
  const decision = await authorizeRead(storage, config, {
    ownerGaii: file.ownerGaii, accessorGaii: viewer.principal, resourceKey: `storage:${file.key}`,
    visibility: file.visibility, groupId: file.groupId, workspaceRef: file.workspaceRef,
    accessorSub: viewer.principal, accessorOwner: viewer.owner, action: 'read',
    ...(viewer.federated ? { accessorFederated: true } : {}),
  });
  if (decision.allowed) return null;
  return `The file "${file.key}" is one the owner keeps private, and ${viewer.principal} may not read it. `
    + READ_AS_OWNER_NOTE + (viewer.note ? ` ${viewer.note}` : '');
}
