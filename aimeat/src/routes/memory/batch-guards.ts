/**
 * @file batch-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Identical entry guards used by both memory batch routes.
 * @structure batchKeyRefusal; storageReferenceRefusal; visibilityRefusal
 * @version-history
 *   2026-10-16 — visibilityRefusal: an entry of the bulk write takes the visibilities the single write takes, read from MemoryWriteSchema (QA audit list review).
 *   1.1.0 2026-10-11 An `agents.` key that carries an identity where the name belongs is refused.
 *   1.0.0 2026-09-27 Extract the shared rules and apply file-reference checks on restore.
 */
import type { Storage } from '../../storage/interface.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { agentKeyRefusal } from '../../utils/agent-key-address.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../../services/secret-records.js';
import { isAnonymousGaii } from './shared.js';
import { MemoryWriteSchema } from '../../models/schemas.js';

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
  const allowed = MemoryWriteSchema.shape.visibility.unwrap().options.join(', ');
  return `visibility "${String(visibility)}" is not one a memory write takes. Use one of ${allowed}, or leave it out for private. `
    + 'A record a workspace reads is written through the workspace (aimeat_workspace_write).';
}
