/**
 * @file connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Outbound connections and mail: what this node can connect, what the caller has
 *   connected, how to start one, and reading and sending through a connected mailbox.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-09 — aimeat_connection_start says the address is the node's confirmation page (secrets audit 2026-10-09).
 *   2026-10-08 — aimeat_mail_send takes ai_provenance_id (aiprov D9).
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-09-28 — aimeat_mail_read takes store, filename, mime_type and key; the description
 *     no longer says the node reads an attached PDF on its own, because no code path did.
 *   v1.1.0 — 2026-09-13 —aimeat_mail_send says a send that did not go out comes back as an error
 *     with the provider's reason. It said a successful answer meant the provider accepted the
 *     message, which was false for a failed send, the one case that answered as a success.
 *   v1.0.0 — 2026-08-26 — Initial. The whole subsystem was REST-and-browser only until now, which
 *     on a node whose primary interface is AI chat meant a capability that was not finished.
 */

import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const connectionTools = [
    {
        name: 'aimeat_connection_providers',
        description: "Which outside services this node can connect an account at, and what each one is good for. Every entry says whether the NODE holds an application for it: when it does not, someone who brings their own app can still use it, so an absent registration removes an option from nobody. Read this before aimeat_connection_start, because the names are exact ('google-mail' reads Gmail, 'google-mail-send' sends from it) and mail deliberately comes in read/send PAIRS — reading a person's mail and writing in their name are different consent, and neither implies the other.",
        caller: 'agent',
        visibility: agentEverywhere,
        // openWorldHint is TRUE on every one of these that leaves the node: they reach a provider whose
        // answer this node does not control, and a caller planning a retry needs to know the difference
        // between "our store said no" and "Google said no".
        annotations: { title: 'Which Services Can Be Connected', readOnlyHint: true },
        // On `agent`: Outbound connections and mail, beside the address book because that is where they meet:
        // a send takes a saved contact, and a mailbox is what it can leave through. Scopes still
        // decide who sees which of them — reading the list of accounts, spending one, and sending
        // through one are three different words.
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_connection_list',
        description: "The outside accounts YOU have connected, with the id every other tool here takes. A connection belongs to the exact principal that made it, so this is yours and not your owner's: an account they connected in their own browser does not appear here, and that is deliberate — a mailbox is the most private thing on this node, and inheriting one silently is not a permission anybody knowingly grants. A connection that has stopped working carries what would repair it.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'My Connected Accounts', readOnlyHint: true },
        // Outbound connections, read side. `connections:read` is knowing WHAT you attached;
        // `connections:read-through` is reading what is IN one: the mailbox, its attachments, its send-as
        // addresses. It rode `connections:use`, the publish-and-send word, until 2026-09-24, so a grant
        // made for publishing opened the mail (security audit A5-1). Enforced identically on the REST
        // door, POST /v1/connections/:id/read/:resource, which the connector and CLI tools call.
        scope: 'connections:read',
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_connection_start',
        description: "Begin connecting an outside account. Returns an address for a PERSON to open: they see exactly what is being asked for and approve it at the provider, and nothing here can approve it for them — fetching the address yourself does nothing. Hand it over, say in one sentence what it is for and what it will and will not be able to do, and wait; the connection then appears in aimeat_connection_list. Worth saying to them, because it is the question they are actually asking: a read connection cannot send, delete or change anything, because those permissions are never requested. The address is this node's own confirmation page: the owner opens it signed in to this node, confirms, and goes on to the provider from there, so an approval given in anybody else's browser connects nothing.",
        caller: 'agent',
        visibility: agentEverywhere,
        // It creates a pending authorization, so it is not read-only; it is idempotent in the sense
        // that starting twice simply produces two addresses and connects nothing on its own.
        annotations: { title: 'Start Connecting an Account', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        // Outbound connections. Four words, and the distinction between them is the design: READING the
        // list of accounts you attached is knowing what you have, STARTING one is attaching another,
        // publishing and sending THROUGH one is `use`, and reading what is IN one is `read-through`. An
        // app granted the first, or the third, must not be able to open the mailbox.
        scope: 'connections:write',
        surfaces: ['agent'],
        input: {
            provider: { type: 'string', required: true, description: "Which service, exactly as aimeat_connection_providers names it (e.g. 'google-mail')." },
            instance: { type: 'string', description: 'Only for a federated provider such as Mastodon: the server address.' },
            return_url: { type: 'string', description: 'Where the browser lands after the person approves.' },
        },
    },
    {
        name: 'aimeat_mail_search',
        description: "Search a connected mailbox. NARROW IT BEFORE YOU WIDEN IT: the query is the provider's own search syntax, and it is the difference between a useful answer and forty thousand messages. Start with something you expect to return a handful, look at what came back, and tell the person what you found before reading hundreds of messages on their allowance. A search that returns nothing is a fact worth reporting, not a reason to re-run it wider without asking. Do NOT read a whole mailbox to see what is in it — ask what they are looking for. Gmail examples: 'from:lasku@example.com has:attachment newer_than:90d', 'subject:(kuitti OR receipt)'. Returns ids and headers; open one with aimeat_mail_read.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search a Connected Mailbox', readOnlyHint: true, openWorldHint: true },
        scope: 'connections:read-through',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected mailbox, from aimeat_connection_list.' },
            query: { type: 'string', description: "The provider's own search syntax." },
            limit: { type: 'number', description: 'How many, default 25, max 100.' },
            page_token: { type: 'string', description: 'Continue a previous search.' },
        },
    },
    {
        name: 'aimeat_mail_read',
        description: "Open one message from a connected mailbox, or fetch one of its attachments. A Gmail message arrives as a TREE of parts and the text is base64url, which is NOT base64: '-' for '+', '_' for '/', and the padding is often missing. Prefer text/plain and fall back to stripping the HTML. An attachment part carries a reference rather than bytes — pass attachment_id to fetch it, and only when you need it, because that is a real download against the person's own allowance and most of the time the answer is already in the text. One answer is capped at 4 MB, about 3 MB of attachment; with store: true the attachment is instead written to your private storage, up to the node's per-file limit, and the answer is its storage key, file name, type and size. Pass filename and mime_type from the message parts when you store from Gmail, which does not send them with the attachment. Storing needs storage:write.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read One Message', readOnlyHint: true, openWorldHint: true },
        scope: 'connections:read-through',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected mailbox.' },
            message_id: { type: 'string', required: true, description: 'The message, from aimeat_mail_search.' },
            attachment_id: { type: 'string', description: 'Fetch this attachment instead of the message body.' },
            store: { type: 'boolean', description: "With attachment_id: store the attachment as your private file (up to the node's per-file limit) and answer its storage key, instead of its bytes. Needs storage:write." },
            filename: { type: 'string', description: 'With store: the file name, from the message parts (Gmail does not send it with the attachment).' },
            mime_type: { type: 'string', description: 'With store: the file type, from the message parts.' },
            key: { type: 'string', description: 'With store: the storage key. Default mail/<provider>/<message id>/<file name>.' },
        },
    },
    {
        name: 'aimeat_mail_aliases',
        description: "The addresses a connected Gmail mailbox may send AS: its own, plus any alias the person has verified at Google. This is what makes an alias work without DNS, without a second mailbox licence and with the domain's own SPF and DKIM — the message really leaves through their Gmail. Only VERIFIED addresses are listed, because an unverified one is refused at send time for a reason the message does not carry. An alias added at Google after the mailbox was connected can take a day to appear. Microsoft has no equivalent a delegated permission can read, so it returns nothing there rather than guessing.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Addresses This Mailbox May Send As', readOnlyHint: true, openWorldHint: true },
        scope: 'connections:read-through',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'A connected Gmail mailbox.' },
        },
    },
    {
        name: 'aimeat_mail_send',
        description: "Send a message to a SAVED recipient (aimeat_contact_list / aimeat_contact_add), never to a free address — that is the structural anti-spam device, not a formality. Pass connection_id to send through your own connected mailbox, so it leaves from your own address with your domain's SPF and DKIM and lands in your own Sent Items; without one it goes through the node's shared sender. Everything is gated on the way out: a suppressed address, an opt-out on a 'marketing' message, and a rolling daily allowance each refuse with a reason. A send the provider refused, or one this node had no way to make, comes back as an ERROR carrying the provider's reason and the send-log id, so tell the person it was not sent. A success says the message was handed over; that is still not a delivery, and a bounce shows up on the contact afterwards. Requires both outbound:send and connections:use, and is absent without them rather than present and refusing.",
        caller: 'agent',
        visibility: agentEverywhere,
        // NOT idempotent, and that is the whole point: a blind retry sends the message twice, which is
        // the one mistake in this family a person actually notices.
        annotations: { title: 'Send Mail', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Sending needs `connections:use` AND `outbound:send`; the tool is not registered without both,
        // so a session holding one never sees a control whose only possible answer is a refusal. This map
        // carries the mailbox half, because that is the surprising permission of the two.
        // The words POST /v1/outbound/send asks (secaudit 2026-10 follow-up, A4).
        scope: ['connections:use', 'outbound:send'],
        surfaces: ['agent'],
        input: {
            contact_id: { type: 'string', required: true, description: 'A saved recipient. Never a free address.' },
            subject: { type: 'string', required: true, description: 'The subject line.' },
            body: { type: 'string', required: true, description: 'The message as plain text; the server renders and escapes it.' },
            connection_id: { type: 'string', description: 'Send through this connected mailbox of yours.' },
            from_alias: { type: 'string', description: 'A verified alias of that mailbox to send as.' },
            kind: { type: 'string', description: "'transactional' (default) or 'marketing', which an opt-out blocks and which carries the unsubscribe link.", zod: z.enum(['transactional', 'marketing']) },
            reply_to: { type: 'string', description: 'Where a reply should go, when it is not the sending address.' },
            theme: { type: 'string', description: "Optional: what the message LOOKS like. A built-in id (clean, space, warm, paper) or one of the owner's own, and theirs wins where both exist. 'clean' is the default and is what went out before themes existed, so a send that names nothing looks exactly as it always did. An id that matches nothing falls back to the default rather than failing — decoration never refuses a send. Read the list, already validated, from GET /v1/outbound/themes." },
            ai_disclosure: { type: 'string', description: "Optional: mark the message as machine-written in a header. One of none | ai-assisted | ai-generated | autonomous. If YOU wrote the body, declare it — 'ai-generated' when you produced the text, 'ai-assisted' when a person wrote it and you edited. It goes in a HEADER and not in the text, because the audience for it is machines: nobody reading their inbox follows a link to a hash. Declaring it and then asking for it to be left out is not possible.", zod: z.enum(['none', 'ai-assisted', 'ai-generated', 'autonomous']) },
            ai_provenance_id: { type: 'string', description: "Optional, with ai_disclosure: a provenance record of your own that describes this text, the id the node returned when it generated it for you. The header then links that record. A record that is not yours is not attached; the node stamps the message itself instead.", zod: z.string().max(80) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
