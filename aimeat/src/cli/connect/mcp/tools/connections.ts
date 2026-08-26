/**
 * @file connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for outbound connections and mail — parity with the
 *   server MCP (src/mcp/connections.ts), so `aimeat connect serve --surface agent` exposes the same
 *   seven tools locally. Thin proxies over the shared REST routes, so both surfaces behave
 *   identically and neither can drift into being the permissive one.
 * @version-history
 *   v1.0.0 -- 2026-08-26 -- Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerConnectionTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_connection_providers', descriptionFor('aimeat_connection_providers'), {},
    annotationsFor('aimeat_connection_providers'),
    async () => out(await client.get('/v1/connections/providers')));

  mcp.tool('aimeat_connection_list', descriptionFor('aimeat_connection_list'), {},
    annotationsFor('aimeat_connection_list'),
    async () => out(await client.get('/v1/connections')));

  mcp.tool('aimeat_connection_start', descriptionFor('aimeat_connection_start'), {
    provider: z.string().describe("Which service, exactly as aimeat_connection_providers names it."),
    instance: z.string().optional().describe('Only for a federated provider such as Mastodon.'),
    return_url: z.string().optional().describe('Where the browser lands after the person approves.'),
  }, annotationsFor('aimeat_connection_start'), async ({ provider, instance, return_url }) => out(
    await client.post('/v1/connections/start', {
      provider, mode: 'personal',
      ...(instance ? { instance } : {}),
      ...(return_url ? { return_url } : {}),
    }),
  ));

  // The read direction names a RESOURCE and supplies parameters; the node builds every URL. That
  // direction is the security property, so the connector proxies the same shape rather than
  // inventing a path of its own.
  const read = (connectionId: string, resource: string, params: Record<string, unknown>) =>
    client.post(`/v1/connections/${encodeURIComponent(connectionId)}/read/${encodeURIComponent(resource)}`, params);

  mcp.tool('aimeat_mail_search', descriptionFor('aimeat_mail_search'), {
    connection_id: z.string().describe('Which connected mailbox, from aimeat_connection_list.'),
    query: z.string().optional().describe("The provider's own search syntax."),
    limit: z.number().optional().describe('How many, default 25, max 100.'),
    page_token: z.string().optional().describe('Continue a previous search.'),
  }, annotationsFor('aimeat_mail_search'), async ({ connection_id, query, limit, page_token }) => out(
    await read(connection_id, 'messages', {
      ...(query ? { query } : {}),
      ...(limit ? { limit } : {}),
      ...(page_token ? { page_token } : {}),
    }),
  ));

  mcp.tool('aimeat_mail_read', descriptionFor('aimeat_mail_read'), {
    connection_id: z.string().describe('Which connected mailbox.'),
    message_id: z.string().describe('The message, from aimeat_mail_search.'),
    attachment_id: z.string().optional().describe('Fetch this attachment instead of the message body.'),
  }, annotationsFor('aimeat_mail_read'), async ({ connection_id, message_id, attachment_id }) => out(
    attachment_id
      ? await read(connection_id, 'attachment', { message_id, attachment_id })
      : await read(connection_id, 'message', { id: message_id }),
  ));

  mcp.tool('aimeat_mail_aliases', descriptionFor('aimeat_mail_aliases'), {
    connection_id: z.string().describe('A connected Gmail mailbox.'),
  }, annotationsFor('aimeat_mail_aliases'), async ({ connection_id }) => out(
    await read(connection_id, 'sendAs', {}),
  ));

  mcp.tool('aimeat_mail_send', descriptionFor('aimeat_mail_send'), {
    contact_id: z.string().describe('A saved recipient. Never a free address.'),
    subject: z.string().describe('The subject line.'),
    body: z.string().describe('The message as plain text; the server renders and escapes it.'),
    connection_id: z.string().optional().describe('Send through this connected mailbox of yours.'),
    from_alias: z.string().optional().describe('A verified alias of that mailbox to send as.'),
    kind: z.enum(['transactional', 'marketing']).optional().describe("Default 'transactional'."),
    reply_to: z.string().optional().describe('Where a reply should go.'),
  }, annotationsFor('aimeat_mail_send'), async ({ contact_id, subject, body, connection_id, from_alias, kind, reply_to }) => out(
    // The outbound door, not around it: every gate lives behind this one route.
    await client.post('/v1/outbound/send', {
      contact_id, subject, body,
      kind: kind ?? 'transactional',
      ...(connection_id ? { connection_id } : {}),
      ...(from_alias ? { from_alias } : {}),
      ...(reply_to ? { reply_to } : {}),
    }),
  ));
}
