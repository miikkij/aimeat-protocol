/**
 * @file credential.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sealing and opening an outbound connection's credential (TARGET-057). The one place
 *   a token is turned into ciphertext and back, so there is exactly one place to audit.
 *
 *   The whole credential is sealed as a single JSON document rather than field by field. That keeps
 *   the three shapes (oauth2 / static / session) storable in one column, and it means a future
 *   provider that needs an extra field does not need a migration to hold it.
 *
 *   NOTHING HERE LOGS. A decrypt failure returns null with a caller-facing reason; it never prints
 *   the ciphertext, the key state or the provider's response. A secret that reaches a log has left
 *   the node as surely as one that reaches an API response.
 * @structure sealCredential · openCredential · requireEncryptionKey
 * @usage import { sealCredential, openCredential } from './credential.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1c.
 */

import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { logger } from '../../utils/logger.js';
import type { AimeatConfig } from '../../config.js';
import type { ConnectionCredential } from '../../models/connection-schemas.js';

/**
 * The node's master key, or null when none is configured.
 *
 * Callers must refuse the whole operation on null rather than continue. There is no degraded mode
 * here: storing a token in the clear because a key was missing is worse than not storing it, and
 * extension secrets already take this same path.
 */
export function requireEncryptionKey(config: AimeatConfig): Buffer | null {
  return getEncryptionKey(config);
}

/** Seal a credential for storage. Returns `iv:tag:ct`. */
export function sealCredential(credential: ConnectionCredential, key: Buffer): string {
  return encrypt(JSON.stringify(credential), key);
}

/**
 * Open a stored credential. Returns null when the ciphertext cannot be read — a rotated key, a
 * truncated column, a row restored from a backup taken under a different key.
 *
 * Null is a legitimate outcome the caller must handle by parking the connection in `needs_reauth`,
 * because the honest statement to the owner is "reconnect this account", not a 500. Throwing here
 * would surface as an unhandled error in whatever background job happened to touch it first.
 */
export function openCredential(ciphertext: string, key: Buffer): ConnectionCredential | null {
  try {
    const parsed = JSON.parse(decrypt(ciphertext, key)) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const c = parsed as Partial<ConnectionCredential>;
    if (typeof c.accessToken !== 'string' || typeof c.shape !== 'string') return null;
    return {
      shape: c.shape,
      accessToken: c.accessToken,
      ...(typeof c.refreshToken === 'string' ? { refreshToken: c.refreshToken } : {}),
      ...(c.extra && typeof c.extra === 'object' ? { extra: c.extra as Record<string, string> } : {}),
    };
  } catch {
    // The FACT is logged; the exception is not. A failed decrypt's message can carry fragments of
    // the ciphertext, so passing it to the logger would put key material in the log to satisfy a
    // rule about visibility. An operator needs to know this happened, not what the bytes were —
    // and the caller adds which connection it was when it parks the row in needs_reauth.
    logger.warn('connections: a stored credential could not be opened (rotated key, or a backup restored under another key)');
    return null;
  }
}
