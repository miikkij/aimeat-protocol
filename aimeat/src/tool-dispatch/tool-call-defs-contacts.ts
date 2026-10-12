/**
 * @file src/tool-dispatch/tool-call-defs-contacts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's address book on the CLI dispatch (`aimeat connect call` and
 *   `POST /local/call/<tool>`): list, invite by email, save, remove, and resolve an email to an
 *   account. Thin REST proxies over /v1/contacts/* (src/routes/contacts.ts), so the scope check,
 *   the validation and the rule that one request reaches one address stay in the route.
 *
 *   Until 2026-10-12 these five tools had a handler only on the connector MCP
 *   (src/cli/connect/mcp/tools/contacts.ts), so a fleet daemon and crew code could not call them.
 *   The handlers moved here unchanged in what they send; the connector MCP runs them through
 *   dispatch-tools.ts.
 * @structure contactCliTools[] — the handler table, spread by index.ts
 * @usage import { contactCliTools } from './tool-call-defs-contacts.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP module (wish: every MCP tool on aimeat connect serve).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString } from './tool-call-helpers.js';

export const contactCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/contacts — the address book, filtered by text, state, or what to include.
        name: 'aimeat_contact_list',
        handler: ({ client }, input) => client.get(`/v1/contacts${query({
            q: optionalString(input, 'q'),
            state: optionalString(input, 'state'),
            include: optionalString(input, 'include'),
        })}`),
    },
    {
        // → POST /v1/contacts/invite — the route sends the invitation and answers the same whether
        //   or not the address has an account.
        name: 'aimeat_contact_invite',
        handler: ({ client }, input) => client.post('/v1/contacts/invite', {
            email: requiredString(input, 'email'),
            message: input.message,
        }),
    },
    {
        // → POST /v1/contacts — every declared field is sent as given. The route decides whether the
        //   call saves an account as a contact or a person who has no account.
        name: 'aimeat_contact_add',
        handler: ({ client }, input) => client.post('/v1/contacts', {
            contact_id: input.contact_id,
            name: input.name,
            email: input.email,
            note: input.note,
            tags: input.tags,
            links: input.links,
            relation: input.relation,
        }),
    },
    {
        // → DELETE /v1/contacts/:contactId
        name: 'aimeat_contact_remove',
        handler: ({ client }, input) => client.delete(`/v1/contacts/${encodeURIComponent(requiredString(input, 'contact_id'))}`),
    },
    {
        // → POST /v1/contacts/resolve — an email to the account it belongs to, when the caller may know.
        name: 'aimeat_contact_resolve_email',
        handler: ({ client }, input) => client.post('/v1/contacts/resolve', { email: requiredString(input, 'email') }),
    },
];
