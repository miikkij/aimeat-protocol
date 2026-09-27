/**
 * @file batch-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Identical entry guards used by both memory batch routes.
 * @structure batchKeyRefusal; storageReferenceRefusal
 * @version-history 1.0.0 2026-09-27 Extract the shared rules and apply file-reference checks on restore.
 */
import type { Storage } from '../../storage/interface.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../../services/secret-records.js';
import { isAnonymousGaii } from './shared.js';

export function batchKeyRefusal(roles: string[], gaii: string, key: string): string | null {
  if (isServerWrittenKey(key)) return serverWrittenKeyRefusal(key).message;
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
