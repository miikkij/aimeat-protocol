/**
 * @file outbound-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Record types for the outbound messaging door: the recipient registry
 *   (outbound contacts) and the append-only send log. The registry is the structural
 *   anti-spam device — /v1/outbound/send takes a contact id, never a free address, so
 *   every recipient is a deliberately saved entry with its own opt-out and bounce state.
 *
 *   Distinct from /v1/contacts (ContactConsentRecord), which is GHII↔GHII messaging
 *   consent between AIMEAT identities. An outbound contact is a customer/lead with an
 *   EMAIL, who may or may not have an AIMEAT identity — when they do (resolved via the
 *   privacy-preserving email hash), delivery prefers their AIMEAT inbox+push and email
 *   becomes the fallback.
 *
 * @structure OutboundContactRecord · OutboundContactLink · OutboundMessageRecord (send log) · query types
 * @usage import type { OutboundContactRecord, ... } from '../models/outbound-schemas.js';
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063. The record is now also the ADDRESS-BOOK entry for a person
 *     the node does not have: `emailHash` (the join key promotion uses — same hash as
 *     GHIIRecord.emailHash, so a person who registers later is found without storing a second
 *     copy of the address anywhere it could be enumerated), `links` (where else this person is)
 *     and `relation` (the owner's own word for the relationship). Send semantics are untouched.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2: outbound door.
 */

/** Somewhere else this person can be found. `label` is the owner's own word for the place. */
export interface OutboundContactLink {
  label: string;
  url: string;
}

/**
 * A saved recipient AND the address-book entry for a person who may have no AIMEAT identity.
 *
 * Two readings of the same row, deliberately one record rather than two: the sending fields
 * (opt-out, bounce, suppression) are meaningless for a person nobody ever mails, and stay empty;
 * the address-book fields (links, relation, notes) are meaningless to the send path, and it
 * ignores them. A second table would have meant the same person under two names.
 *
 * Opt-out blocks marketing sends (transactional and invoice sends still go through — a customer
 * cannot opt out of their own invoice). Three bounces suppress the address entirely until the
 * owner clears it.
 */
export interface OutboundContactRecord {
  id: string;
  ownerGhii: string;
  name: string;
  email: string;
  /**
   * SHA-256 of the lower-cased, trimmed address — the same hash `GHIIRecord.emailHash` carries
   * (services/invitations.ts inviteEmailHash). It exists so promotion can ask "did anyone just
   * verify this address" with a value the node already holds, instead of scanning addresses.
   * Server-internal: no route accepts it as input and no response returns it.
   */
  emailHash: string;
  /** Resolved AIMEAT identity (GHII) when the email belongs to a registered user here. */
  ghii: string | null;
  tags: string[];
  /** Where else this person is (LinkedIn, a site, a profile). The owner's own knowledge. */
  links: OutboundContactLink[];
  /** The owner's own word for the relationship. Free text, no vocabulary imposed. */
  relation: string | null;
  optedOut: boolean;
  optOutAt: string | null;
  /** Unguessable token for the public unsubscribe link. */
  optOutToken: string;
  bounceCount: number;
  /** Set at the third bounce; a suppressed address rejects every send. */
  suppressedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OutboundChannel = 'inbox' | 'email';

/**
 * Message intent. 'marketing' requires the opt-out link and is blocked by opt-out;
 * 'transactional' and 'invoice' are operational messages the relationship itself implies.
 */
export type OutboundKind = 'transactional' | 'marketing' | 'invoice';

export type OutboundStatus = 'sent' | 'failed' | 'suppressed' | 'skipped';

/** One row of the append-only send log (the GDPR-answerable record of what left the node). */
export interface OutboundMessageRecord {
  id: string;
  ownerGhii: string;
  contactId: string;
  channel: OutboundChannel;
  kind: OutboundKind;
  subject: string;
  /** Memory-record template id when a template was used. */
  templateId: string | null;
  status: OutboundStatus;
  error: string | null;
  invoiceId: string | null;
  createdAt: string;
}

export interface OutboundContactQuery {
  ownerGhii: string;
  optedOut?: boolean;
  suppressed?: boolean;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface OutboundLogQuery {
  ownerGhii: string;
  contactId?: string;
  kind?: OutboundKind;
  status?: OutboundStatus;
  limit?: number;
  offset?: number;
}
