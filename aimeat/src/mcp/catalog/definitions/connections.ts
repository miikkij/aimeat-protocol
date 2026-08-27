/**
 * @file connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Outbound connections and mail: what this node can connect, what the caller has
 *   connected, how to start one, and reading and sending through a connected mailbox.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial. The whole subsystem was REST-and-browser only until now, which
 *     on a node whose primary interface is AI chat meant a capability that was not finished.
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const connectionTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_connection_providers',
        description: "Which outside services this node can connect an account at, and what each one is good for. Every entry says whether the NODE holds an application for it: when it does not, someone who brings their own app can still use it, so an absent registration removes an option from nobody. Read this before aimeat_connection_start, because the names are exact ('google-mail' reads Gmail, 'google-mail-send' sends from it) and mail deliberately comes in read/send PAIRS — reading a person's mail and writing in their name are different consent, and neither implies the other.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_connection_list',
        description: "The outside accounts YOU have connected, with the id every other tool here takes. A connection belongs to the exact principal that made it, so this is yours and not your owner's: an account they connected in their own browser does not appear here, and that is deliberate — a mailbox is the most private thing on this node, and inheriting one silently is not a permission anybody knowingly grants. A connection that has stopped working carries what would repair it.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_connection_start',
        description: "Begin connecting an outside account. Returns an address for a PERSON to open: they see exactly what is being asked for and approve it at the provider, and nothing here can approve it for them — fetching the address yourself does nothing. Hand it over, say in one sentence what it is for and what it will and will not be able to do, and wait; the connection then appears in aimeat_connection_list. Worth saying to them, because it is the question they are actually asking: a read connection cannot send, delete or change anything, because those permissions are never requested.",
        caller: 'agent',
        visibility: agentEverywhere,
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
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected mailbox, from aimeat_connection_list.' },
            query: { type: 'string', description: "The provider's own search syntax." },
            limit: { type: 'number', description: 'How many, default 25, max 100.' },
            page_token: { type: 'string', description: 'Continue a previous search.' },
        },
    },
    {
        name: 'aimeat_mail_read',
        description: "Open one message from a connected mailbox, or fetch one of its attachments. A Gmail message arrives as a TREE of parts and the text is base64url, which is NOT base64: '-' for '+', '_' for '/', and the padding is often missing. Prefer text/plain and fall back to stripping the HTML. An attachment part carries a reference rather than bytes — pass attachment_id to fetch it, and only when you need it, because that is a real download against the person's own allowance and most of the time the answer is already in the text. A PDF attached to a mail is a file this node can read on its own; do not transcribe one by eye.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected mailbox.' },
            message_id: { type: 'string', required: true, description: 'The message, from aimeat_mail_search.' },
            attachment_id: { type: 'string', description: 'Fetch this attachment instead of the message body.' },
        },
    },
    {
        name: 'aimeat_mail_aliases',
        description: "The addresses a connected Gmail mailbox may send AS: its own, plus any alias the person has verified at Google. This is what makes an alias work without DNS, without a second mailbox licence and with the domain's own SPF and DKIM — the message really leaves through their Gmail. Only VERIFIED addresses are listed, because an unverified one is refused at send time for a reason the message does not carry. An alias added at Google after the mailbox was connected can take a day to appear. Microsoft has no equivalent a delegated permission can read, so it returns nothing there rather than guessing.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            connection_id: { type: 'string', required: true, description: 'A connected Gmail mailbox.' },
        },
    },
    {
        name: 'aimeat_mail_send',
        description: "Send a message to a SAVED recipient (aimeat_contact_list / aimeat_contact_add), never to a free address — that is the structural anti-spam device, not a formality. Pass connection_id to send through your own connected mailbox, so it leaves from your own address with your domain's SPF and DKIM and lands in your own Sent Items; without one it goes through the node's shared sender. Everything is gated on the way out: a suppressed address, an opt-out on a 'marketing' message, and a rolling daily allowance each refuse with a reason. A SUCCESSFUL ANSWER IS NOT A DELIVERY — it means the provider accepted the message; a bounce shows up on the contact afterwards. Requires both outbound:send and connections:use, and is absent without them rather than present and refusing.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            contact_id: { type: 'string', required: true, description: 'A saved recipient. Never a free address.' },
            subject: { type: 'string', required: true, description: 'The subject line.' },
            body: { type: 'string', required: true, description: 'The message as plain text; the server renders and escapes it.' },
            connection_id: { type: 'string', description: 'Send through this connected mailbox of yours.' },
            from_alias: { type: 'string', description: 'A verified alias of that mailbox to send as.' },
            kind: { type: 'string', description: "'transactional' (default) or 'marketing', which an opt-out blocks and which carries the unsubscribe link." },
            reply_to: { type: 'string', description: 'Where a reply should go, when it is not the sending address.' },
            theme: { type: 'string', description: "Optional: what the message LOOKS like. A built-in id (clean, space, warm, paper) or one of the owner's own, and theirs wins where both exist. 'clean' is the default and is what went out before themes existed, so a send that names nothing looks exactly as it always did. An id that matches nothing falls back to the default rather than failing — decoration never refuses a send. Read the list, already validated, from GET /v1/outbound/themes." },
            ai_disclosure: { type: 'string', description: "Optional: mark the message as machine-written in a header. One of none | ai-assisted | ai-generated | autonomous. If YOU wrote the body, declare it — 'ai-generated' when you produced the text, 'ai-assisted' when a person wrote it and you edited. It goes in a HEADER and not in the text, because the audience for it is machines: nobody reading their inbox follows a link to a hash. Declaring it and then asking for it to be left out is not possible." },
        },
    },
];
