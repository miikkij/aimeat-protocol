/**
 * @file contacts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the OWNER's contacts (address book) — a thin layer over the shared
 *   core in services/contacts.ts (also behind the REST /v1/contacts routes, so both surfaces
 *   behave identically). The list merges saved identities, DM conversation peers and saved
 *   PEOPLE (someone with no account on this node); save/remove never disturb the DM first-contact
 *   gate; email lookup is EXACT-match only (privacy-preserving hash — no enumeration). Contacts
 *   feed identity pickers: use a resolved/looked-up owner with aimeat_organism_invite /
 *   aimeat_organism_member_add / aimeat_workspace_member_grant.
 * @structure registerContactTools(mcp, storage, config, getAgentGaii, scopes, caller) — registers
 *   aimeat_contact_list, aimeat_contact_add, aimeat_contact_remove, aimeat_contact_resolve_email.
 * @usage import { registerContactTools } from './contacts.js';
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.7.0 — 2026-10-05 — aimeat_contact_list and aimeat_contact_resolve_email call the services the
 *     routes call (listContactsFor, resolveContactEmail) in place of reaching the routes over loopback
 *     HTTP; the tool takes the session's scopes in place of its bearer (secaudit 2026-10, M6).
 *   v1.6.0 — 2026-10-01 — aimeat_contact_list asks GET /v1/contacts with the session's own bearer over
 *     loopback, as aimeat_contact_resolve_email does, and is registered on contacts:read: the route
 *     decides who reads the book and which columns a scoped reader sees, for this tool, the
 *     connector's copy and REST alike (the developer's ruling of 2026-10-01).
 *   v1.5.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.5.0 — 2026-09-26 — aimeat_contact_invite answers a refusal as `CODE: message` (toolError): an
 *     invitation counts as an address lookup (services/contact-invitations.ts), so over the account's
 *     allowance it reads RATE_LIMITED, as on REST (secaudit 2026-09, A5-2).
 *   v1.4.0 — 2026-09-25 — aimeat_contact_add answers a refusal as `CODE: message` (toolError), so a
 *     save by email over the account's lookup allowance reads RATE_LIMITED, as on REST.
 *   v1.3.1 — 2026-09-25 — The note on aimeat_contact_resolve_email says what the route decides now: an
 *     agent holding messages:read is answered, 20 lookups in 10 minutes per account. No code changed.
 *   v1.3.0 — 2026-09-24 — SECURITY (audit A5-2): aimeat_contact_resolve_email asks POST
 *     /v1/contacts/resolve with the session's own bearer, over loopback, instead of calling the
 *     service behind messages:read alone. The route's owner gate and its 20-per-10-minutes limiter
 *     now decide for both doors, so an agent is refused exactly as REST refuses it.
 *   v1.2.0 — 2026-08-30 — aimeat_contact_list takes include (together, invites); aimeat_contact_invite
 *     sends a person an invitation to join this AIMEAT with no organism behind it. Same service
 *     functions as the routes.
 *   v1.1.0 — 2026-08-17 — TARGET-063: aimeat_contact_add takes name + email (a person with no
 *     account here) beside contact_id. Same handler, same service call — the decision of what a
 *     contact IS stays in services/contacts.ts rather than being made once per surface.
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolve_email over the shared contacts core.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { localAccountName } from '../utils/gaii.js';
import {
    ContactsError, addContact, removeContact, listContactsFor, resolveContactEmail,
    type AddContactInput,
} from '../services/contacts.js';
import { createContactInvitation, ContactInvitationError } from '../services/contact-invitations.js';
import { invitePublic } from '../services/invitations.js';
import { toolError } from './tool-error.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerContactTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    /** The session's scopes. Unused here: the session caller below carries them. */
    _scopes: readonly string[] = [],
    /** The session's caller (services/caller-context.ts): the address book's columns depend on what
     *  the reader holds. */
    caller: () => CallerContext,
): void {
    /** This session as the services read a principal: the agent, its owner, its scopes. */
    const session = () => caller().auth;
    /** Contacts belong to the OWNER — resolve the agent's owner GHII (never a client-supplied id). */
    const ownerGhii = (): string => {
        const owner = localAccountName(getAgentGaii());
        return owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
    };
    const errText = (e: unknown): string =>
        e instanceof ContactsError ? e.message : ((e as Error)?.message || 'Contacts operation failed');

    // ── aimeat_contact_list — the owner's merged address book ──
    //
    // THE SAME SERVICE AS THE ROUTE: listContactsFor decides which columns a scoped reader sees (the
    // conversation columns only with the owner's mailbox, `together` only with organism:read), for
    // GET /v1/contacts and this tool alike; the tool is registered on contacts:read, the word the
    // route asks, and the session's scopes are the live ones. Calling listContactsMerged() here once
    // handed every agent on messages:read the owner's last messages; the tool then reached the route
    // over loopback HTTP until 2026-10-05 (secaudit 2026-10, M6).
    mcp.tool(
        'aimeat_contact_list',
        descriptionFor('aimeat_contact_list'),
        zodShapeFor('aimeat_contact_list'),
        annotationsFor('aimeat_contact_list'),
        async ({ q, state, include }) => {
            const answer = await listContactsFor(storage, config.nodeId, session(), { q, state, include });
            return { content: [{ type: 'text' as const, text: JSON.stringify(answer, null, 2) }] };
        },
    );

    // ── aimeat_contact_invite — invite a person to join this AIMEAT, no organism behind it ──
    mcp.tool(
        'aimeat_contact_invite',
        descriptionFor('aimeat_contact_invite'),
        zodShapeFor('aimeat_contact_invite'),
        annotationsFor('aimeat_contact_invite'),
        async ({ email, message }) => {
            try {
                const inviterName = localAccountName(getAgentGaii());
                const { invitation, acceptUrl, emailSent } = await createContactInvitation(storage, config, { inviterName, email, message: message ?? null });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', invitation: invitePublic(invitation), email_sent: emailSent, accept_url: acceptUrl }, null, 2) }] };
            } catch (e) {
                // With its code, as the REST door answers: an invitation counts as an address lookup
                // and can be RATE_LIMITED, which an agent has to tell apart from a refused address.
                if (e instanceof ContactInvitationError) return { ...toolError(e.code, e.message) };
                return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
            }
        },
    );

    // ── aimeat_contact_add — save an identity, or a person with no account here ──
    mcp.tool(
        'aimeat_contact_add',
        descriptionFor('aimeat_contact_add'),
        zodShapeFor('aimeat_contact_add'),
        annotationsFor('aimeat_contact_add'),
        async ({ contact_id, name, email, note, tags, links, relation }) => {
            // Which of the two shapes the caller meant is decided ONCE, in the service, so the MCP
            // answer and the REST answer cannot disagree about what a contact is.
            const input: AddContactInput | null = email
                ? {
                    name: name ?? '', email, note: note ?? null, tags,
                    // A link without a label is legal input; the service falls back to the url.
                    links: links?.map(l => ({ label: l.label ?? '', url: l.url })),
                    relation: relation ?? null,
                }
                : (contact_id ? { contact_id } : null);
            if (!input) {
                return { content: [{ type: 'text' as const, text: 'Give either contact_id (an identity) or name + email (a person).' }], isError: true };
            }
            try {
                const saved = await addContact(storage, config, ownerGhii(), input);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'saved', ...saved }, null, 2) }] };
            } catch (e) {
                // With its code, as the REST door answers: a save by email can be RATE_LIMITED, which
                // an agent has to tell apart from a bad address to know that waiting is the fix.
                if (e instanceof ContactsError) return { ...toolError(e.code, e.message) };
                return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
            }
        },
    );

    // ── aimeat_contact_remove — remove from the address book (never resets the DM gate) ──
    mcp.tool(
        'aimeat_contact_remove',
        descriptionFor('aimeat_contact_remove'),
        zodShapeFor('aimeat_contact_remove'),
        annotationsFor('aimeat_contact_remove'),
        async ({ contact_id }) => {
            try {
                await removeContact(storage, ownerGhii(), contact_id);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'removed', contact_id }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
            }
        },
    );

    // ── aimeat_contact_resolve_email — exact-match email → local owner ──
    //
    // Whether an address has an account here is an oracle, so who may ask and how often are decided
    // once. Who: an agent holding messages:read, the word POST /v1/contacts/resolve asks and this tool
    // is registered on (the session's live scopes). How often: resolveContactEmail counts it
    // (services/email-lookup-limit.ts), 20 lookups in 10 minutes per account, the owner and their
    // agents together, a save by email included. The limit lived on the route until 2026-09-24
    // (security audit A5-2), and this tool asked the route over loopback HTTP until 2026-10-05; both
    // now call the service (secaudit 2026-10, M6).
    mcp.tool(
        'aimeat_contact_resolve_email',
        descriptionFor('aimeat_contact_resolve_email'),
        zodShapeFor('aimeat_contact_resolve_email'),
        annotationsFor('aimeat_contact_resolve_email'),
        async ({ email }) => {
            try {
                const result = await resolveContactEmail(storage, getAgentGaii(), String(email ?? ''));
                return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            } catch (e) {
                if (e instanceof ContactsError) return { ...toolError(e.code, e.message) };
                throw e;
            }
        },
    );
}
