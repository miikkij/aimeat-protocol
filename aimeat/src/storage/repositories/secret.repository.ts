/**
 * @file src/storage/repositories/secret.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for the owner's secrets vault (types/secrets.ts).
 * @structure SecretRepository: listSecrets · getSecret · setSecret · createSecretIfAbsent ·
 *   bindSecretHost · deleteSecret · noteSecretUse · deleteSecretsByOwner
 * @version-history
 *   v1.1.0 — 2026-10-09 — createSecretIfAbsent and the binding record (types/secrets.ts).
 *   v1.0.0 — 2026-09-06 — Initial.
 */
export type { SecretRepository } from '../types/secrets.js';
