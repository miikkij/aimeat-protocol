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
 * @structure registerContactTools(mcp, storage, config, getAgentGaii) — registers
 *   aimeat_contact_list, aimeat_contact_add, aimeat_contact_remove, aimeat_contact_resolve_email.
 * @usage import { registerContactTools } from './contacts.js';
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: aimeat_contact_add takes name + email (a person with no
 *     account here) beside contact_id. Same handler, same service call — the decision of what a
 *     contact IS stays in services/contacts.ts rather than being made once per surface.
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolve_email over the shared contacts core.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import {
    ContactsError, listContactsMerged, addContact, removeContact, resolveContactEmail,
    type AddContactInput,
} from '../services/contacts.js';

/** The link shape both MCP surfaces accept, declared once so they cannot drift. */
const LinkSchema = z.object({
    label: z.string().max(60).optional().describe('What to call this place.'),
    url: z.string().max(500).describe('http(s) address.'),
});

export function registerContactTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    /** Contacts belong to the OWNER — resolve the agent's owner GHII (never a client-supplied id). */
    const ownerGhii = (): string => {
        const owner = parseGaiiLoose(getAgentGaii()).owner || getAgentGaii();
        return owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
    };
    const errText = (e: unknown): string =>
        e instanceof ContactsError ? e.message : ((e as Error)?.message || 'Contacts operation failed');

    // ── aimeat_contact_list — the owner's merged address book ──
    mcp.tool(
        'aimeat_contact_list',
        descriptionFor('aimeat_contact_list'),
        {
            q: z.string().optional().describe('Filter by id, name or email (case-insensitive substring)'),
            state: z.enum(['pending', 'accepted', 'blocked']).optional().describe('Narrow to one consent state (default hides blocked; only identities have one)'),
        },
        annotationsFor('aimeat_contact_list'),
        async ({ q, state }) => {
            const { contacts, truncated } = await listContactsMerged(storage, ownerGhii(), { q, state });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ contacts, total: contacts.length, truncated }, null, 2) }] };
        },
    );

    // ── aimeat_contact_add — save an identity, or a person with no account here ──
    mcp.tool(
        'aimeat_contact_add',
        descriptionFor('aimeat_contact_add'),
        {
            contact_id: z.string().optional().describe('An identity: bare local owner name, GHII (owner@node), GAII (agent#owner@node), or GEAI (eco:app#owner@node)'),
            name: z.string().max(140).optional().describe("A person's name, as the owner would write it (with email)"),
            email: z.string().max(200).optional().describe("A person's email address (with name) — also what links them to an account if they join later"),
            note: z.string().max(1000).optional().describe('Anything worth remembering about this person'),
            tags: z.array(z.string().max(40)).max(20).optional().describe("The owner's own labels"),
            links: z.array(LinkSchema).max(12).optional().describe('Where else this person is'),
            relation: z.string().max(40).optional().describe("The owner's own word for the relationship"),
        },
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
                return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
            }
        },
    );

    // ── aimeat_contact_remove — remove from the address book (never resets the DM gate) ──
    mcp.tool(
        'aimeat_contact_remove',
        descriptionFor('aimeat_contact_remove'),
        {
            contact_id: z.string().describe('The contact id to remove (as returned by aimeat_contact_list)'),
        },
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
    mcp.tool(
        'aimeat_contact_resolve_email',
        descriptionFor('aimeat_contact_resolve_email'),
        {
            email: z.string().describe('Email address to look up (exact match only)'),
        },
        annotationsFor('aimeat_contact_resolve_email'),
        async ({ email }) => {
            try {
                const result = await resolveContactEmail(storage, email);
                return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
            }
        },
    );
}
