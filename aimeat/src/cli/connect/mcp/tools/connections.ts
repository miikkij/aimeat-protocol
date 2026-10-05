/**
 * @file connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for outbound connections and mail — parity with the
 *   server MCP (src/mcp/connections.ts), so `aimeat connect serve --surface agent` exposes the same
 *   seven tools locally. Thin proxies over the shared REST routes, so both surfaces behave
 *   identically and neither can drift into being the permissive one.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 -- 2026-09-28 -- aimeat_mail_read takes store, filename, mime_type and key: the attachment
 *     is stored as a private file and the answer names it.
 *   v1.2.0 -- 2026-09-13 --aimeat_mail_send also reads the SEND_FAILED error (502 or 503) a current
 *     node answers for a send that did not go out, through refuseUnsentSend(), and names the send-log
 *     id and the reason whichever node answered.
 *   v1.1.0 -- 2026-09-13 -- aimeat_mail_send returns an error result when the node says the send did
 *     not go out, through refuseUnsentSend() from the CLI dispatch. The 200 envelope used to pass
 *     through as a success.
 *   v1.0.0 -- 2026-08-26 -- Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { refuseUnsentSend } from '../../../../tool-dispatch/tool-call-defs-connections.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerConnectionTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_connection_providers', descriptionFor('aimeat_connection_providers'), zodShapeFor('aimeat_connection_providers'),
    annotationsFor('aimeat_connection_providers'),
    async () => out(await client.get('/v1/connections/providers')));

  mcp.tool('aimeat_connection_list', descriptionFor('aimeat_connection_list'), zodShapeFor('aimeat_connection_list'),
    annotationsFor('aimeat_connection_list'),
    async () => out(await client.get('/v1/connections')));

  mcp.tool('aimeat_connection_start', descriptionFor('aimeat_connection_start'), zodShapeFor('aimeat_connection_start'), annotationsFor('aimeat_connection_start'), async ({ provider, instance, return_url }) => out(
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

  mcp.tool('aimeat_mail_search', descriptionFor('aimeat_mail_search'), zodShapeFor('aimeat_mail_search'), annotationsFor('aimeat_mail_search'), async ({ connection_id, query, limit, page_token }) => out(
    await read(connection_id, 'messages', {
      ...(query ? { query } : {}),
      ...(limit ? { limit } : {}),
      ...(page_token ? { page_token } : {}),
    }),
  ));

  mcp.tool('aimeat_mail_read', descriptionFor('aimeat_mail_read'), zodShapeFor('aimeat_mail_read'), annotationsFor('aimeat_mail_read'), async ({ connection_id, message_id, attachment_id, store, filename, mime_type, key }) => out(
    attachment_id
      ? await read(connection_id, 'attachment', {
        message_id, attachment_id,
        ...(store === true ? { store: true } : {}),
        ...(filename ? { filename } : {}),
        ...(mime_type ? { mime_type } : {}),
        ...(key ? { key } : {}),
      })
      : await read(connection_id, 'message', { id: message_id }),
  ));

  mcp.tool('aimeat_mail_aliases', descriptionFor('aimeat_mail_aliases'), zodShapeFor('aimeat_mail_aliases'), annotationsFor('aimeat_mail_aliases'), async ({ connection_id }) => out(
    await read(connection_id, 'sendAs', {}),
  ));

  mcp.tool('aimeat_mail_send', descriptionFor('aimeat_mail_send'), zodShapeFor('aimeat_mail_send'), annotationsFor('aimeat_mail_send'), async ({ contact_id, subject, body, connection_id, from_alias, kind, reply_to, ai_disclosure, theme }) => out(
    // The outbound door, not around it: every gate lives behind this one route. A send that did not
    // go out is SEND_FAILED from a current node (502 or 503) and a 200 'failed' from an older one;
    // refuseUnsentSend makes both the same error result the CLI dispatch returns.
    refuseUnsentSend(await client.post('/v1/outbound/send', {
      contact_id, subject, body,
      kind: kind ?? 'transactional',
      ...(connection_id ? { connection_id } : {}),
      ...(from_alias ? { from_alias } : {}),
      ...(reply_to ? { reply_to } : {}),
      ...(ai_disclosure ? { ai_disclosure } : {}),
      ...(theme ? { theme } : {}),
    })),
  ));
}
