/**
 * @file contacts.ts
 * @description Connector MCP registrations for the OWNER's contacts (address book) — parity with the
 *   server MCP (src/mcp/contacts.ts) so `aimeat connect serve --surface agent` exposes list/add/remove/
 *   resolve_email locally. Thin proxies over the shared /v1/contacts routes (owner-role), so both
 *   surfaces behave identically.
 * @version-history
 *   v1.0.0 -- 2026-07-19 -- Initial: contact list/add/remove/resolve_email — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerContactTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_contact_list', descriptionFor('aimeat_contact_list'), {
    q: z.string().optional().describe('Filter by id/display name (case-insensitive substring).'),
    state: z.enum(['pending', 'accepted', 'blocked']).optional().describe('Narrow to one consent state.'),
  }, annotationsFor('aimeat_contact_list'), async ({ q, state }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    const qs = params.toString();
    return out(await client.get(`/v1/contacts${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_contact_add', descriptionFor('aimeat_contact_add'), {
    contact_id: z.string().describe('Bare owner name, GHII, GAII, or GEAI.'),
  }, annotationsFor('aimeat_contact_add'), async ({ contact_id }) => {
    return out(await client.post('/v1/contacts', { contact_id }));
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
