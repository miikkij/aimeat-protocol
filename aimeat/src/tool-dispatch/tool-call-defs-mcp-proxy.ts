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
import {
  requiredString, optionalString, optionalBoolean,
} from './tool-call-helpers.js';

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
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}/tools${optionalBoolean(input, 'refresh') ? '?refresh=1' : ''}`,
        ),
    },
    {
        // → POST /v1/mcp-servers/:id/call
        name: 'aimeat_mcp_call',
        handler: ({ client }, input) => client.post(
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}/call`,
            {
                tool: requiredString(input, 'tool'),
                // The far side's own argument shape, passed through untouched. Anything this door
                // normalised would disagree with the schema the far side validates against.
                arguments: (input.arguments && typeof input.arguments === 'object' ? input.arguments : {}),
            },
        ),
    },
    {
        // → POST /v1/mcp-servers, or POST /v1/mcp-servers/organism when `organism_id` names one.
        //   Probes the address before anything is called attached.
        name: 'aimeat_mcp_attach',
        handler: ({ client }, input) => {
            const body = {
                name: requiredString(input, 'name'),
                ...(optionalString(input, 'url') ? { url: optionalString(input, 'url') } : {}),
                ...(optionalString(input, 'peer') ? { peer: optionalString(input, 'peer') } : {}),
                ...(optionalString(input, 'title') ? { title: optionalString(input, 'title') } : {}),
                ...(optionalString(input, 'description') ? { description: optionalString(input, 'description') } : {}),
                ...(optionalString(input, 'transport') ? { transport: optionalString(input, 'transport') } : {}),
                ...(optionalString(input, 'token') ? { token: optionalString(input, 'token') } : {}),
                ...(optionalString(input, 'header') ? { header: optionalString(input, 'header') } : {}),
            };
            const group = optionalString(input, 'organism_id');
            // Both paths are written out as LITERALS rather than picked with a ternary: the gate
            // matches a tool to its route by the path it calls, and a computed path matches nothing.
            // See the note in the connector twin, which had the same ternary and the same cost.
            if (!group) return client.post('/v1/mcp-servers', body);
            return client.post('/v1/mcp-servers/organism', {
                ...body,
                organism_id: group,
                ...(optionalString(input, 'ws') ? { ws: optionalString(input, 'ws') } : {}),
            });
        },
    },
    {
        // → POST /v1/mcp-servers/:id/authorize — returns an address a PERSON opens. Nothing here
        //   can approve it, and fetching the address does nothing.
        name: 'aimeat_mcp_authorize',
        handler: ({ client }, input) => client.post(
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}/authorize`,
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
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}`,
            {
                ...(optionalBoolean(input, 'enabled') !== undefined ? { enabled: optionalBoolean(input, 'enabled') } : {}),
                ...(optionalString(input, 'title') ? { title: optionalString(input, 'title') } : {}),
                ...(optionalString(input, 'description') ? { description: optionalString(input, 'description') } : {}),
                ...(optionalString(input, 'exposure') ? { exposure: optionalString(input, 'exposure') } : {}),
            },
        ),
    },
    {
        // → GET /v1/mcp-servers/node — operator only; the node answers 403 to anyone else.
        name: 'aimeat_mcp_registry_list',
        handler: ({ client }) => client.get('/v1/mcp-servers/node'),
    },
    {
        // → PATCH /v1/mcp-servers/node/:id, after resolving the slug an operator actually says.
        name: 'aimeat_mcp_registry_set',
        handler: async ({ client }, input) => {
            const slug = requiredString(input, 'server');
            const listed = await client.get('/v1/mcp-servers/node');
            const rows = ((listed.data as { servers?: { id: string; slug: string }[] } | undefined)?.servers) ?? [];
            const row = rows.find((s) => s.slug === slug);
            if (!row) return { ok: false, status: 404, data: { error: `This node offers no server called "${slug}".` } } as never;
            // Forwarded as sent: the route reads it through normalizeMcpPrice, so this door decides nothing.
            const price = input.price && typeof input.price === 'object' ? input.price as Record<string, unknown> : null;
            return client.patch(`/v1/mcp-servers/node/${encodeURIComponent(row.id)}`, {
                ...(optionalString(input, 'availability') ? { availability: optionalString(input, 'availability') } : {}),
                ...(Array.isArray(input.allowlist) ? { allowlist: input.allowlist } : {}),
                ...(price ? { price: { unit: 'money', ...price } } : {}),
                ...(optionalString(input, 'exposure') ? { exposure: optionalString(input, 'exposure') } : {}),
                ...(optionalBoolean(input, 'enabled') !== undefined ? { enabled: optionalBoolean(input, 'enabled') } : {}),
            });
        },
    },
    {
        // → GET /v1/mcp-servers/grants
        name: 'aimeat_mcp_grant_list',
        handler: ({ client }, input) => client.get(
            '/v1/mcp-servers/grants'
            + (optionalString(input, 'server') ? `?server=${encodeURIComponent(optionalString(input, 'server') as string)}` : ''),
        ),
    },
    {
        // → PUT /v1/mcp-servers/:id/grants — a NARROWING, never a widening.
        name: 'aimeat_mcp_grant_set',
        handler: ({ client }, input) => client.put(
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}/grants`,
            {
                grantee: requiredString(input, 'grantee'),
                tools: input.tools,
                ...(input.locked_input ? { locked_input: input.locked_input } : {}),
                ...(input.call_cap ? { call_cap: input.call_cap } : {}),
                ...(optionalString(input, 'expires') ? { expires: optionalString(input, 'expires') } : {}),
            },
        ),
    },
    {
        // → DELETE /v1/mcp-servers/:id/grants/:grantee — removes the NARROWING, not the access.
        name: 'aimeat_mcp_grant_revoke',
        handler: ({ client }, input) => client.delete(
            `/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}/grants/${encodeURIComponent(requiredString(input, 'grantee'))}`,
        ),
    },
    {
        // → DELETE /v1/mcp-servers/:id — the stored credential goes with it.
        name: 'aimeat_mcp_detach',
        handler: ({ client }, input) => client.delete(`/v1/mcp-servers/${encodeURIComponent(requiredString(input, 'server'))}`),
    },
];
