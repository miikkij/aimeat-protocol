/**
 * @file invitations-agent-door.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description NODE-level invitation — the agent door (12-ai-rekisteroi.md).
 *
 *   An AI makes one POST with a person's email address. The node emails that address a link; the
 *   person clicks it, picks a username, and has an account. The AI never creates the account and
 *   never chooses the username: it supplies an address, and the address's owner decides.
 *
 *   This is the SAME record, the same token, the same accept endpoint and the same account-creation
 *   path as an organism invitation — with organismId null. What differs is only that nothing is
 *   joined at the end, and that the email has to explain itself, because nobody asked for it.
 *
 *   Extracted from invitations.ts on 2026-09-12 by pure move, when that file crossed 800 lines.
 *   Nothing here changed in the move; the token minting, the caps and the record shape it shares
 *   with organism invitations still live next door and are imported from there.
 * @structure AGENT_DOOR_INVITER · REGISTRATION_INVITE_EXPIRY_HOURS · AgentSelfReport ·
 *   RequestObservation · RegistrationInviteInput · RegistrationInviteResult ·
 *   createRegistrationInvitation
 * @usage const result = await createRegistrationInvitation(storage, config, { email, agent, observed });
 * @version-history
 *   v1.0.0 — 2026-09-12 — Extracted from invitations.ts (max-file-lines), unchanged.
 */
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { InvitationRecord } from '../storage/repositories/invitation.repository.js';
import { hashInviteToken, inviteEmailHash, InvitationError } from './invitations.js';
import { getActiveEmailService } from './email.js';
import { registrationInviteEmail } from './email-templates.js';
import { isValidEmail } from '../utils/email-validator.js';

/** The one identity string in `invitedBy` for a node-level invite. A colon cannot appear in an
 *  owner name (OWNER_RE), so this can never collide with a real inviter. */
export const AGENT_DOOR_INVITER = 'node:agent-door';

/** One live invitation per address at a time — the abuse cap on an OPEN, email-sending endpoint. */
export const REGISTRATION_INVITE_EXPIRY_HOURS = 24;

/** What the AI said about itself. Every field is its own claim and none is verified. */
export interface AgentSelfReport {
    model?: string | null;
    vendor?: string | null;
    client?: string | null;
}

/** What the SERVER saw. Unlike the self-report, this is evidence. */
export interface RequestObservation {
    ip: string;
    userAgent: string | null;
    at: string;
}

export interface RegistrationInviteInput {
    email: string;
    agent: AgentSelfReport;
    observed: RequestObservation;
    locale?: string;
}

export interface RegistrationInviteResult {
    /** Absent when the request was suppressed by the per-address cap — the caller must not learn that. */
    invitation: InvitationRecord | null;
    acceptUrl: string | null;
    emailSent: boolean;
    /** Why nothing was sent, for the node's own logs. NEVER returned to the caller. */
    suppressed: 'already-pending' | null;
}

/**
 * Mint and send a node-level registration invitation.
 *
 * Two properties this function exists to guarantee:
 *
 * 1. **The response cannot be used to test addresses.** It returns the same shape whether the
 *    address is new, already has an account, or already has a pending invite. An endpoint that
 *    said "already registered" would be an account-enumeration oracle open to the internet.
 * 2. **The email explains itself.** Nobody asked for it, so it carries what the AI claimed
 *    (model / vendor / client) beside what the server observed (IP, user agent, time), and says
 *    plainly that ignoring it means no account is created. That is what turns an open endpoint
 *    from a weakness into something traceable: every unrequested message writes a full account of
 *    itself into the mailbox of the person it concerns.
 */
export async function createRegistrationInvitation(
    storage: Storage,
    config: AimeatConfig,
    input: RegistrationInviteInput,
): Promise<RegistrationInviteResult> {
    const cleanEmail = (input.email || '').trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
        throw new InvitationError(400, 'INVALID_INPUT', 'A valid "email" is required');
    }
    const emailHash = inviteEmailHash(cleanEmail);

    // Per-address cap: one live invitation at a time, so repeating the call cannot bury an address
    // in mail. Expired ones do not count — the next attempt is allowed once the last has lapsed.
    const existing = await storage.listInvitationsByEmailHash(emailHash, { status: 'pending', type: 'registration' });
    const live = existing.filter(i => new Date(i.expiresAt) > new Date());
    if (live.length > 0) {
        return { invitation: null, acceptUrl: null, emailSent: false, suppressed: 'already-pending' };
    }

    const now = Date.now();
    const rawToken = randomBytes(32).toString('hex');
    const invitation: InvitationRecord = {
        id: uuidv4(),
        tokenHash: hashInviteToken(rawToken),
        organismId: null,
        orgRole: 'member',
        type: 'registration',
        workspaces: [],
        email: cleanEmail,
        emailHash,
        invitedBy: AGENT_DOOR_INVITER,
        provisionedOwner: null,
        message: null,
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + REGISTRATION_INVITE_EXPIRY_HOURS * 3600_000).toISOString(),
        acceptedAt: null,
        acceptedBy: null,
        returnUrl: null,
        // The two kinds of fact, kept apart: `agent` is a self-report, `observed` is evidence.
        meta: {
            agent: {
                model: input.agent.model ?? null,
                vendor: input.agent.vendor ?? null,
                client: input.agent.client ?? null,
            },
            observed: { ip: input.observed.ip, userAgent: input.observed.userAgent, at: input.observed.at },
        },
    };
    await storage.createInvitation(invitation);

    const acceptUrl = `${config.baseUrl}/v1/invite?token=${rawToken}`;

    const emailSvc = getActiveEmailService();
    let emailSent = false;
    if (emailSvc?.enabled) {
        const { subject, html, text } = registrationInviteEmail({
            acceptUrl,
            agent: invitation.meta!.agent as AgentSelfReport,
            observed: input.observed,
            // Deliberately NOT formatForPerson. This door writes to an address with no account on
            // this node — that is what it is for — so there is no stored preference to honour and
            // no browser to ask. A stable, zone-marked string beats a format borrowed from the
            // host's own locale, which is what an empty preference would fall through to.
            expiresLabel: invitation.expiresAt.slice(0, 16).replace('T', ' ') + ' UTC',
            reportUrl: `${config.baseUrl}/v1/transparency`,
        }, input.locale);
        emailSent = await emailSvc.sendRaw(cleanEmail, subject, html, text);
    }

    return { invitation, acceptUrl, emailSent, suppressed: null };
}
