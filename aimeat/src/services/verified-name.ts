/**
 * @file src/services/verified-name.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The name an identity verification proved for an account holder: the given and family
 *   names an EU Digital Identity Wallet presentation (routes/verification.ts, EUDIW) or a bank
 *   identification (FTN) carried, kept when the verification succeeds.
 *
 *   WHY. A wallet signature is sealed as account X only when the signing certificate's holder is the
 *   person behind X. The seal compared the certificate's name with the display name, which the
 *   account holder edits freely, so it vouched for a binding the node never established
 *   (secaudit2026oct22, docsign/eudi.ts:wallet-signer-bound-by-editable-display-name; developer
 *   decision 2026-10-25). The verified name is what the seal compares with now; an account without
 *   one still seals on its display name, and the sealed statement says the name was not verified.
 *
 *   THE RECORD. `identity.verified-name.current` under the account's GHII, private. `identity.verified-name.`
 *   is a service-owned prefix (utils/reserved-keys.ts): no memory route writes it, so neither the
 *   account holder nor an agent can change what the verification proved. Only the verification
 *   routes write it, straight to storage. It holds the name, the method and the time, nothing else
 *   (no birth date, no identity code).
 * @structure VERIFIED_NAME_KEY · VerifiedName · verifiedNameOfClaims · recordVerifiedName · readVerifiedName
 * @usage
 *   const name = verifiedNameOfClaims(claims); if (name) await recordVerifiedName(storage, ghii, name, 'ftn');
 *   const verified = await readVerifiedName(storage, signerGhii);
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 3924).
 */
import type { Storage } from '../storage/interface.js';

export const VERIFIED_NAME_KEY = 'identity.verified-name.current';

export interface VerifiedName {
  /** "Given Family", as the credential carried it. */
  name: string;
  method: 'eudiw' | 'ftn';
  verifiedAt: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The name a verification's claims carry, or null when they carry no given or family name. */
export function verifiedNameOfClaims(claims: Record<string, unknown> | undefined | null): string | null {
  if (!claims) return null;
  const name = [text(claims.given_name), text(claims.family_name)].filter(Boolean).join(' ').slice(0, 200);
  return name || null;
}

/** Keep the name a verification proved. Writes straight to storage: the prefix is service-owned. */
export async function recordVerifiedName(storage: Storage, ownerGhii: string, name: string, method: VerifiedName['method']): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGhii, VERIFIED_NAME_KEY);
  const value: VerifiedName = { name, method, verifiedAt: now };
  await storage.setMemory({
    key: VERIFIED_NAME_KEY, ownerGaii: ownerGhii, value, visibility: 'private', tags: [], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing ? existing.createdAt : now, updatedAt: now,
  });
}

/** The verified name of `ownerGhii`, or null when no verification recorded one. */
export async function readVerifiedName(storage: Pick<Storage, 'getMemory'>, ownerGhii: string): Promise<VerifiedName | null> {
  const v = (await storage.getMemory(ownerGhii, VERIFIED_NAME_KEY))?.value as Partial<VerifiedName> | undefined;
  return v && typeof v.name === 'string' && v.name && (v.method === 'eudiw' || v.method === 'ftn') && typeof v.verifiedAt === 'string'
    ? { name: v.name, method: v.method, verifiedAt: v.verifiedAt } : null;
}
