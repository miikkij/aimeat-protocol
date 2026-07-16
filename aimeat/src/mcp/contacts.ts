/**
 * @file contacts.ts
 * @description MCP tools for the OWNER's contacts (address book) — a thin layer over the shared
 *   core in services/contacts.ts (also behind the REST /v1/contacts routes, so both surfaces
 *   behave identically). The list merges saved contacts with DM conversation peers; save/remove
 *   never disturb the DM first-contact gate; email lookup is EXACT-match only (privacy-preserving
 *   hash — no enumeration). Contacts feed identity pickers: use a resolved/looked-up owner with
 *   aimeat_organism_invite / aimeat_organism_member_add / aimeat_workspace_member_grant.
 * @structure registerContactTools(mcp, storage, config, getAgentGaii) — registers
 *   aimeat_contact_list, aimeat_contact_add, aimeat_contact_remove, aimeat_contact_resolve_email.
 * @usage import { registerContactTools } from './contacts.js';
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: list/add/remove/resolve_email over the shared contacts core.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { ContactsError, listContactsMerged, saveContact, removeContact, resolveContactEmail } from '../services/contacts.js';

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
            q: z.string().optional().describe('Filter by id/display name (case-insensitive substring)'),
            state: z.enum(['pending', 'accepted', 'blocked']).optional().describe('Narrow to one consent state (default hides blocked)'),
        },
        annotationsFor('aimeat_contact_list'),
        async ({ q, state }) => {
            const contacts = await listContactsMerged(storage, ownerGhii(), { q, state });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ contacts, total: contacts.length }, null, 2) }] };
        },
    );

    // ── aimeat_contact_add — save a contact to the owner's address book ──
    mcp.tool(
        'aimeat_contact_add',
        descriptionFor('aimeat_contact_add'),
        {
            contact_id: z.string().describe('Bare local owner name, GHII (owner@node), GAII (agent#owner@node), or GEAI (eco:app#owner@node)'),
        },
        annotationsFor('aimeat_contact_add'),
        async ({ contact_id }) => {
            try {
                const contact = await saveContact(storage, config, ownerGhii(), contact_id);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'saved', contact }, null, 2) }] };
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
