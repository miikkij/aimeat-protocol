/**
 * @file src/tool-dispatch/tool-call-defs-organism-owners.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's owners and its invitations by email on the CLI dispatch (`aimeat
 *   connect call` and `POST /local/call/<tool>`). Thin REST proxies over
 *   /v1/organisms/:id/owners (src/routes/organisms/membership.ts) and
 *   /v1/organisms/:id/invitations/email (src/routes/organisms/workspace-access.ts). Ownership is
 *   plural: adding is additive and the last owner cannot be removed, and both rules are the
 *   route's (services/organism-ownership.ts). This file adds none of its own.
 *
 *   Until 2026-10-12 these five tools had a handler only on the connector MCP
 *   (src/cli/connect/mcp/tools/organisms.ts), so a fleet daemon and crew code could not call them.
 *   The handlers moved here unchanged in what they send; the connector MCP runs them through
 *   dispatch-tools.ts. They are in a file of their own because tool-call-defs-organism.ts is close
 *   to the file line limit.
 * @structure organismOwnerCliTools[] — the handler table, spread by index.ts
 * @usage import { organismOwnerCliTools } from './tool-call-defs-organism-owners.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP module (wish: every MCP tool on aimeat connect serve).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

export const organismOwnerCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/organisms/:id/owners
        name: 'aimeat_organism_owner_add',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/owners`, { ghii: requiredString(input, 'ghii') }),
    },
    {
        // → DELETE /v1/organisms/:id/owners/:ghii
        name: 'aimeat_organism_owner_remove',
        handler: ({ client }, input) => client.delete(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/owners/${encodeURIComponent(requiredString(input, 'ghii'))}`),
    },
    {
        // → POST /v1/organisms/:id/invitations/email — invite an address that has no account here
        //   (creator or admin). The route reads the camelCase names.
        name: 'aimeat_organism_invite_email',
        handler: ({ client }, input) => {
            const body: JsonObject = { email: requiredString(input, 'email') };
            const orgRole = optionalString(input, 'org_role'); if (orgRole) body.orgRole = orgRole;
            if (input.workspaces) body.workspaces = input.workspaces;
            const message = optionalString(input, 'message'); if (message) body.message = message;
            const expiresInDays = optionalNumber(input, 'expires_in_days'); if (expiresInDays !== undefined) body.expiresInDays = expiresInDays;
            const returnUrl = optionalString(input, 'return_url'); if (returnUrl) body.return_url = returnUrl;
            const locale = optionalString(input, 'locale'); if (locale) body.locale = locale;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/email`, body);
        },
    },
    {
        // → GET /v1/organisms/:id/invitations/email — the pending email invitations.
        name: 'aimeat_organism_invitations_email',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/email`),
    },
    {
        // → POST /v1/organisms/:id/invitations/email/:invId/cancel
        name: 'aimeat_organism_invitation_email_cancel',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/email/${encodeURIComponent(requiredString(input, 'invitation_id'))}/cancel`),
    },
];
