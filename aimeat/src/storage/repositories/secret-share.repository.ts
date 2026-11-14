/**
 * @file src/storage/repositories/secret-share.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for secret shares and requests, their events,
 *   their named people and the browsers' end-to-end device keys (types/secret-shares.ts). Tables
 *   "SecretShare", "SecretShareEvent", "SecretShareMember" and "VaultDeviceKey" (PostgreSQL migration
 *   0130) and secret_shares, secret_share_events, secret_share_members and vault_device_keys (SQLite).
 * @structure SecretShareRepository: createSecretShare · getSecretShare · listSecretSharesByOwner ·
 *   listSecretSharesByOrganisms · listSecretSharesForMember · listSecretShareMembers ·
 *   depositSecretShare · claimSecretSharePickup · closeSecretShare · endExpiredSecretShares ·
 *   addSecretShareEvent · listSecretShareEvents · deleteSecretSharesByOwner · putVaultDeviceKey ·
 *   listVaultDeviceKeys · deleteVaultDeviceKey · deleteVaultDeviceKeysByOwner
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
export type { SecretShareRepository } from '../types/secret-shares.js';
