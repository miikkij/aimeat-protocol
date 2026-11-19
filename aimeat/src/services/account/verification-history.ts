/**
 * @file src/services/account/verification-history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's identity verifications as a history, and the record of to whom they gave one.
 *
 *   WHY. The account record holds one verification level and writes each new one over the last, with
 *   no time and no validity, so nothing could say how and when a person was verified on a given day.
 *   Customer due diligence needs exactly that (AMLR art. 22): each verification is kept here as its own
 *   entry (level, method, issuer, time), and a new one never replaces an old one.
 *
 *   DISCLOSURES. When a person gives their verification to an organism (the KYC identify link), the
 *   gift is kept here too, so the person sees whom they gave it to. Withdrawing it later does not
 *   remove the organism's copy, which the law keeps (AMLR art. 77); the page says so.
 *
 *   Both live in the account's service namespace (services/service-records.ts): no memory route
 *   reaches them, and only this module writes them; the account's export carries them.
 * @structure VerificationEntry · Disclosure · recordVerification · readVerificationHistory · recordDisclosure ·
 *   readDisclosures · eidasLevelOf
 * @version-history
 *   v1.1.0 — 2026-11-19 — The records live in the account's service namespace (serviceRecords), not under
 *     reserved prefixes of the account's own memory.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, platform part P3).
 */
import type { Storage } from '../../storage/interface.js';
import { serviceRecords } from '../service-records.js';

const MAX = 200;
const KEY = 'list';

export type VerificationMethod = 'ftn' | 'eudiw' | 'operator' | 'email';

export interface VerificationEntry {
  at: string;
  /** The account's level after it (0 none, 1 email, 2 operator-confirmed, 3 strong electronic identification). */
  level: 0 | 1 | 2 | 3;
  method: VerificationMethod;
  issuer?: string;
  /** The claim names the credential carried (never their values). */
  attributes?: string[];
  /** sha256 of the credential or of the personal identity code, to tell two verifications apart without keeping either. */
  credentialHash?: string;
  /** Who recorded it: the person's own flow, or the operator who confirmed them. */
  by?: string;
}

export interface Disclosure { at: string; organism: string; organismName: string; card: string; what: string[] }

interface List<T> { entries: T[] }
const parseList = <T>(v: unknown): List<T> => (v && typeof v === 'object' && Array.isArray((v as List<T>).entries) ? (v as List<T>) : { entries: [] });

/** The account's service namespace (services/service-records.ts): no memory route reaches these records. */
const history = (storage: Storage) => serviceRecords<List<VerificationEntry>>(storage, 'identity-verifications.', { parse: parseList<VerificationEntry> });
const disclosures = (storage: Storage) => serviceRecords<List<Disclosure>>(storage, 'identity-disclosures.', { parse: parseList<Disclosure> });

/**
 * The eIDAS level of assurance a verification gives: FTN bank ID is "substantial" (Traficom's
 * register says substantial or high per provider; substantial is the floor), the EU wallet "high", an
 * operator's confirmation or an e-mail "low". The account's numeric level 3 means strong electronic
 * identification, either of the first two.
 */
export function eidasLevelOf(method: VerificationMethod): 'low' | 'substantial' | 'high' {
  return method === 'eudiw' ? 'high' : method === 'ftn' ? 'substantial' : 'low';
}

export async function recordVerification(storage: Storage, ghii: string, entry: Omit<VerificationEntry, 'at'> & { at?: string }): Promise<void> {
  const e: VerificationEntry = { ...entry, at: entry.at ?? new Date().toISOString() };
  const cur = (await history(storage).get(ghii, KEY)) ?? { entries: [] };
  await history(storage).put(ghii, KEY, { entries: [...cur.entries, e].slice(-MAX) });
}

export async function readVerificationHistory(storage: Storage, ghii: string): Promise<VerificationEntry[]> {
  return ((await history(storage).get(ghii, KEY)) ?? { entries: [] }).entries;
}

/** The newest strong verification (FTN or EU wallet), or null. */
export async function latestStrongVerification(storage: Storage, ghii: string): Promise<VerificationEntry | null> {
  const list = await readVerificationHistory(storage, ghii);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].method === 'ftn' || list[i].method === 'eudiw') return list[i];
  return null;
}

export async function recordDisclosure(storage: Storage, ghii: string, d: Disclosure): Promise<void> {
  const cur = (await disclosures(storage).get(ghii, KEY)) ?? { entries: [] };
  await disclosures(storage).put(ghii, KEY, { entries: [...cur.entries, d].slice(-MAX) });
}

export async function readDisclosures(storage: Storage, ghii: string): Promise<Disclosure[]> {
  return ((await disclosures(storage).get(ghii, KEY)) ?? { entries: [] }).entries;
}
