/**
 * @file src/services/secret-shares/device-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public keys of a person's browsers, for end-to-end secret shares. The browser makes
 *   a P-256 key pair, keeps the private key in its own storage where script cannot export it, and
 *   registers the public key here. A maker's browser encrypts a share's content key for each of the
 *   recipient's registered keys; the node stores what it cannot open.
 *
 *   ONLY THE PERSON, IN PERSON, REGISTERS OR REMOVES A KEY. An agent that could add a key to its
 *   owner's account could then receive every end-to-end share made to its owner afterwards.
 *   Anyone signed in may read a person's public keys: they are public by design.
 * @structure MAX_DEVICE_KEYS · registerDeviceKey · listOwnDeviceKeys · removeDeviceKey · deviceKeysOf
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { createHash, createPublicKey } from 'node:crypto';
import type { VaultDeviceKey } from '../../storage/types/secret-shares.js';
import type { CallerContext } from '../caller-context.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { refuse } from './rules.js';
import type { ShareDeps, ShareResult } from './rules.js';

export const MAX_DEVICE_KEYS = 20;
const B64URL = /^[A-Za-z0-9_-]{40,48}$/;

export interface DeviceKeyView { key_id: string; label: string; public_key: string; created_at: string; last_used_at: string | null }
const view = (k: VaultDeviceKey): DeviceKeyView => ({ key_id: k.keyId, label: k.label, public_key: k.publicKey, created_at: k.createdAt, last_used_at: k.lastUsedAt });

const inPersonOnly = () => refuse(403, 'IN_PERSON_ONLY', 'Only the account holder, signed in on the device itself, registers or removes a device key. An agent cannot.');

export async function registerDeviceKey(deps: ShareDeps, caller: CallerContext, body: Record<string, unknown>): Promise<ShareResult<DeviceKeyView>> {
  if (!caller.isPerson) return inPersonOnly();
  const jwk = (body.public_key && typeof body.public_key === 'object' ? body.public_key : null) as Record<string, unknown> | null;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string'
    || !B64URL.test(jwk.x) || !B64URL.test(jwk.y) || 'd' in jwk) {
    return refuse(400, 'INVALID_PUBLIC_KEY', 'public_key is a P-256 public key as a JWK ({ kty: "EC", crv: "P-256", x, y }), with no private part.');
  }
  const publicKey = JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
  // A point that is not on the curve would be accepted here and fail in every maker's browser.
  try {
    createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch (err) {
    logger.info('vault device key: a public key that is not a P-256 point was refused', { owner: caller.ownerGhii, error: String(err) });
    return refuse(400, 'INVALID_PUBLIC_KEY', 'public_key is not a point on the P-256 curve.');
  }
  const keyId = createHash('sha256').update(publicKey).digest('base64url').slice(0, 16);
  const existing = await deps.storage.listVaultDeviceKeys(caller.ownerGhii);
  if (!existing.some(k => k.keyId === keyId) && existing.length >= MAX_DEVICE_KEYS) {
    return refuse(409, 'TOO_MANY_DEVICE_KEYS', `An account keeps at most ${MAX_DEVICE_KEYS} device keys. Remove one you no longer use.`);
  }
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Browser';
  const rec: VaultDeviceKey = { ownerGhii: caller.ownerGhii, keyId, publicKey, label, createdAt: new Date().toISOString(), lastUsedAt: null };
  await deps.storage.putVaultDeviceKey(rec);
  emitChange('secret-shares', caller.ownerGhii);
  return { ok: true, data: view(rec) };
}

export async function listOwnDeviceKeys(deps: ShareDeps, caller: CallerContext): Promise<ShareResult<DeviceKeyView[]>> {
  return { ok: true, data: (await deps.storage.listVaultDeviceKeys(caller.ownerGhii)).map(view) };
}

export async function removeDeviceKey(deps: ShareDeps, caller: CallerContext, keyId: string): Promise<ShareResult<{ key_id: string; removed: true }>> {
  if (!caller.isPerson) return inPersonOnly();
  if (!(await deps.storage.deleteVaultDeviceKey(caller.ownerGhii, keyId))) return refuse(404, 'NOT_FOUND', 'No device key with that id on your account.');
  emitChange('secret-shares', caller.ownerGhii);
  return { ok: true, data: { key_id: keyId, removed: true } };
}

/** A person's public keys, for a maker's browser to encrypt to. `who` is an account name or GHII on this node. */
export async function deviceKeysOf(deps: ShareDeps, who: string): Promise<ShareResult<{ ghii: string; keys: DeviceKeyView[] }>> {
  const ghii = who.includes('@') ? who.toLowerCase() : `${who.toLowerCase()}@${deps.config.nodeId}`;
  const keys = await deps.storage.listVaultDeviceKeys(ghii);
  return { ok: true, data: { ghii, keys: keys.map(k => ({ ...view(k), label: '' })) } };
}
