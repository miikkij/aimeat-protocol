/**
 * @file src/services/adult-assurance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an account holder is a verified adult: yes or no, by which method, and when.
 *   Nothing else is kept or told: never the date of birth, never a name or an identity number.
 *
 *   An app shows adult content only to a verified adult (Comicland v3 A-3, IKÄ-03), and the answer
 *   belongs to the account, so every app and extension asks the same record (IKÄ-05). Three methods
 *   write it: an EUDI wallet presentation and a bank identification (the age is computed from the
 *   attested birth date in the request that carried it, and the date is dropped), and a payment with
 *   a CREDIT card (Jouni's ruling, A-4: a debit or prepaid card does not count, because minors can
 *   hold those). Only a positive answer is written: somebody found to be under 18 is simply not a
 *   verified adult, which is what an app needs, and no record says that they are a minor.
 *
 *   The record is `identity.adult.status` in the account's own namespace, a service-owned key
 *   (utils/reserved-keys.ts): no memory route writes, restores or deletes it, for the account holder
 *   in person either, so nothing but this file can say somebody is an adult.
 * @structure ADULT_KEY · AdultMethod · AdultStatus · isAdultByClaims · birthdateFromHetu ·
 *   recordAdult · readAdult · NOT_VERIFIED
 * @usage
 *   if (isAdultByClaims(claims)) await recordAdult(storage, ghii, 'ftn');
 *   const { verified, method, at } = await readAdult(storage, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-3, A-4).
 */
import type { Storage } from '../storage/interface.js';

/** The record, in the account holder's own namespace. */
export const ADULT_KEY = 'identity.adult.status';

/** How adulthood was shown. */
export type AdultMethod = 'eudiw' | 'ftn' | 'credit-card';

/** What anyone is told. */
export interface AdultStatus {
  verified: boolean;
  /** The latest method that showed it; null when not verified. */
  method: AdultMethod | null;
  /** When that method showed it, ISO 8601; null when not verified. */
  at: string | null;
}

export const NOT_VERIFIED: AdultStatus = Object.freeze({ verified: false, method: null, at: null });

interface StoredAdult {
  adult: true;
  method: AdultMethod;
  verifiedAt: string;
  /** The last time each method showed it, so a later card payment does not hide the wallet check. */
  methods: Partial<Record<AdultMethod, string>>;
}

/** Age in whole years on `now` for a birth date `YYYY-MM-DD`; null when it does not parse. */
function ageOn(birthdate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * The birth date a Finnish personal identity code carries (DDMMYY, the century sign, the individual
 * number and the check character), as `YYYY-MM-DD`; null when the value is not one. Bank
 * identification always carries the code, and not every broker passes `birthdate` beside it.
 */
export function birthdateFromHetu(pid: unknown): string | null {
  if (typeof pid !== 'string') return null;
  const m = /^(\d{2})(\d{2})(\d{2})([-+A-FU-Y])\d{3}[0-9A-Y]$/i.exec(pid.trim());
  if (!m) return null;
  const sign = m[4].toUpperCase();
  const century = sign === '+' ? 1800 : /[A-F]/.test(sign) ? 2000 : 1900;
  return `${century + Number(m[3])}-${m[2]}-${m[1]}`;
}

/**
 * Whether attested claims show an adult: `age_over_18` when the issuer said it (an EUDI PID can carry
 * it without the date), else the age from `birthdate`, else from a Finnish identity code. False when
 * none of them says, which records nothing.
 */
export function isAdultByClaims(claims: Record<string, unknown> | undefined, now = new Date()): boolean {
  if (!claims) return false;
  if (typeof claims.age_over_18 === 'boolean') return claims.age_over_18;
  const birthdate = typeof claims.birthdate === 'string' ? claims.birthdate : birthdateFromHetu(claims.hetu ?? claims.pid);
  if (!birthdate) return false;
  const age = ageOn(birthdate, now);
  return age !== null && age >= 18;
}

/** Record that the account holder showed they are an adult, by `method`, now. */
export async function recordAdult(storage: Storage, ownerGhii: string, method: AdultMethod): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGhii, ADULT_KEY);
  const before = existing?.value as Partial<StoredAdult> | undefined;
  const value: StoredAdult = { adult: true, method, verifiedAt: now, methods: { ...(before?.methods ?? {}), [method]: now } };
  await storage.setMemory({
    key: ADULT_KEY,
    ownerGaii: ownerGhii,
    value,
    visibility: 'private',
    tags: [],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });
}

/** What an app or an extension is told about the account holder `ownerGhii`. */
export async function readAdult(storage: Storage, ownerGhii: string): Promise<AdultStatus> {
  const stored = (await storage.getMemory(ownerGhii, ADULT_KEY))?.value as Partial<StoredAdult> | undefined;
  if (stored?.adult !== true || typeof stored.method !== 'string' || typeof stored.verifiedAt !== 'string') return NOT_VERIFIED;
  return { verified: true, method: stored.method, at: stored.verifiedAt };
}
