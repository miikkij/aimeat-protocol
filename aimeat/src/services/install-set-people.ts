/**
 * @file services/install-set-people.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The people an install set names: the owner user, whose account is created when it
 *   does not exist, and the other users, who join the organisms and workspaces the install created.
 *
 *   TWO WAYS IN, AND EVERY USER HAS AN EMAIL (Jouni, 2026-09-28, decision 13). `account` creates the
 *   account now, with the email verified and the login link on: the person signs in by the login
 *   link, or by Google or Entra, which find the account by that verified email
 *   (external-login.ts mapExternalIdentity). The membership is active at once. `invite` sends the
 *   email invitation the organism page sends (invitations.ts createEmailInvitation), carrying the
 *   organism role and the workspace grants; the person joins by opening it. An email that already
 *   has an account on this node joins at once, whichever way the set asks, because there is nobody
 *   left to invite.
 *
 *   The accounts are created as `provisioning`, the administrator's act SCIM uses: refused only when
 *   registration is closed, and never made the node's operator.
 * @structure checkOwner() · ensureOwner() · joinMember() · MemberOutcome · CreatedOrganisms
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord, GHIIRecord } from '../storage/interface.js';
import { validateOwnerName } from '../utils/gaii.js';
import { provisionOwner, emailHashOf, registrationRefusal, ProvisionEmailTakenError, RegistrationClosedError } from './owner-provisioning.js';
import { deriveUniqueUsername } from './external-login.js';
import { addOrganismMember, createEmailInvitation, InvitationError } from './invitations.js';
import type { InstallSet, InstallSetUser, WorkspaceRole, OrganismRole } from './install-set-spec.js';

export type Refusal = { ok: false; status: number; code: string; message: string };

async function accountOfEmail(storage: Storage, email: string): Promise<GHIIRecord | null> {
    return storage.getGHIIByEmailHash(emailHashOf(email));
}

/**
 * Whether the owner can be had: an account of that name, or a name free to create with an email no
 * other account holds. Writes nothing; ensureOwner() asks it again before it writes.
 */
export async function checkOwner(storage: Storage, config: AimeatConfig, owner: InstallSet['owner']): Promise<Refusal | { ok: true; exists: boolean }> {
    const existing = await storage.getOwner(owner.name);
    const byEmail = await accountOfEmail(storage, owner.email);
    if (existing) {
        if (byEmail && byEmail.username !== owner.name) {
            return { ok: false, status: 409, code: 'EMAIL_TAKEN', message: `${owner.email} belongs to the account "${byEmail.username}", not to "${owner.name}".` };
        }
        return { ok: true, exists: true };
    }
    const nameError = validateOwnerName(owner.name);
    if (nameError) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `owner.name: ${nameError}` };
    if (byEmail) {
        return { ok: false, status: 409, code: 'EMAIL_TAKEN', message: `${owner.email} belongs to the account "${byEmail.username}". Name that account as the owner, or give another email.` };
    }
    const closed = registrationRefusal(config, 'provisioning');
    if (closed) return { ok: false, status: 403, code: 'REGISTRATION_CLOSED', message: closed };
    return { ok: true, exists: false };
}

/** The owner account, created with a verified email and the login link on when it does not exist. */
export async function ensureOwner(storage: Storage, config: AimeatConfig, owner: InstallSet['owner']): Promise<Refusal | { ok: true; created: boolean }> {
    const check = await checkOwner(storage, config, owner);
    if (!check.ok) return check;
    if (check.exists) return { ok: true, created: false };
    try {
        await provisionOwner(storage, config, {
            via: 'provisioning', username: owner.name, displayName: owner.displayName ?? owner.name,
            verifiedEmail: owner.email, enableMagicLink: true,
        });
    } catch (err) {
        if (err instanceof ProvisionEmailTakenError) return { ok: false, status: 409, code: 'EMAIL_TAKEN', message: err.message };
        if (err instanceof RegistrationClosedError) return { ok: false, status: 403, code: 'REGISTRATION_CLOSED', message: err.message };
        throw err;
    }
    return { ok: true, created: true };
}

/** What happened to one user, per organism key. */
export interface MemberOutcome {
    email: string;
    account: string | null;
    created: boolean;
    joined: string[];
    invited: string[];
    already: string[];
    errors: string[];
}

export interface CreatedOrganisms { [key: string]: { id: string; workspaces: Record<string, string> } }

/**
 * One user into the organisms the set names for them. Repeating it changes nothing: a membership
 * that exists and an invitation already pending are reported as `already`.
 */
export async function joinMember(
    storage: Storage, config: AimeatConfig, ownerName: string, user: InstallSetUser, organisms: CreatedOrganisms,
): Promise<MemberOutcome> {
    const out: MemberOutcome = { email: user.email, account: null, created: false, joined: [], invited: [], already: [], errors: [] };
    let account = await accountOfEmail(storage, user.email);
    if (!account && user.join === 'account') {
        const username = user.name ?? await deriveUniqueUsername(storage, user.email, 'user');
        if (user.name) {
            const nameError = validateOwnerName(user.name);
            if (nameError || await storage.getOwner(user.name)) {
                out.errors.push(nameError ?? `The account name "${user.name}" is taken.`);
                return out;
            }
        }
        try {
            const made = await provisionOwner(storage, config, {
                via: 'provisioning', username, displayName: user.displayName ?? username,
                verifiedEmail: user.email, enableMagicLink: true,
            });
            account = made.ghii;
            out.created = true;
        } catch (err) {
            if (err instanceof ProvisionEmailTakenError || err instanceof RegistrationClosedError) {
                out.errors.push(err.message);
                return out;
            }
            throw err;
        }
    }
    out.account = account?.username ?? null;
    for (const m of user.memberships) {
        const org = organisms[m.organism];
        const record: OrganismRecord | null = org ? await storage.getOrganism(org.id) : null;
        if (!org || !record) { out.errors.push(`Organism "${m.organism}" was not created.`); continue; }
        const grants = m.workspaces
            .map(w => ({ ws: org.workspaces[w.key], role: w.role as WorkspaceRole }))
            .filter((g): g is { ws: string; role: WorkspaceRole } => typeof g.ws === 'string');
        try {
            if (account) {
                await addOrganismMember(storage, config, {
                    organism: record, inviterGhii: ownerName, inviteeRaw: account.username, role: m.role as OrganismRole, workspaces: grants,
                });
                out.joined.push(m.organism);
            } else {
                await createEmailInvitation(storage, config, {
                    organism: record, inviterGhii: ownerName, email: user.email, orgRole: m.role, workspaces: grants,
                });
                out.invited.push(m.organism);
            }
        } catch (err) {
            if (err instanceof InvitationError && (err.code === 'ALREADY_MEMBER' || err.code === 'ALREADY_INVITED')) {
                out.already.push(m.organism);
                continue;
            }
            if (err instanceof InvitationError) { out.errors.push(`${m.organism}: ${err.code}: ${err.message}`); continue; }
            throw err;
        }
    }
    return out;
}
