/**
 * @file contacts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the OWNER's contacts (address book) — parity with the
 *   server MCP (src/mcp/contacts.ts) so `aimeat connect serve --surface agent` exposes list/add/remove/
 *   resolve_email locally. Thin proxies over the shared /v1/contacts routes (owner-role), so both
 *   surfaces behave identically.
 * @version-history
 *   v1.1.0 -- 2026-08-17 -- TARGET-063: aimeat_contact_add takes name + email (a person with no
 *     account on this node) beside contact_id, matching the server MCP parameter for parameter.
 *     A parameter that exists on one surface and not the other is dropped in silence, which is
 *     the defect check:mcp-schemas was written to catch.
 *   v1.0.0 -- 2026-07-19 -- Initial: contact list/add/remove/resolve_email — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

/** The link shape both MCP surfaces accept, declared the same way on each. */
const LinkSchema = z.object({
  label: z.string().max(60).optional().describe('What to call this place.'),
  url: z.string().max(500).describe('http(s) address.'),
});

export function registerContactTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_contact_list', descriptionFor('aimeat_contact_list'), {
    q: z.string().optional().describe('Filter by id, name or email (case-insensitive substring).'),
    state: z.enum(['pending', 'accepted', 'blocked']).optional().describe('Narrow to one consent state.'),
  }, annotationsFor('aimeat_contact_list'), async ({ q, state }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    const qs = params.toString();
    return out(await client.get(`/v1/contacts${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_contact_add', descriptionFor('aimeat_contact_add'), {
    contact_id: z.string().optional().describe('An identity: bare owner name, GHII, GAII, or GEAI.'),
    name: z.string().max(140).optional().describe("A person's name, as the owner would write it (with email)."),
    email: z.string().max(200).optional().describe("A person's email address (with name)."),
    note: z.string().max(1000).optional().describe('Anything worth remembering about this person.'),
    tags: z.array(z.string().max(40)).max(20).optional().describe("The owner's own labels."),
    links: z.array(LinkSchema).max(12).optional().describe('Where else this person is.'),
    relation: z.string().max(40).optional().describe("The owner's own word for the relationship."),
  }, annotationsFor('aimeat_contact_add'), async ({ contact_id, name, email, note, tags, links, relation }) => {
    // Every declared parameter is forwarded. The route decides which shape it is, so this surface
    // never has to hold a second opinion about what a contact is.
    return out(await client.post('/v1/contacts', { contact_id, name, email, note, tags, links, relation }));
  });

  mcp.tool('aimeat_contact_remove', descriptionFor('aimeat_contact_remove'), {
    contact_id: z.string().describe('The contact id to remove.'),
  }, annotationsFor('aimeat_contact_remove'), async ({ contact_id }) => {
    return out(await client.delete(`/v1/contacts/${encodeURIComponent(contact_id)}`));
  });

  mcp.tool('aimeat_contact_resolve_email', descriptionFor('aimeat_contact_resolve_email'), {
    email: z.string().describe('Email address to look up (exact match only).'),
  }, annotationsFor('aimeat_contact_resolve_email'), async ({ email }) => {
    return out(await client.post('/v1/contacts/resolve', { email }));
  });
}
