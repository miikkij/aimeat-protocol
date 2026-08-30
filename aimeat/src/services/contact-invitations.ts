/**
 * @file contact-invitations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An invitation from one person to another to join this AIMEAT, with no organism
 *   behind it. The Contacts page writes down a person who has no account here; this is the door
 *   that brings them in. It is the same record and the same accept flow as an organism's email
 *   invitation (type 'link', a hashed single-use token, /v1/invite?token=), with organismId null,
 *   which the accept route already treats as "an account and nothing more" because the agent door
 *   needed exactly that. The email is written in the inviter's name and carries their message.
 *   Build note 2026-07-16 left "invite without organism" open; this closes it.
 * @structure ContactInvitationError · createContactInvitation · pendingContactInvitation
 * @usage const { invitation, acceptUrl, emailSent } = await createContactInvitation(storage, config, { inviterName, email, message });
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { InvitationRecord } from '../storage/repositories/invitation.repository.js';
import { hashInviteToken, inviteEmailHash, INVITE_DEFAULT_EXPIRY_DAYS } from './invitations.js';
import { getActiveEmailService } from './email.js';
import { contactInviteEmail } from './email-templates.js';
import { isValidEmail } from '../utils/email-validator.js';

/** How many invitations one person may have open at once, organism ones included. */
export const CONTACT_INVITE_MAX_PENDING_PER_INVITER = 50;
const DAY_MS = 86_400_000;

/** A refusal the caller maps to its own error shape (HTTP envelope / MCP text). */
export class ContactInvitationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ContactInvitationError';
  }
}

export interface ContactInvitationInput {
  /** Bare owner name of the inviter. */
  inviterName: string;
  email: string;
  message?: string | null;
  locale?: string;
}

export interface ContactInvitationResult {
  invitation: InvitationRecord;
  rawToken: string;
  acceptUrl: string;
  emailSent: boolean;
}

/** The inviter's own live invitation to this address, if one is open: pending, not expired, no
 *  organism, sent by them. What the address-book row reports as "invitation sent". */
export async function pendingContactInvitation(
  storage: Storage, inviterName: string, email: string,
): Promise<InvitationRecord | null> {
  const clean = (email || '').trim().toLowerCase();
  if (!isValidEmail(clean)) return null;
  const rows = await storage.listInvitationsByEmailHash(inviteEmailHash(clean), { status: 'pending', type: 'link' });
  const now = Date.now();
  return rows.find(i => i.organismId === null && i.invitedBy === inviterName && new Date(i.expiresAt).getTime() > now) ?? null;
}

/**
 * Mint and send a person-to-person invitation to join this AIMEAT.
 *
 * Refuses before it writes: a malformed address, an address that already has a verified account
 * here (that person is added as a contact, not invited), an invitation of the inviter's own that
 * is still open to the same address, and an inviter with too many open invitations. The email is
 * best-effort; the accept URL comes back so the inviter can hand it over when mail is off.
 */
export async function createContactInvitation(
  storage: Storage, config: AimeatConfig, input: ContactInvitationInput,
): Promise<ContactInvitationResult> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    throw new ContactInvitationError(400, 'INVALID_INPUT', 'Give a valid email address to send the invitation to');
  }
  const emailHash = inviteEmailHash(cleanEmail);
  const inviterGhii = `${input.inviterName}@${config.nodeId}`;

  const existing = await storage.getGHIIByEmailHash(emailHash);
  if (existing?.emailVerifiedAt) {
    if (existing.ghii === inviterGhii) throw new ContactInvitationError(400, 'INVALID_INPUT', 'That address is your own account');
    throw new ContactInvitationError(409, 'ALREADY_HERE', 'That address already has an account here: add them as a contact instead');
  }
  if (await pendingContactInvitation(storage, input.inviterName, cleanEmail)) {
    throw new ContactInvitationError(409, 'ALREADY_INVITED', 'You already have an open invitation to that address: wait for it to be answered or to expire');
  }
  const open = await storage.countInvitationsByInviter(input.inviterName, { type: 'link', statuses: ['pending'] });
  if (open >= CONTACT_INVITE_MAX_PENDING_PER_INVITER) {
    throw new ContactInvitationError(429, 'TOO_MANY_INVITES', 'You have too many open invitations: cancel some or wait for them to expire before sending more');
  }

  const now = Date.now();
  const rawToken = randomBytes(32).toString('hex');
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim().slice(0, 1000) : null;
  const invitation: InvitationRecord = {
    id: randomUUID(),
    tokenHash: hashInviteToken(rawToken),
    organismId: null,
    orgRole: 'member',
    type: 'link',
    workspaces: [],
    email: cleanEmail,
    emailHash,
    invitedBy: input.inviterName,
    provisionedOwner: null,
    message,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_DEFAULT_EXPIRY_DAYS * DAY_MS).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
    returnUrl: null,
    // Says which door minted it. The accept page shows a node-level invitation's meta as "what
    // caused this email"; here that is a person, named in invited_by, and nothing else.
    meta: { kind: 'contact' },
  };
  await storage.createInvitation(invitation);

  const acceptUrl = `${config.baseUrl}/v1/invite?token=${rawToken}`;
  const inviter = await storage.getGHII(inviterGhii);
  const inviterName = inviter?.displayName || input.inviterName;

  const emailSvc = getActiveEmailService();
  let emailSent = false;
  if (emailSvc?.enabled) {
    const { subject, html, text } = contactInviteEmail({
      inviterName, acceptUrl, message,
      expiresLabel: invitation.expiresAt.slice(0, 10),
    }, input.locale);
    emailSent = await emailSvc.sendRaw(cleanEmail, subject, html, text);
  }
  return { invitation, rawToken, acceptUrl, emailSent };
}
