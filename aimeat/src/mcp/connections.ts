/**
 * @file src/mcp/connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for outbound connections and mail.
 *
 *   WHY THIS FILE EXISTS. The whole connections subsystem — the authorization round, the sealed
 *   credential, the refresh, the read direction, and now sending — was reachable only over REST and
 *   from the browser panel. On a node whose stated posture is that AI chat is the primary interface
 *   and MCP the preferred road in, a capability an agent cannot reach is a capability that is not
 *   finished.
 *
 *   THEY HOLD NO LOGIC OF THEIR OWN. Each one calls the same service function the REST route calls,
 *   so the access check, the resource allowlist and the outbound policy chain cannot answer
 *   differently on one door than on the other.
 *
 *   A CONNECTION BELONGS TO THE EXACT PRINCIPAL, and for an agent that is its own GAII, never its
 *   owner's GHII. So an agent does NOT inherit the mailbox its owner connected in the web panel: it
 *   starts its own authorization, a human completes the consent screen in a browser, and the
 *   resulting connection is the agent's. That is more friction than inheriting, and it is the right
 *   amount: a mailbox is the most private thing on this node, and "every agent this person ever
 *   connects can read their mail" is not a permission anyone knowingly grants.
 * @structure registerConnectionTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage registerConnectionTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { buildOutboundProviders, listProviderMeta } from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { startAuthorization, type ConnectContext } from '../services/connections/oauth.js';
import { readResource } from '../services/connections/read.js';
import { listSendAsAliases } from '../services/connections/send-mail.js';
import { listOwnConnections, requireOwnConnection } from '../services/connections/access.js';
import { sendOutbound, OutboundError } from '../services/outbound/outbound-service.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function registerConnectionTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    scopes: string[],
): void {
    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

    const providers = buildOutboundProviders(config);
    /** An agent's connections are its OWN. resolveIdentity returns `sub` for an agent session. */
    const principal = (): string => getAgentGaii();

    /**
     * The service context, or the reason there is none.
     *
     * A missing encryption key is a hard stop rather than a degraded mode, the same answer the REST
     * door gives: storing or opening somebody's token without a key is worse than refusing.
     */
    const ctx = (): ConnectContext | { error: string } => {
        const key = requireEncryptionKey(config);
        if (!key) {
            return { error: 'This node is not set up to keep secrets safely yet, so it cannot open a connected account. Whoever runs it can switch that on.' };
        }
        return { config, storage, providers, key };
    };

    const capabilityOff = (): string | null => config.connectionsEnabled
        ? null
        : 'Connecting outside accounts is switched off on this node (AIMEAT_CONNECTIONS_ENABLED). Whoever runs it can turn it on.';

    // ── Discovery ───────────────────────────────────────────────────────────────────────────────

    mcp.tool('aimeat_connection_providers', descriptionFor('aimeat_connection_providers'),
        {},
        annotationsFor('aimeat_connection_providers'),
        async (): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            // The same projection the REST door serves: no credentials, and none of the provider's
            // own scope vocabulary, which an agent could not interpret anyway.
            return ok({ providers: listProviderMeta(providers) });
        });

    mcp.tool('aimeat_connection_list', descriptionFor('aimeat_connection_list'),
        {},
        annotationsFor('aimeat_connection_list'),
        async (): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            // The same service the REST door calls, so neither can list what the other would not.
            return ok({ connections: await listOwnConnections(storage, principal()) });
        });

    // ── Connecting ──────────────────────────────────────────────────────────────────────────────

    mcp.tool('aimeat_connection_start', descriptionFor('aimeat_connection_start'),
        {
            provider: z.string().describe("Which service, from aimeat_connection_providers (e.g. 'google-mail')."),
            instance: z.string().optional().describe('Only for a federated provider like Mastodon: the server address.'),
            return_url: z.string().optional().describe('Where the browser lands after the person approves.'),
        },
        annotationsFor('aimeat_connection_start'),
        async ({ provider, instance, return_url }): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            const c = ctx();
            if ('error' in c) return fail(c.error);
            const result = await startAuthorization(c, {
                principal: principal(),
                provider,
                ...(instance ? { instance } : {}),
                // Personal: this account is the agent's own, not a channel shared with an app.
                mode: 'personal',
                returnUrl: return_url ?? '',
            });
            if (!result.ok) return fail(`${result.code}: ${result.reason}`);
            return ok({
                authorize_url: result.authorizeUrl,
                // Said plainly because it is the part an agent gets wrong: this cannot be completed
                // by fetching the URL. A PERSON opens it, sees exactly what is being asked for, and
                // approves it at the provider. The connection appears in aimeat_connection_list
                // afterwards.
                next: 'Give this address to the person and ask them to open it. They approve it at the provider; nothing here can approve it for them. When they have, the connection shows up in aimeat_connection_list.',
            });
        });

    // ── Reading mail ────────────────────────────────────────────────────────────────────────────

    /** One place that turns a read refusal into a sentence, so both mail tools fail alike. */
    const readVia = async (
        connectionId: string, resource: string, params: Record<string, unknown>,
    ): Promise<TextResult> => {
        const off = capabilityOff();
        if (off) return fail(off);
        const c = ctx();
        if ('error' in c) return fail(c.error);
        // Absent and not-yours answer alike, as everywhere else in this feature: naming another
        // principal's connection must not confirm that it exists. The rule is the service's, not
        // this door's.
        const conn = await requireOwnConnection(storage, principal(), connectionId);
        if (!conn) return fail('NOT_FOUND: no such connection of yours.');
        const out = await readResource(c, conn.id, resource, params);
        if (!out.ok) return fail(`${out.code}: ${out.message}`);
        return ok({ provider: out.provider, resource: out.resource, data: out.data });
    };

    mcp.tool('aimeat_mail_search', descriptionFor('aimeat_mail_search'),
        {
            connection_id: z.string().describe('Which connected mailbox, from aimeat_connection_list.'),
            query: z.string().optional().describe("The provider's own search, e.g. 'from:lasku@example.com has:attachment newer_than:90d'."),
            limit: z.number().optional().describe('How many, default 25, max 100.'),
            page_token: z.string().optional().describe('Continue a previous search.'),
        },
        annotationsFor('aimeat_mail_search'),
        async ({ connection_id, query, limit, page_token }): Promise<TextResult> => readVia(
            connection_id, 'messages',
            {
                ...(query ? { query } : {}),
                ...(limit ? { limit } : {}),
                ...(page_token ? { page_token } : {}),
            },
        ));

    mcp.tool('aimeat_mail_read', descriptionFor('aimeat_mail_read'),
        {
            connection_id: z.string().describe('Which connected mailbox.'),
            message_id: z.string().describe('The message, from aimeat_mail_search.'),
            attachment_id: z.string().optional().describe('Fetch one attachment instead of the message.'),
        },
        annotationsFor('aimeat_mail_read'),
        async ({ connection_id, message_id, attachment_id }): Promise<TextResult> => (
            attachment_id
                // Fetched only when asked for: an attachment is a real download against the
                // person's own allowance, and most of the time the answer is in the text.
                ? readVia(connection_id, 'attachment', { message_id, attachment_id })
                : readVia(connection_id, 'message', { id: message_id })
        ));

    mcp.tool('aimeat_mail_aliases', descriptionFor('aimeat_mail_aliases'),
        { connection_id: z.string().describe('A connected Gmail mailbox.') },
        annotationsFor('aimeat_mail_aliases'),
        async ({ connection_id }): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            const c = ctx();
            if ('error' in c) return fail(c.error);
            const res = await listSendAsAliases(c, principal(), connection_id);
            if ('code' in res) return fail(`${res.code}: ${res.message}`);
            return ok(res);
        });

    // ── Sending ─────────────────────────────────────────────────────────────────────────────────
    //
    // TWO WORDS, AND THE TOOL IS ABSENT WITHOUT BOTH. `outbound:send` is permission to send in the
    // owner's name; using their connected MAILBOX is the separate thing `connections:use` governs.
    // Registering it for a session holding only one would put a control on the surface whose only
    // possible answer is a refusal — the same "advertised but unusable" mistake LinkedIn's absent
    // read-metrics capability exists to avoid.
    if (scopeIsCovered(scopes, 'outbound:send') && scopeIsCovered(scopes, 'connections:use')) {
        mcp.tool('aimeat_mail_send', descriptionFor('aimeat_mail_send'),
            {
                contact_id: z.string().describe('A saved recipient, from aimeat_contact_list. Never a free address.'),
                subject: z.string().describe('The subject line.'),
                body: z.string().describe('The message, as plain text. The server renders and escapes it.'),
                connection_id: z.string().optional().describe('Send through this connected mailbox of yours, so it leaves from your own address.'),
                from_alias: z.string().optional().describe('A verified alias of that mailbox to send as.'),
                kind: z.enum(['transactional', 'marketing']).optional().describe("Default 'transactional'. 'marketing' is blocked by an opt-out and carries the unsubscribe link."),
                reply_to: z.string().optional().describe('Where a reply should go, when it is not the sending address.'),
                ai_disclosure: z.enum(['none', 'ai-assisted', 'ai-generated', 'autonomous']).optional()
                    .describe("Say in a header that a machine wrote this. If YOU wrote the body, declare it: 'ai-generated' when you produced the text, 'ai-assisted' when a person wrote it and you edited. Optional, because the law does not oblige it for a message to one customer, and it goes in a header rather than the text because the audience for it is machines."),
            },
            annotationsFor('aimeat_mail_send'),
            async ({ contact_id, subject, body, connection_id, from_alias, kind, reply_to, ai_disclosure }): Promise<TextResult> => {
                try {
                    // THE OUTBOUND DOOR, NOT AROUND IT. Saved contact, suppression, opt-out, the
                    // daily allowance, the unsubscribe link and the append-only log all happen in
                    // there, once, for every door.
                    const result = await sendOutbound(config, storage, principal(), {
                        contactId: contact_id,
                        kind: kind ?? 'transactional',
                        subject, body,
                        ...(connection_id ? { connectionId: connection_id } : {}),
                        ...(from_alias ? { fromAlias: from_alias } : {}),
                        ...(reply_to ? { replyTo: reply_to } : {}),
                        ...(ai_disclosure ? { aiDisclosure: { level: ai_disclosure } } : {}),
                    });
                    return ok({
                        status: result.status, channel: result.channel, message_id: result.log.id,
                        // A 200 is not a delivery, and saying so here is cheaper than the appdev
                        // pitfall that already exists for callers who assumed it was.
                        note: result.status === 'sent'
                            ? 'Handed over to the provider. Delivery is theirs from here; a bounce shows up on the contact.'
                            : `Not sent: ${result.log.error ?? result.status}.`,
                    });
                } catch (err) {
                    if (err instanceof OutboundError) return fail(`${err.code}: ${err.message}`);
                    throw err;
                }
            });
    }
}
