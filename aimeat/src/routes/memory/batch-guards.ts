/**
 * @file batch-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Identical entry guards used by the memory batch routes (bulk, import) and the copy.
 * @structure batchKeyRefusal; storageReferenceRefusal; visibilityRefusal; organismWriteRefusalFor;
 *   routePublishAsk; batchPublishAnswer
 * @version-history
 *   2026-10-18 — routePublishAsk and batchPublishAnswer: POST /v1/memory/bulk, POST /v1/memory/import
 *     and POST /v1/memory/copy ask the publish gate the single write asks (publishAskOf with the
 *     request's callerOf; plan doc-mvcn6c7e4e5q, V4). organismWriteRefusalFor moved here from bulk.ts,
 *     because the copy route moved to copy.ts, and reads the caller from callerOf(req).
 *   2026-10-17 — visibilityRefusal names 'organism:<organism id>' among the words a write takes; the
 *     membership refusal itself is the shared writer's (services/organism-visibility.ts).
 *   2026-10-16 — visibilityRefusal: an entry of the bulk write takes the visibilities the single write takes, read from MemoryWriteSchema (QA audit list review).
 *   1.1.0 2026-10-11 An `agents.` key that carries an identity where the name belongs is refused.
 *   1.0.0 2026-09-27 Extract the shared rules and apply file-reference checks on restore.
 */
import type { Request } from 'express';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { checkOrganismNamespaceAccess } from '../../services/organism-namespace-access.js';
import type { ManifestWrite } from '../../services/fenced-space.js';
import type { BatchPublishRequest } from '../../services/memory-batch-write.js';
import { publishAskOf, type PublishAsk } from '../../services/publish-requests/ask.js';
import { callerOf } from '../../middleware/caller.js';
import { agentKeyRefusal } from '../../utils/agent-key-address.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../../services/secret-records.js';
import { isAnonymousGaii } from './shared.js';
import { MemoryWriteSchema } from '../../models/schemas.js';
import { MEMORY_WRITE_VISIBILITIES } from '../../utils/visibility-words.js';

export function batchKeyRefusal(roles: string[], gaii: string, key: string): string | null {
  if (isServerWrittenKey(key)) return serverWrittenKeyRefusal(key).message;
  const misaddressed = agentKeyRefusal(key);
  if (misaddressed) return misaddressed.message;
  if (!appMayWriteKey(roles, key)) return 'reserved key — managed by the account owner';
  if (isSecretRecordKey(key)) return secretRecordWriteRefusal(key).message;
  if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) return 'anonymous agents can only write anonymous.* keys';
  return null;
}

export async function storageReferenceRefusal(storage: Storage, gaii: string, value: unknown): Promise<string | null> {
  if (!value || typeof value !== 'object' || !('_type' in value) || value._type !== 'storage_ref') return null;
  if (!('storage_key' in value) || typeof value.storage_key !== 'string' || !value.storage_key) {
    return 'storage_ref requires a valid storage_key string';
  }
  if (!(await storage.getStorageFile(gaii, value.storage_key))) return `referenced storage file not found: ${value.storage_key}`;
  return null;
}

/**
 * The visibility of one bulk entry, held to the rule of the single write (POST /v1/memory and
 * aimeat_memory_write both read MemoryWriteSchema): absent means private, and a value the single
 * write refuses is refused here too. `workspace` is one of those: a record a workspace can read is
 * written through the workspace, which records the workspace it belongs to.
 */
export function visibilityRefusal(visibility: unknown): string | null {
  if (MemoryWriteSchema.shape.visibility.safeParse(visibility).success) return null;
  const allowed = [...MEMORY_WRITE_VISIBILITIES, 'organism:<organism id>'].join(', ');
  return `visibility "${String(visibility)}" is not one a memory write takes. Use one of ${allowed}, or leave it out for private. `
    + 'A record a workspace reads is written through the workspace (aimeat_workspace_write).';
}

/**
 * The organism rule (services/organism-namespace-access.ts) for a key a batch route or the copy writes
 * under `principal`, the identity the record lands under, as services/memory-write.ts asks it for
 * POST /v1/memory and the MCP write. Null for a key outside `organism.`.
 *
 * The session's scopes and `write` ride along for the fenced-space rule (services/fenced-space.ts):
 * a session that covers organism:direct writes a record space that names extensions directly, and
 * a write to a workspace's manifest record is compared by value when the caller of this helper
 * hands the value over, and read as the removal of every fence when it does not.
 */
export function organismWriteRefusalFor(ctx: { storage: Storage; config: AimeatConfig }) {
  return (req: Request, principal: string, key: string, write?: ManifestWrite) => {
    // The request's caller object (middleware/caller.ts): its account, roles and scopes.
    const caller = callerOf(req, ctx.config.nodeId, ctx.storage);
    return checkOrganismNamespaceAccess({ storage: ctx.storage, config: ctx.config }, {
      principal, owner: caller.owner, roles: [...caller.roles], scopes: [...caller.scopes],
    }, key, 'write', write);
  };
}

/**
 * The publish gate for a memory route (services/publish-requests/ask.ts publishAskOf, the gate
 * POST /v1/memory asks through services/memory-publish-gate.ts): allowed, refused (nobody on this node
 * to ask), or ask the owner. Asked once per request; whether a given entry RAISES its record to public
 * is decided where the stored level is known.
 */
export function routePublishAsk(ctx: { storage: Storage; config: AimeatConfig }, req: Request): PublishAsk {
  return publishAskOf(ctx, callerOf(req, ctx.config.nodeId, ctx.storage), req.auth?.app);
}

/**
 * What a batch route adds to its answer for the publish gate: the requests per entry (and 202 when any
 * was filed), and a warning per entry whose request could not be filed.
 */
export function batchPublishAnswer(written: { publishRequests: BatchPublishRequest[]; warnings: Array<{ key: string; code: string; message: string }> }): {
  status: 200 | 202; fields: { publish_requests?: BatchPublishRequest[]; warnings?: Array<{ key: string; code: string; message: string }> };
} {
  return {
    status: written.publishRequests.length > 0 ? 202 : 200,
    fields: {
      ...(written.publishRequests.length ? { publish_requests: written.publishRequests } : {}),
      ...(written.warnings.length ? { warnings: written.warnings } : {}),
    },
  };
}
