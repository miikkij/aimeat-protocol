/**
 * @file cli/connect/tool-call-defs-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Outbound connections and mail, on the CLI dispatch — the door a fleet daemon
 *   actually calls (`/local/call/<tool>`), and the one a parameter added to the other two MCP
 *   surfaces has historically failed to reach.
 *
 *   Thin REST proxies over /v1/connections/* and /v1/outbound/send, so the manifest gate, the
 *   resource allowlist and the whole outbound policy chain are the node's answer here too. Nothing
 *   in this file decides anything.
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

/** The read direction names a RESOURCE; the node builds every URL from the parameters. */
const readPath = (connectionId: string, resource: string) =>
    `/v1/connections/${encodeURIComponent(connectionId)}/read/${encodeURIComponent(resource)}`;

export const connectionCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/connections/providers
        name: 'aimeat_connection_providers',
        handler: ({ client }) => client.get('/v1/connections/providers'),
    },
    {
        // → GET /v1/connections
        name: 'aimeat_connection_list',
        handler: ({ client }) => client.get('/v1/connections'),
    },
    {
        // → POST /v1/connections/start — returns an address a PERSON opens; nothing here can
        //   approve it, and fetching the address does nothing.
        name: 'aimeat_connection_start',
        handler: ({ client }, input) => client.post('/v1/connections/start', {
            provider: requiredString(input, 'provider'),
            mode: 'personal',
            ...(optionalString(input, 'instance') ? { instance: optionalString(input, 'instance') } : {}),
            ...(optionalString(input, 'return_url') ? { return_url: optionalString(input, 'return_url') } : {}),
        }),
    },
    {
        // → POST /v1/connections/:id/read/messages
        name: 'aimeat_mail_search',
        handler: ({ client }, input) => {
            const body: Record<string, unknown> = {};
            const q = optionalString(input, 'query'); if (q) body.query = q;
            const limit = optionalNumber(input, 'limit'); if (limit !== undefined) body.limit = limit;
            const page = optionalString(input, 'page_token'); if (page) body.page_token = page;
            return client.post(readPath(requiredString(input, 'connection_id'), 'messages'), body);
        },
    },
    {
        // → POST /v1/connections/:id/read/message, or .../attachment when one is named.
        name: 'aimeat_mail_read',
        handler: ({ client }, input) => {
            const connectionId = requiredString(input, 'connection_id');
            const messageId = requiredString(input, 'message_id');
            const attachmentId = optionalString(input, 'attachment_id');
            return attachmentId
                ? client.post(readPath(connectionId, 'attachment'), { message_id: messageId, attachment_id: attachmentId })
                : client.post(readPath(connectionId, 'message'), { id: messageId });
        },
    },
    {
        // → POST /v1/connections/:id/read/sendAs
        name: 'aimeat_mail_aliases',
        handler: ({ client }, input) => client.post(readPath(requiredString(input, 'connection_id'), 'sendAs'), {}),
    },
    {
        // → POST /v1/outbound/send — the policied door, not around it.
        name: 'aimeat_mail_send',
        handler: ({ client }, input) => {
            const body: Record<string, unknown> = {
                contact_id: requiredString(input, 'contact_id'),
                subject: requiredString(input, 'subject'),
                body: requiredString(input, 'body'),
                kind: optionalString(input, 'kind') || 'transactional',
            };
            const conn = optionalString(input, 'connection_id'); if (conn) body.connection_id = conn;
            const alias = optionalString(input, 'from_alias'); if (alias) body.from_alias = alias;
            const replyTo = optionalString(input, 'reply_to'); if (replyTo) body.reply_to = replyTo;
            const disc = optionalString(input, 'ai_disclosure'); if (disc) body.ai_disclosure = disc;
            return client.post('/v1/outbound/send', body);
        },
    },
];
