/**
 * @file cli/connect/tool-call-defs-mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The remote MCP servers this node connects OUT to, on the CLI dispatch — the door a
 *   fleet daemon actually calls (`/local/call/<tool>`), and the one a parameter added to the other
 *   two MCP surfaces has historically failed to reach.
 *
 *   Thin REST proxies over /v1/mcp-servers/*, so the scope gate, the ownership check and the
 *   endpoint never leaving the node are the node's answer here too. Nothing in this file decides
 *   anything.
 *
 *   `server` is a SLUG OR AN ID and is passed straight through, because the route resolves either.
 *   That is deliberate: a person's UI holds the id it was handed and an agent says "jira", and
 *   making this door pick one would make the two doors disagree about what a valid call looks like.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean } from './tool-call-helpers.js';

const serverPath = (server: string, suffix = '') =>
    `/v1/mcp-servers/${encodeURIComponent(server)}${suffix}`;

export const mcpProxyCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/mcp-servers
        name: 'aimeat_mcp_list',
        handler: ({ client }) => client.get('/v1/mcp-servers'),
    },
    {
        // → GET /v1/mcp-servers/:id/tools — the cache unless refresh is asked for, because reaching
        //   the far side on every read makes this as slow as the slowest thing anyone attached.
        name: 'aimeat_mcp_tools',
        handler: ({ client }, input) => client.get(
            serverPath(requiredString(input, 'server'), '/tools')
                + (optionalBoolean(input, 'refresh') ? '?refresh=1' : ''),
        ),
    },
    {
        // → POST /v1/mcp-servers/:id/call
        name: 'aimeat_mcp_call',
        handler: ({ client }, input) => client.post(
            serverPath(requiredString(input, 'server'), '/call'),
            {
                tool: requiredString(input, 'tool'),
                // The far side's own argument shape, passed through untouched. Anything this door
                // normalised would disagree with the schema the far side validates against.
                arguments: (input.arguments && typeof input.arguments === 'object' ? input.arguments : {}),
            },
        ),
    },
    {
        // → POST /v1/mcp-servers — probes the address before anything is called attached.
        name: 'aimeat_mcp_attach',
        handler: ({ client }, input) => client.post('/v1/mcp-servers', {
            name: requiredString(input, 'name'),
            url: requiredString(input, 'url'),
            ...(optionalString(input, 'title') ? { title: optionalString(input, 'title') } : {}),
            ...(optionalString(input, 'description') ? { description: optionalString(input, 'description') } : {}),
            ...(optionalString(input, 'transport') ? { transport: optionalString(input, 'transport') } : {}),
            ...(optionalString(input, 'token') ? { token: optionalString(input, 'token') } : {}),
            ...(optionalString(input, 'header') ? { header: optionalString(input, 'header') } : {}),
        }),
    },
    {
        // → POST /v1/mcp-servers/:id/authorize — returns an address a PERSON opens. Nothing here
        //   can approve it, and fetching the address does nothing.
        name: 'aimeat_mcp_authorize',
        handler: ({ client }, input) => client.post(
            serverPath(requiredString(input, 'server'), '/authorize'),
            {
                ...(optionalString(input, 'return_url') ? { return_url: optionalString(input, 'return_url') } : {}),
            },
        ),
    },
    {
        // → PATCH /v1/mcp-servers/:id — the editable fields. Not the slug and not the
        //   credential: the slug is what every grant names, and a new token means reconnecting.
        name: 'aimeat_mcp_update',
        handler: ({ client }, input) => client.patch(
            serverPath(requiredString(input, 'server')),
            {
                ...(optionalBoolean(input, 'enabled') !== undefined ? { enabled: optionalBoolean(input, 'enabled') } : {}),
                ...(optionalString(input, 'title') ? { title: optionalString(input, 'title') } : {}),
                ...(optionalString(input, 'description') ? { description: optionalString(input, 'description') } : {}),
                ...(optionalString(input, 'exposure') ? { exposure: optionalString(input, 'exposure') } : {}),
            },
        ),
    },
    {
        // → DELETE /v1/mcp-servers/:id — the stored credential goes with it.
        name: 'aimeat_mcp_detach',
        handler: ({ client }, input) => client.delete(serverPath(requiredString(input, 'server'))),
    },
];
