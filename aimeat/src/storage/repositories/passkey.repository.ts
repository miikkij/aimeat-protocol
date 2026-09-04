/**
 * @file src/storage/repositories/passkey.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for passkeys (types/passkeys.ts).
 * @structure PasskeyRepository: createPasskey · getPasskey · listPasskeysByOwner · touchPasskey ·
 *   renamePasskey · deletePasskey
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
export type { PasskeyRepository } from '../types/passkeys.js';
