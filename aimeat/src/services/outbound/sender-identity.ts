/**
 * @file src/services/outbound/sender-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who the sender of a campaign is, in the words the footer of a marketing email needs:
 *   the legal name, the business id, the postal address, why the reader gets the message, and where
 *   the privacy notice is.
 *
 *   WHY IT IS A RECORD. The Finnish Information Society Code and the ePrivacy rules behind it want a
 *   marketing message's sender identifiable, and consumer protection wants the trader's name and
 *   address findable. That text belongs to the business, changes when the business moves, and is
 *   different for every owner, so it is data the owner keeps in memory rather than code:
 *
 *     outbound.sender                  the owner's own sending
 *     outbound.sender.<company id>     a registered company's sending, in the memory of the
 *                                      company's owner (the book, services/outbound/company-sender-access.ts)
 *
 *   { legal_name, business_id?, address?, privacy_url?, reason?: { fi?, en?, es? }, transactional? }
 *
 *   A COMPANY SEND USES THE COMPANY'S IDENTITY, NEVER THE PERSON'S. company-sender-access.ts already
 *   moves the recipient book, the opt-outs and the send log to the company's owner once a company is
 *   named; the footer follows the same rule. A colleague sending as the company gets the company's
 *   record, read from the company owner's memory, and never their own `outbound.sender` or the
 *   company owner's personal one. Fields the company's record leaves out come from the company
 *   registration itself (name, business id, street address), which is the snapshot an invoice
 *   carries. Without a company record there is no footer, exactly as before this file existed.
 *
 *   VALIDATED LIKE A THEME. Every string is capped and stripped of control characters here, and
 *   escaped where it is rendered. The privacy address must be https. A field that fails is dropped
 *   and REPORTED, never a refused send, and GET /v1/outbound/sender shows the problems before
 *   anybody sends. The one field without which there is no footer is the legal name.
 * @structure SenderIdentity · senderKey · validateSender · companyIdentity · loadSenderIdentity · senderRecordOut
 * @usage const { sender } = await loadSenderIdentity(storage, ownerGhii, sendingCompany);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial, for the newsletter's legal footer.
 */
import type { Storage } from '../../storage/interface.js';
import type { CompanyRecord } from '../../models/company-schemas.js';
import { safeHttpsUrl } from './campaign-markup.js';

export type FooterLocale = 'fi' | 'en' | 'es';
export const FOOTER_LOCALES: FooterLocale[] = ['fi', 'en', 'es'];

/** The validated identity the renderer reads. Every string is already capped and single-line. */
export interface SenderIdentity {
  legalName: string;
  businessId?: string;
  address?: string;
  privacyUrl?: string;
  reason: Partial<Record<FooterLocale, string>>;
  /** Also carry the identity block (not the reason, not the unsubscribe) on transactional and invoice mail. */
  transactional: boolean;
}

export interface SenderProblem { field: string; why: string }

const CAP = { legal_name: 140, business_id: 40, address: 200, reason: 300, privacy_url: 500 } as const;

/** The memory key the identity lives under: the owner's own, or one company's. */
export function senderKey(companyId?: string): string {
  return companyId ? `outbound.sender.${companyId}` : 'outbound.sender';
}

/** One line of text: control characters become spaces, runs of whitespace one space, capped. */
function line(raw: unknown, field: string, cap: number, problems: SenderProblem[]): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') { problems.push({ field, why: 'not a string' }); return undefined; }
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  if (clean.length > cap) {
    problems.push({ field, why: `longer than ${cap} characters, cut to ${cap}` });
    return clean.slice(0, cap);
  }
  return clean;
}

/**
 * Read a stored record into an identity, saying what it could not use. Never throws.
 *
 * `defaults` fills what the record leaves out; a company send passes the company's registration.
 * Null when there is no legal name from either, because a footer without the sender's name says
 * nothing the law asks for.
 */
export function validateSender(
  raw: unknown, defaults: Partial<Pick<SenderIdentity, 'legalName' | 'businessId' | 'address'>> = {},
): { sender: SenderIdentity | null; problems: SenderProblem[] } {
  const problems: SenderProblem[] = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (raw !== undefined && src !== raw) problems.push({ field: '(record)', why: 'not an object' });

  const legalName = line(src.legal_name, 'legal_name', CAP.legal_name, problems) ?? defaults.legalName;
  const businessId = line(src.business_id, 'business_id', CAP.business_id, problems) ?? defaults.businessId;
  const address = line(src.address, 'address', CAP.address, problems) ?? defaults.address;

  let privacyUrl: string | undefined;
  if (src.privacy_url !== undefined && src.privacy_url !== null && src.privacy_url !== '') {
    privacyUrl = safeHttpsUrl(src.privacy_url, CAP.privacy_url) ?? undefined;
    if (!privacyUrl) problems.push({ field: 'privacy_url', why: 'not an https address' });
  }

  const reason: Partial<Record<FooterLocale, string>> = {};
  if (src.reason !== undefined && src.reason !== null) {
    if (typeof src.reason !== 'object' || Array.isArray(src.reason)) {
      problems.push({ field: 'reason', why: 'not an object with fi, en or es' });
    } else {
      const r = src.reason as Record<string, unknown>;
      for (const loc of FOOTER_LOCALES) {
        const text = line(r[loc], `reason.${loc}`, CAP.reason, problems);
        if (text) reason[loc] = text;
      }
    }
  }

  let transactional = false;
  if (src.transactional !== undefined) {
    if (typeof src.transactional === 'boolean') transactional = src.transactional;
    else problems.push({ field: 'transactional', why: 'not true or false' });
  }

  if (!legalName) {
    problems.push({ field: 'legal_name', why: 'missing: the footer needs the sender\'s legal name' });
    return { sender: null, problems };
  }
  return {
    sender: {
      legalName,
      ...(businessId ? { businessId } : {}),
      ...(address ? { address } : {}),
      ...(privacyUrl ? { privacyUrl } : {}),
      reason, transactional,
    },
    problems,
  };
}

/** The company registration's own identity, used where the company's record leaves a field out. */
export function companyIdentity(company: CompanyRecord): Partial<Pick<SenderIdentity, 'legalName' | 'businessId' | 'address'>> {
  const place = [company.postalCode, company.city].filter(Boolean).join(' ');
  const address = [company.streetAddress, place, company.country].filter(Boolean).join(', ');
  return {
    ...(company.name ? { legalName: company.name } : {}),
    ...(company.businessId ? { businessId: company.businessId } : {}),
    ...(address ? { address } : {}),
  };
}

export interface LoadedSender {
  key: string;
  /** Whether a record exists under the key. No record means no footer. */
  found: boolean;
  sender: SenderIdentity | null;
  problems: SenderProblem[];
}

/**
 * The identity this send's footer uses. `company` is the resolved sending company, when one was
 * named: its record in its owner's memory, completed from its registration. Otherwise the caller's
 * own record. Never throws and never refuses a send.
 */
export async function loadSenderIdentity(
  storage: Storage, ownerGhii: string, company?: { company: CompanyRecord; bookOwner: string } | null,
): Promise<LoadedSender> {
  const key = senderKey(company?.company.id);
  const rec = await storage.getMemory(company ? company.bookOwner : ownerGhii, key);
  if (!rec) return { key, found: false, sender: null, problems: [] };
  const { sender, problems } = validateSender(rec.value, company ? companyIdentity(company.company) : {});
  return { key, found: true, sender, problems };
}

/** The identity in the record's own field names, for an answer a caller reads back. */
export function senderRecordOut(s: SenderIdentity): Record<string, unknown> {
  return {
    legal_name: s.legalName,
    ...(s.businessId ? { business_id: s.businessId } : {}),
    ...(s.address ? { address: s.address } : {}),
    ...(s.privacyUrl ? { privacy_url: s.privacyUrl } : {}),
    reason: s.reason,
    transactional: s.transactional,
  };
}
