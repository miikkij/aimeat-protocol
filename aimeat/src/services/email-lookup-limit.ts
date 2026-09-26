/**
 * @file src/services/email-lookup-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many email addresses one account may look up in ten minutes, on every contacts
 *   door that tells whether an address has an account here.
 *
 *   WHAT COUNTS. Three acts, each in the service every door reaches: the lookup itself
 *   (resolveContactEmail in services/contacts.ts, behind POST /v1/contacts/resolve and the
 *   aimeat_contact_resolve_email tool that asks it), saving a person by email (addContact with an
 *   email, behind POST /v1/contacts and aimeat_contact_add), and inviting a person
 *   (createContactInvitation in services/contact-invitations.ts, behind POST /v1/contacts/invite and
 *   aimeat_contact_invite), because the saved record and the invitation's answer say the same thing:
 *   whether the address belongs to someone here. A malformed address is refused before it is
 *   counted, because it was never looked up.
 *
 *   WHOSE ALLOWANCE. The ACCOUNT's, keyed by the owner GHII: the owner and every agent acting for
 *   them draw on one allowance, so connecting a second agent does not double what one person can
 *   look up. Not per network address, because the MCP tool asks over loopback and every account
 *   would share one bucket; not per principal, which would give each agent its own. The developer's
 *   ruling of 2026-09-25: 20 lookups in 10 minutes per account.
 *
 *   PER PROCESS, like every limiter here (services/rate-buckets.ts).
 * @structure EMAIL_LOOKUP_LIMIT · EmailLookupRefusal · takeEmailLookup(asker)
 * @usage
 *   const turn = takeEmailLookup(ownerGhii);
 *   if (!turn.ok) throw new ContactsError(429, turn.code, turn.message, { retry_after_sec: turn.retryAfterSec });
 * @version-history
 *   v1.1.0 — 2026-09-26 — An invitation to a person counts too (services/contact-invitations.ts),
 *     on both of its doors, and the refusal says so (secaudit 2026-09, A5-2).
 *   v1.0.0 — 2026-09-25 — Initial. The limit sat on the resolve door alone, so saving a person by
 *     email answered the same question without counting.
 */
import { ownerGhiiOf } from '../utils/gaii.js';
import { rateBuckets } from './rate-buckets.js';

/** Lookups one account may make in one window: the owner and their agents together. */
export const EMAIL_LOOKUP_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 } as const;

/** The answer when the account has used its allowance for this window. */
export interface EmailLookupRefusal {
  ok: false;
  code: 'RATE_LIMITED';
  /** Whole seconds until the window ends: the value a Retry-After carries. */
  retryAfterSec: number;
  /** A plain sentence for whoever asked. */
  message: string;
}

const take = rateBuckets(EMAIL_LOOKUP_LIMIT.windowMs);

/** Count one lookup against the account behind `asker` (an owner GHII, an agent's GAII, any principal of it). */
export function takeEmailLookup(asker: string): { ok: true } | EmailLookupRefusal {
  const counted = take(ownerGhiiOf(asker), EMAIL_LOOKUP_LIMIT.max);
  if (counted.ok) return { ok: true };
  return {
    ok: false,
    code: 'RATE_LIMITED',
    retryAfterSec: counted.retryAfterSec,
    message: `This account has looked up ${EMAIL_LOOKUP_LIMIT.max} email addresses in the last 10 minutes, the most one `
      + `account may. Saving a person by email and inviting one count as lookups. Try again in ${counted.retryAfterSec} seconds. `
      + 'The owner and their agents share this limit.',
  };
}
