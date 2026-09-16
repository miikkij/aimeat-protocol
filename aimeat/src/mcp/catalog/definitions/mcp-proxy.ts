/**
 * @file mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The remote MCP servers this node connects OUT to: what is attached, what each one
 *   can do, and calling one. One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by
 *   definitions.ts.
 *
 *   FIVE ENTRIES, AND THE COUNT DOES NOT GROW WITH WHAT IS ATTACHED. Three to use what is there and
 *   two to manage it, whether the owner has one server or twenty. This node already publishes about
 *   340 tools; a proxy that spilled every remote tool into that list would make the list the
 *   problem. Flattening a chosen server into the list with its real schemas is a later phase, opted
 *   into per server.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const mcpProxyTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_mcp_list',
        description: "The other MCP servers this person has attached to their node, by the short name every other tool here takes. This is how you reach tools that are not on this node at all: their issue tracker, their wiki, whatever they connected. A server that has stopped working says so, and says what would repair it. Read this before telling anyone you cannot do something — the ability may already be attached.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_mcp_tools',
        description: "What one attached server can actually do: its tools, each with the arguments it takes. Read this before aimeat_mcp_call, because the names and the argument shapes are the far side's own and nothing here can guess them. The answer is what the server said at the last look, which is normally right and costs nothing; pass refresh when you have reason to think it changed, or when a call failed in a way that reads like the tool moved.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            server: { type: 'string', required: true, description: "Which server, by the short name from aimeat_mcp_list (e.g. 'jira')." },
            refresh: { type: 'boolean', description: 'Ask the server again instead of using what was cached at the last look.' },
        },
    },
    {
        name: 'aimeat_mcp_call',
        description: "Run one tool on one attached server. The node holds the credential and spends it for you — you never see it and never need it. TWO DIFFERENT NOS COME BACK HERE AND THEY MEAN DIFFERENT THINGS: the tool itself refusing (it ran, it said no, and its answer explains why) and the server being unreachable or its credential dead (nothing ran, and a PERSON has to repair it). Say which one happened rather than reporting both as a failure. Get the argument shape from aimeat_mcp_tools first.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            server: { type: 'string', required: true, description: 'Which server, by the short name from aimeat_mcp_list.' },
            tool: { type: 'string', required: true, description: 'Which of its tools, by the name aimeat_mcp_tools gave.' },
            arguments: { type: 'object', description: "The arguments that tool asks for, in the shape its own schema names." },
        },
    },
    {
        name: 'aimeat_mcp_attach',
        description: "Attach another MCP server to this person's node, so everything acting for them can use it. Needs the mcp:manage permission, which is deliberately not part of 'full access': attaching a server to somebody's account is a human act. The address is checked before anything is saved, so a wrong address or a wrong token is reported now rather than as a server that mysteriously never answers. A token given here is encrypted on the node and never comes back out, not to you and not to anyone. Ask the person for the address and the token; do not guess either.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: "A short name used instead of the address, e.g. 'jira'. Lowercase letters, digits and dashes." },
            url: { type: 'string', required: true, description: 'The server address, https.' },
            title: { type: 'string', description: 'What to call it on screen. Defaults to the name.' },
            description: { type: 'string', description: 'What it is for, in a sentence.' },
            transport: { type: 'string', description: "How to speak to it: 'http' (the current transport, and the default) or 'sse' (the older one)." },
            token: { type: 'string', description: 'A token or key the server needs. Held encrypted on this node and never given out again.' },
            header: { type: 'string', description: "Which header the token belongs in, when the server does not take a bearer (e.g. 'X-API-Key')." },
        },
    },
    {
        name: 'aimeat_mcp_update',
        description: "Change an attached server without removing it: switch it off and on again, or rename it on screen. Switching it off STOPS calls at once rather than marking it for later, so say what will stop working before you do it \u2014 it is the right move when a server is misbehaving and the person wants it quiet without losing the setup. Needs the mcp:manage permission. The address and the stored token cannot be changed here; a new token means connecting it again.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
            enabled: { type: 'boolean', description: 'false switches it off at once without removing it; true switches it back on.' },
            title: { type: 'string', description: 'What to call it on screen.' },
            description: { type: 'string', description: 'What it is for, in a sentence.' },
            exposure: { type: 'string', description: "How its tools are reached: 'gateway' through aimeat_mcp_call, or 'flatten' listed one by one." },
        },
    },
    {
        name: 'aimeat_mcp_detach',
        description: "Remove an attached MCP server and the credential stored with it. Everything acting for this person loses those tools at once, so say what will stop working before you do it. Needs the mcp:manage permission. This does not cancel anything at the far side: a token the person created there is still theirs to revoke, and worth mentioning if the point was to cut access off.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
        },
    },
];
