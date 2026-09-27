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
 *   v1.2.0 — 2026-09-13 — refuseUnsentSend() reads the SEND_FAILED error a current node answers
 *     (502 or 503, the send-log row in error.details) as well as an older node's 200 'failed', and
 *     returns both as the same error with message_id and reason at the top. The route's contract
 *     changed that day by the developer's decision; the connector still meets older nodes.
 *   v1.1.0 — 2026-09-13 — aimeat_mail_send answers ok:false with SEND_FAILED when the node says the
 *     send did not go out. The 200 envelope used to pass through, so a refused send read as success.
 *     refuseUnsentSend() is shared with the connector MCP door.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';
import type { ApiResponse } from './api-client.js';

/** The read direction names a RESOURCE; the node builds every URL from the parameters. */
const readPath = (connectionId: string, resource: string) =>
    `/v1/connections/${encodeURIComponent(connectionId)}/read/${encodeURIComponent(resource)}`;

/**
 * A send that did not go out, as one refusal whatever node answered it.
 *
 * A tool caller reads `ok`, and a provider refusal passed through as a success was reported as a sent
 * message (appdev pitfall send-200-is-not-a-delivery). Both connector doors, this dispatch and the
 * connector MCP, answer through here; the node MCP says the same thing from the service's error.
 *
 * TWO SHAPES ARRIVE, because this connector is installed on its own and talks to nodes of other
 * releases:
 *   - a node from 2026-09-13 on answers SEND_FAILED (HTTP 502 or 503) with the send-log id and the
 *     reason in `error.details`;
 *   - an older node answers 200 with `data.status` 'failed' and the reason in `data.message.error`.
 * Both come out as the same error, with `message_id`, `reason`, `status` and `channel` beside the code
 * and the sentence, so an agent reads one shape. Anything else, a sent outcome or a refusal that is
 * not about delivery, is handed back untouched.
 */
export function refuseUnsentSend(resp: ApiResponse): ApiResponse {
    if (!resp.ok) {
        const err = resp.error as { code?: unknown; message?: unknown; details?: unknown } | undefined;
        const details = err?.details as { message_id?: unknown; status?: unknown; channel?: unknown; reason?: unknown } | undefined;
        if (err?.code !== 'SEND_FAILED' || !details || typeof details !== 'object') return resp;
        const refusal = {
            code: 'SEND_FAILED',
            message: typeof err.message === 'string' ? err.message : 'Not sent. Nothing reached the recipient.',
            status: details.status,
            channel: details.channel,
            message_id: typeof details.message_id === 'string' ? details.message_id : null,
            reason: details.reason,
        };
        return { ok: false, error: refusal };
    }
    const data = resp.data as { status?: unknown; channel?: unknown; message?: { id?: unknown; error?: unknown } } | undefined;
    if (!data || typeof data.status !== 'string' || data.status === 'sent') return resp;
    const messageId = typeof data.message?.id === 'string' ? data.message.id : null;
    const reason = typeof data.message?.error === 'string' && data.message.error ? data.message.error : data.status;
    const refusal = {
        code: 'SEND_FAILED',
        message: `Not sent (${reason}). Nothing reached the recipient; the attempt is in the send log`
            + (messageId ? ` as ${messageId}.` : '.'),
        status: data.status,
        channel: data.channel,
        message_id: messageId,
        reason,
    };
    return { ok: false, error: refusal };
}

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
        // → POST /v1/outbound/send: the policied door, not around it. A send that did not go out
        //   comes back as SEND_FAILED from either node generation, through refuseUnsentSend.
        name: 'aimeat_mail_send',
        handler: async ({ client }, input) => {
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
            const theme = optionalString(input, 'theme'); if (theme) body.theme = theme;
            return refuseUnsentSend(await client.post('/v1/outbound/send', body));
        },
    },
];
