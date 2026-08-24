/**
 * @file src/services/outbound/company-sender-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may send as a registered company, and WHOSE BOOK that send belongs to.
 *
 *   THE QUESTION THIS ANSWERS. A company's mail server is set up once, by whoever registered the
 *   company, and then a team works out of a shared CRM. Until this file, every other member sent
 *   from the platform's shared address instead: the outbound door resolved the caller's own
 *   identity and refused a company somebody else had registered. The tool looked shared and the
 *   sending was not.
 *
 *   THE ORGANISM IS THE BOUNDARY, and it is one the company record has carried since it was
 *   written: `company.organismId` names "the organism this company's data lives in". Finance
 *   already keeps a company's books by it. This adds the second use: an ACTIVE member of that
 *   organism may send as the company.
 *
 *   THE BOOK MOVES WITH THE COMPANY, and this is the half that matters more than the address.
 *   Recipients, opt-outs, bounce suppression, the daily allowance and the send log all key on the
 *   COMPANY'S owner once a company is named, not on whoever pressed send. Without that, a person
 *   who unsubscribed from one member's campaign would be mailed by the next member, who would have
 *   no way of knowing — a promise broken by two people who each thought they were keeping it, and
 *   the reason this is a single resolution rather than a permission check bolted on at the door.
 *
 *   MEMBERSHIP IS ASKED AT SEND TIME, never stored on the campaign or the token. Someone removed
 *   from the organism stops being able to send with the next request, which is the behaviour a
 *   person expects when they take somebody off a team.
 *
 *   A COMPANY WITH NO ORGANISM IS NEVER SHARED. An absent link is a refusal, not a wildcard: the
 *   safe reading of "this company belongs to no group" is that no group may speak for it.
 *
 * @structure SendingCompany · resolveSendingCompany · listSendableCompanies
 * @usage const sender = await resolveSendingCompany(storage, callerGhii, companyId);
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial: organism-scoped sending identity.
 */
import type { Storage } from '../../storage/interface.js';
import type { CompanyRecord } from '../../models/company-schemas.js';

export interface SendingCompany {
  company: CompanyRecord;
  /**
   * Whose recipient registry, opt-outs, suppression, daily allowance and send log this send
   * belongs to. The company's owner whenever a company is named — see the header.
   */
  bookOwner: string;
  /** How the caller got here. Carried so a verdict can be explained rather than just enforced. */
  via: 'owner' | 'organism';
}

/** The bare account name a membership row is keyed by. */
const bareOwner = (ghii: string): string => String(ghii || '').split('@')[0];

/**
 * May this caller send as this company, and whose book is it?
 *
 * Returns null when they may not, and the caller turns that into the same 404 an unknown company
 * gets: whether a company exists is not something a stranger should learn from a refusal.
 */
export async function resolveSendingCompany(
  storage: Storage, callerGhii: string, companyId: string,
): Promise<SendingCompany | null> {
  const company = await storage.getCompany(companyId);
  if (!company) return null;

  // The owner's own company: unchanged in every respect, including whose book it is.
  if (company.ownerGhii === callerGhii) {
    return { company, bookOwner: callerGhii, via: 'owner' };
  }

  // Somebody else's. The only way in is the organism the company itself names.
  if (!company.organismId) return null;
  const membership = await storage.getMembership(company.organismId, bareOwner(callerGhii));
  if (!membership || membership.status !== 'active') return null;

  return { company, bookOwner: company.ownerGhii, via: 'organism' };
}

/**
 * Every company this caller may send as: their own, plus the ones an organism they belong to
 * shares with them.
 *
 * The picker needs this, and so does an honest answer to "which addresses can I send from". A
 * company is listed once even when both routes reach it.
 */
export async function listSendableCompanies(
  storage: Storage, callerGhii: string,
): Promise<Array<{ company: CompanyRecord; via: 'owner' | 'organism' }>> {
  const own = await storage.listCompanies({ ownerGhii: callerGhii, limit: 100, offset: 0 });
  const seen = new Set(own.map((c) => c.id));
  const out: Array<{ company: CompanyRecord; via: 'owner' | 'organism' }> =
    own.map((company) => ({ company, via: 'owner' as const }));

  // The organisms this person is an active member of, then the companies bound to them. Read in
  // that direction because a person belongs to a handful of organisms and a node holds many
  // companies; the other direction would scan every company on the node per request.
  const memberships = await storage.listMembershipsByGhii(bareOwner(callerGhii));
  for (const m of memberships) {
    if (m.status !== 'active') continue;
    const shared = await storage.listCompanies({ organismId: m.organismId, limit: 100, offset: 0 });
    for (const company of shared) {
      if (seen.has(company.id)) continue;
      seen.add(company.id);
      out.push({ company, via: 'organism' });
    }
  }
  return out;
}
