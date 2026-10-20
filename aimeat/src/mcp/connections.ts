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
 *   connects can read their mail" is not a permission anyone knowingly grants. So reading the OWNER's
 *   connected mailbox is a word of its own, connections:read-as-owner, outside every wildcard; naming
 *   the owner's connections and sending through them ride connections:use, as on REST
 *   (services/connections/access.ts connectionHoldersOf; feature-list audit 128).
 * @structure registerConnectionTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage registerConnectionTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-17 — aimeat_mail_send has no guard of its own: the registration gate decides from its
 *     catalog words, so a person can allow it with one press (mcp/permission-ask-gate.ts).
 *   2026-10-16 — The READ_AS_OWNER_REQUIRED refusal is readAsOwnerRefusal (services/connections/access.ts),
 *     the decision and sentence the REST read route answers too (Jouni, 2026-10-16).
 *   2026-10-16 — aimeat_mail_send takes locale, image_url and image_alt, as POST /v1/outbound/send does.
 *   2026-10-16 — aimeat_connection_history and aimeat_connection_replies read the owner's published
 *     items on connections:read-as-owner, through the same holders as the mail tools (Jouni, 2026-10-16).
 *   2026-10-16 — A read of the owner's mailbox by an agent that may name it but lacks
 *     connections:read-as-owner answers READ_AS_OWNER_REQUIRED, naming the permission, instead of
 *     "no such connection" for a connection aimeat_connection_list had just shown it (QA audit F12b-02).
 *   2026-10-15 — The owner's connections: aimeat_connection_list names them on connections:use, the read
 *     tools read them on connections:read-as-owner (connectionHoldersOf), and aimeat_mail_send sends from
 *     the owner's address book and mailbox as POST /v1/outbound/send does (feature-list audit 128-130).
 *   v1.6.0 — 2026-10-15 — aimeat_connection_history (services/connections/history.ts
 *     listPublishHistory) and aimeat_connection_replies (repliesForAttempt, failures through toolError);
 *     aimeat_connection_start passes account (which Facebook Page) to startAuthorization.
 *   v1.5.0 — 2026-10-09 — aimeat_connection_start hands back the node's confirmation page, where the
 *     owner confirms the round in their own browser, never the provider's address (secrets audit
 *     2026-10-09, chapter 2).
 *   2026-10-08 — aimeat_mail_send takes ai_provenance_id beside ai_disclosure and answers with the
 *     record the message carries (aiprov D9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.4.0 — 2026-09-28 — aimeat_mail_read takes store (with filename, mime_type, key): the attachment
 *     becomes a private file up to the node's per-file limit, through services/connections/attachment-store.ts.
 *   v1.3.0 — 2026-09-25 —aimeat_mail_send leaves out the `channel`, on a send and on a refusal: it
 *     says whether the address has an account here, which only the owner in person reads.
 *   v1.2.0 — 2026-09-13 — aimeat_mail_send reads the failed send from the SEND_FAILED error
 *     sendOutbound now throws (the REST route answers the same error with 502 or 503), and returns
 *     its code, the send-log row and the reason. A suppressed or opted-out recipient names its
 *     logged row the same way. The tool's answers are otherwise unchanged.
 *   v1.1.0 — 2026-09-13 — aimeat_mail_send returns an error result when the send did not go out
 *     (the provider refused it, or the node had no transport), with the reason and the send-log id.
 *     It used to return a success result with a "Not sent" note, which an agent reported as sent.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { buildOutboundProviders, listProviderMeta } from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { startAuthorization, type ConnectContext } from '../services/connections/oauth.js';
import { readResource } from '../services/connections/read.js';
import { storeMailAttachment, type StoreAttachmentInput } from '../services/connections/attachment-store.js';
import { emitResourceUpdated, emitResourceListChanged } from './resource-events.js';
import { listSendAsAliases } from '../services/connections/send-mail.js';
import { connectionHoldersOf, listUsableConnections, requireUsableConnection, mailboxHolderFor, readAsOwnerRefusal } from '../services/connections/access.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { sendOutbound, OutboundError } from '../services/outbound/outbound-service.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { listPublishHistory, repliesForAttempt } from '../services/connections/history.js';
import { toolError } from './tool-error.js';

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
    /** Whose connections this session may name or read: its own, and its owner's on the words for it
     *  (services/connections/access.ts connectionHoldersOf; feature-list audit 128). */
    const holders = (purpose: 'name' | 'read'): string[] =>
        connectionHoldersOf(principal(), ownerGhiiOf(principal()), scopes, purpose);

    /**
     * The refusal for a connection this session may not read. When aimeat_connection_list already
     * names it to this session (the owner's mailbox, listed on connections:use), "no such connection"
     * is not true, and an agent told so stops instead of asking its owner for the permission. So that
     * case names the missing word and where the owner gives it; it discloses nothing the list did not.
     * Every other case keeps `fallback`, where absent and not-yours answer alike.
     */
    const unreadable = async (connectionId: string, fallback: string): Promise<TextResult> => {
        // The decision POST /v1/connections/:id/read/:resource asks too (services/connections/access.ts).
        const refusal = await readAsOwnerRefusal(storage, principal(), ownerGhiiOf(principal()), scopes, connectionId);
        if (refusal) return toolError(refusal.code, refusal.message);
        return fail(fallback);
    };

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

    const connectionsOffReason = 'Connecting outside accounts is switched off on this node (AIMEAT_CONNECTIONS_ENABLED). Whoever runs it can turn it on.';
    const capabilityOff = (): string | null => config.connectionsEnabled ? null : connectionsOffReason;

    // ── Discovery ───────────────────────────────────────────────────────────────────────────────

    mcp.registerTool('aimeat_connection_providers', { description: descriptionFor('aimeat_connection_providers'),
        inputSchema: zodShapeFor('aimeat_connection_providers'),
        annotations: annotationsFor('aimeat_connection_providers') },
        async (): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            // The same projection the REST door serves: no credentials, and none of the provider's
            // own scope vocabulary, which an agent could not interpret anyway.
            return ok({ providers: listProviderMeta(providers) });
        });

    mcp.registerTool('aimeat_connection_list', { description: descriptionFor('aimeat_connection_list'),
        inputSchema: zodShapeFor('aimeat_connection_list'),
        annotations: annotationsFor('aimeat_connection_list') },
        async (): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            // The same service the REST door calls, so neither can list what the other would not.
            return ok({ connections: await listUsableConnections(storage, holders('name')) });
        });

    // ── Connecting ──────────────────────────────────────────────────────────────────────────────

    mcp.registerTool('aimeat_connection_start', { description: descriptionFor('aimeat_connection_start'),
        inputSchema: zodShapeFor('aimeat_connection_start'),
        annotations: annotationsFor('aimeat_connection_start') },
        async ({ provider, instance, return_url, account }): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            const c = ctx();
            if ('error' in c) return fail(c.error);
            const result = await startAuthorization(c, {
                principal: principal(),
                provider,
                ...(instance ? { instance } : {}),
                // Which Facebook Page, when the sign-in reaches several; the service only chooses
                // among the pages the provider lists for this person.
                ...(account ? { account } : {}),
                // Personal: this account is the agent's own, not a channel shared with an app.
                mode: 'personal',
                returnUrl: return_url ?? '',
            });
            if (!result.ok) return fail(`${result.code}: ${result.reason}`);
            return ok({
                // The node's confirmation page, never the provider's address: a session here is not
                // the owner's browser, so the round waits until the owner signs in on that page and
                // confirms it (secrets audit 2026-10-09, chapter 2). Whoever approved the provider's
                // address without that step would connect THEIR account to this principal.
                authorize_url: result.approvalUrl,
                owner_confirms: true,
                // Said plainly because it is the part an agent gets wrong: this cannot be completed
                // by fetching the URL. A PERSON opens it, sees exactly what is being asked for, and
                // approves it. The connection appears in aimeat_connection_list afterwards.
                next: 'Give this address to your owner and ask them to open it. They sign in to this node, confirm, and approve it at the provider; nothing here can approve it for them. When they have, the connection shows up in aimeat_connection_list.',
            });
        });

    // ── What was published, and what came back ──────────────────────────────────────────────────
    //
    // Both call services/connections/history.ts, the functions GET /v1/connections/attempts and
    // POST /v1/connections/attempts/:id/replies call, so the ownership check is the same on every
    // interface: an item of somebody else's answers NOT_FOUND like one that never existed. The
    // owner's items are read on connections:read-as-owner, as the mail tools read the owner's mail.

    mcp.registerTool('aimeat_connection_history', { description: descriptionFor('aimeat_connection_history'),
        inputSchema: zodShapeFor('aimeat_connection_history'),
        annotations: annotationsFor('aimeat_connection_history') },
        async ({ limit }): Promise<TextResult> => {
            if (!config.connectionsEnabled) return toolError('CONNECTIONS_DISABLED', connectionsOffReason);
            return ok({ attempts: await listPublishHistory(storage, holders('read'), limit ?? 50) });
        });

    mcp.registerTool('aimeat_connection_replies', { description: descriptionFor('aimeat_connection_replies'),
        inputSchema: zodShapeFor('aimeat_connection_replies'),
        annotations: annotationsFor('aimeat_connection_replies') },
        async ({ attempt_id, limit }): Promise<TextResult> => {
            if (!config.connectionsEnabled) return toolError('CONNECTIONS_DISABLED', connectionsOffReason);
            const c = ctx();
            if ('error' in c) return toolError('NO_ENCRYPTION_KEY', c.error);
            // Read from the provider now; nothing is stored. The route's 409 NOT_READABLE and 502
            // REPLIES_UNAVAILABLE arrive here as the same codes.
            const out = await repliesForAttempt(c, holders('read'), attempt_id, limit);
            if (!out.ok) return toolError(out.code, out.reason);
            // The same fields the REST route answers in `data`.
            return ok({
                attemptId: out.attemptId, provider: out.provider, url: out.url,
                replies: out.replies, truncated: out.truncated,
                ...(out.note ? { note: out.note } : {}),
                fetchedAt: out.fetchedAt,
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
        const conn = await requireUsableConnection(storage, holders('read'), connectionId);
        if (!conn) return unreadable(connectionId, 'NOT_FOUND: no such connection of yours.');
        const out = await readResource(c, conn.id, resource, params);
        if (!out.ok) return fail(`${out.code}: ${out.message}`);
        return ok({ provider: out.provider, resource: out.resource, data: out.data });
    };

    /** The `store: true` branch of aimeat_mail_read: the same service POST /read/attachment calls. */
    const storeVia = async (connectionId: string, input: StoreAttachmentInput): Promise<TextResult> => {
        const off = capabilityOff();
        if (off) return fail(off);
        if (!scopeIsCovered(scopes, 'storage:write')) {
            return fail('SCOPE_DENIED: storing an attachment writes a file, which needs the storage:write permission. Read it without store, or ask the owner for that permission.');
        }
        const c = ctx();
        if ('error' in c) return fail(c.error);
        const conn = await requireUsableConnection(storage, holders('read'), connectionId);
        if (!conn) return unreadable(connectionId, 'NOT_FOUND: no such connection of yours.');
        const out = await storeMailAttachment(c, { storage, config, emitResourceUpdated, emitResourceListChanged },
            principal(), conn.id, input);
        if (!out.ok) return fail(`${out.code}: ${out.message}`);
        return ok({ provider: out.provider, resource: 'attachment', stored: { key: out.key, filename: out.filename, mime_type: out.mime_type, size: out.size } });
    };

    mcp.registerTool('aimeat_mail_search', { description: descriptionFor('aimeat_mail_search'),
        inputSchema: zodShapeFor('aimeat_mail_search'),
        annotations: annotationsFor('aimeat_mail_search') },
        async ({ connection_id, query, limit, page_token }): Promise<TextResult> => readVia(
            connection_id, 'messages',
            {
                ...(query ? { query } : {}),
                ...(limit ? { limit } : {}),
                ...(page_token ? { page_token } : {}),
            },
        ));

    mcp.registerTool('aimeat_mail_read', { description: descriptionFor('aimeat_mail_read'),
        inputSchema: zodShapeFor('aimeat_mail_read'),
        annotations: annotationsFor('aimeat_mail_read') },
        async ({ connection_id, message_id, attachment_id, store, filename, mime_type, key }): Promise<TextResult> => {
            if (attachment_id && store === true) return storeVia(connection_id, { message_id, attachment_id, filename, mime_type, key });
            return attachment_id
                // Fetched only when asked for: an attachment is a real download against the
                // person's own allowance, and most of the time the answer is in the text.
                ? readVia(connection_id, 'attachment', { message_id, attachment_id })
                : readVia(connection_id, 'message', { id: message_id });
        });

    mcp.registerTool('aimeat_mail_aliases', { description: descriptionFor('aimeat_mail_aliases'),
        inputSchema: zodShapeFor('aimeat_mail_aliases'),
        annotations: annotationsFor('aimeat_mail_aliases') },
        async ({ connection_id }): Promise<TextResult> => {
            const off = capabilityOff();
            if (off) return fail(off);
            const c = ctx();
            if ('error' in c) return fail(c.error);
            // The aliases are read from the mailbox, so the reading holders decide which one it may be.
            const conn = await requireUsableConnection(storage, holders('read'), connection_id);
            if (!conn) return unreadable(connection_id, 'NO_SUCH_MAILBOX: No connected mailbox with that id.');
            const res = await listSendAsAliases(c, conn.principal, connection_id);
            if ('code' in res) return fail(`${res.code}: ${res.message}`);
            return ok(res);
        });

    // ── Sending ─────────────────────────────────────────────────────────────────────────────────
    //
    // TWO WORDS. `outbound:send` is permission to send in the owner's name; using their connected
    // MAILBOX is the separate thing `connections:use` governs. Both are on the tool's catalog entry,
    // so the registration gate in mcp/index.ts decides as it does for every tool: allowed, listed for
    // the person to allow with one press (the call answers with the allow address,
    // mcp/permission-ask-gate.ts), or absent. Until 2026-10-17 this tool had its own guard here and
    // stayed absent while the person could have allowed it with one press.
    {
        mcp.registerTool('aimeat_mail_send', { description: descriptionFor('aimeat_mail_send'),
            inputSchema: zodShapeFor('aimeat_mail_send'),
            annotations: annotationsFor('aimeat_mail_send') },
            async ({ contact_id, subject, body, connection_id, from_alias, kind, reply_to, ai_disclosure, ai_provenance_id, theme, locale, image_url, image_alt }): Promise<TextResult> => {
                try {
                    // THE OUTBOUND DOOR, NOT AROUND IT. Saved contact, suppression, opt-out, the
                    // daily allowance, the unsubscribe link and the append-only log all happen in
                    // there, once, for every door.
                    // Only a send that went out comes back from here. One the channel refused, or one
                    // with no transport, is thrown as SEND_FAILED with the send-log row in details,
                    // the same error the REST route answers with 502 or 503.
                    // The owner's address book and the owner's mailbox, as POST /v1/outbound/send uses
                    // them on the same two words; the agent's own mailbox when it names one of its own.
                    // This used the agent's own book, so a contact the owner saved was not found
                    // (feature-list audit 129).
                    const result = await sendOutbound(config, storage, ownerGhiiOf(principal()), {
                        principal: principal(),
                        ...(connection_id ? { mailboxHolder: await mailboxHolderFor(storage, principal(), ownerGhiiOf(principal()), connection_id) } : {}),
                        contactId: contact_id,
                        kind: kind ?? 'transactional',
                        subject, body,
                        ...(connection_id ? { connectionId: connection_id } : {}),
                        ...(from_alias ? { fromAlias: from_alias } : {}),
                        ...(reply_to ? { replyTo: reply_to } : {}),
                        ...(ai_disclosure ? { aiDisclosure: { level: ai_disclosure, ...(ai_provenance_id ? { provenanceId: ai_provenance_id } : {}) } } : {}),
                        ...(theme ? { theme } : {}),
                        ...(locale ? { locale } : {}),
                        // The service refuses an image without alt text (INVALID_IMAGE), as the REST route does.
                        ...(image_url ? { image: { url: image_url, alt: image_alt ?? '' } } : {}),
                    });
                    // No `channel`: it says whether the address has an account here, which only the
                    // owner in person reads (routes/outbound.ts seesAccounts), and a tool session is
                    // always an agent.
                    return ok({
                        status: result.status, message_id: result.log.id,
                        ...(result.aiProvenanceId ? { ai_provenance_id: result.aiProvenanceId } : {}),
                        note: 'Handed over to the provider. Delivery is theirs from here; a bounce shows up on the contact.',
                    });
                } catch (err) {
                    if (!(err instanceof OutboundError)) throw err;
                    // A REFUSAL THAT WROTE A ROW NAMES IT. An agent reads isError, and a "Not sent"
                    // note inside a success result was reported to people as a sent message (appdev
                    // pitfall send-200-is-not-a-delivery). The fields are the ones the REST error
                    // carries in details, beside the code and the sentence, so every door says the
                    // same thing about the same attempt.
                    if (err.details) {
                        const details: Record<string, unknown> = { ...err.details };
                        delete details.channel;
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({ code: err.code, ...details, note: err.message }, null, 2),
                            }],
                            isError: true,
                        };
                    }
                    return fail(`${err.code}: ${err.message}`);
                }
            });
    }
}
