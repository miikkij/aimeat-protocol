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
 *   2026-10-09 — aimeat_mcp_authorize says the address is the node's confirmation page (secrets audit 2026-10-09).
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */

import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const mcpProxyTools = [
    {
        name: 'aimeat_mcp_list',
        description: "The other MCP servers this person has attached to their node, by the short name every other tool here takes. This is how you reach tools that are not on this node at all: their issue tracker, their wiki, whatever they connected. A server that has stopped working says so, and says what would repair it. Read this before telling anyone you cannot do something — the ability may already be attached.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Remote MCP servers. `openWorldHint` is true on all but the list, because everything else here
        // reaches a server this node does not run.
        annotations: { title: 'Attached MCP Servers', readOnlyHint: true },
        // Remote MCP servers. The same three-way split as connections above, and for the same reason:
        // knowing WHICH servers are attached, calling a tool THROUGH one, and attaching another are
        // three different favours. `mcp:manage` is additionally outside every wildcard
        // (utils/scope-coverage.ts), because pointing somebody's account at a server of the agent's own
        // choosing, and storing a credential there, is a human act and not something "Full access"
        // should carry.
        scope: 'mcp:read',
        input: {},
    },
    {
        name: 'aimeat_mcp_tools',
        description: "What one attached server can actually do: its tools, each with the arguments it takes. Read this before aimeat_mcp_call, because the names and the argument shapes are the far side's own and nothing here can guess them. The answer is what the server said at the last look, which is normally right and costs nothing; pass refresh when you have reason to think it changed, or when a call failed in a way that reads like the tool moved.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'What an Attached Server Can Do', readOnlyHint: true, openWorldHint: true },
        // Reading a server's tool list is `mcp:read` and not `mcp:use`: knowing that a tool called
        // create_issue exists gives nobody the ability to create an issue. The gate that matters is on
        // the CALL, which is the same reasoning the node's own capability source states for itself.
        scope: 'mcp:read',
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
        // NOT read-only and NOT idempotent, whatever the tool behind it does. This node cannot know
        // what somebody else's tool is: the honest hint is the widest one, because a client deciding
        // whether to auto-run a call must not be told "safe" on our guess about a stranger's code.
        annotations: { title: 'Call a Tool on an Attached Server', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'mcp:use',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by the short name from aimeat_mcp_list.' },
            tool: { type: 'string', required: true, description: 'Which of its tools, by the name aimeat_mcp_tools gave.' },
            arguments: { type: 'object', description: "The arguments that tool asks for, in the shape its own schema names." },
        },
    },
    {
        name: 'aimeat_mcp_attach',
        description: "Attach another MCP server to this person's node, so everything acting for them can use it. Needs the mcp:manage permission, which is deliberately not part of 'full access': attaching a server to somebody's account is a human act. The address is checked before anything is saved, so a wrong address or a wrong token is reported now rather than as a server that mysteriously never answers. A token given here is encrypted on the node and never comes back out, not to you and not to anyone. Ask the person for the address and the token; do not guess either. Another AIMEAT node is named with peer instead of url, and then the address is looked up on every call so the link ends when the peering does. Pass organism_id to attach it to a GROUP rather than to this person, which only an owner or admin of that group may do, and ws to narrow it to one workspace inside it.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Idempotent: attaching a name that already exists is refused rather than duplicated.
        annotations: { title: 'Attach an MCP Server', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'mcp:manage',
        input: {
            name: { type: 'string', required: true, description: "A short name used instead of the address, e.g. 'jira'. Lowercase letters, digits and dashes." },
            url: { type: 'string', description: 'The server address, https. Give this or peer.' },
            peer: { type: 'string', description: "The id of a peer AIMEAT node, instead of url. Its address is looked up on every call, so the link follows the peering rather than outliving it, and the peering must carry routing (member or genesis)." },
            organism_id: { type: 'string', description: "Attach it to a GROUP instead of to this person, so the group's members reach it without anybody handing out a token. Only an owner or an admin of the group may; using what is attached needs only membership." },
            ws: { type: 'string', description: "With organism_id, bind it to ONE workspace inside that group. Then the workspace's own roles decide: a contributor may call it, a viewer only sees it is there, and a member of the group with no role in that workspace reaches nothing." },
            title: { type: 'string', description: 'What to call it on screen. Defaults to the name.' },
            description: { type: 'string', description: 'What it is for, in a sentence.' },
            transport: { type: 'string', description: "How to speak to it: 'http' (the current transport, and the default) or 'sse' (the older one).", zod: z.enum(['http', 'sse']) },
            token: { type: 'string', description: 'A token or key the server needs. Held encrypted on this node and never given out again.' },
            header: { type: 'string', description: "Which header the token belongs in, when the server does not take a bearer (e.g. 'X-API-Key')." },
        },
    },
    {
        name: 'aimeat_mcp_authorize',
        description: "Begin signing in to an attached MCP server that uses OAuth. Returns an address for a PERSON to open: they see exactly what is being asked for and approve it at the far side, and nothing here can approve it for them \u2014 fetching the address yourself does nothing. Hand it over, say in one sentence what it is for, and wait; the server then reports its tools and starts working. Use this for a server attached with auth 'oauth'; a server that takes a plain token needs no round at all. The address is this node's own confirmation page: the owner opens it signed in to this node, confirms, and goes on to the far side from there, so a sign-in in anybody else's browser saves nothing. Needs the mcp:manage permission.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Destructive, and the credential goes with it. Everything acting for this person loses those
        // tools at once.
        // Idempotent: setting enabled to the value it already has changes nothing. Not destructive:
        // switching a server off keeps the setup and the credential, which is the whole difference
        // between this and detaching.
        // Idempotent in the sense that matters: starting twice produces two addresses and signs in
        // to nothing on its own. openWorld, because the whole point is reaching somebody else's
        // authorization server.
        annotations: { title: 'Sign In to an Attached Server', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'mcp:manage',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
            return_url: { type: 'string', description: 'A path on this node the browser lands on afterwards.' },
        },
    },
    {
        name: 'aimeat_mcp_update',
        description: "Change an attached server without removing it: switch it off and on again, or rename it on screen. Switching it off STOPS calls at once rather than marking it for later, so say what will stop working before you do it \u2014 it is the right move when a server is misbehaving and the person wants it quiet without losing the setup. Needs the mcp:manage permission. The address and the stored token cannot be changed here; a new token means connecting it again.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Change an Attached Server', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'mcp:manage',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
            enabled: { type: 'boolean', description: 'false switches it off at once without removing it; true switches it back on.' },
            title: { type: 'string', description: 'What to call it on screen.' },
            description: { type: 'string', description: 'What it is for, in a sentence.' },
            exposure: { type: 'string', description: "How its tools are reached: 'gateway' through aimeat_mcp_call, or 'flatten' listed one by one.", zod: z.enum(['gateway', 'flatten']) },
        },
    },
    {
        name: 'aimeat_mcp_registry_list',
        description: "What THIS NODE offers everybody who has an account on it: the MCP servers its operator attached once, who may reach each one, and what a call costs. Operator only \u2014 anyone else is refused. A server with no availability set is attached but offered to NOBODY, which is a common half-finished state and looks identical to a broken one, so say which it is.",
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: "This Node's MCP Registry", readOnlyHint: true },
        // What this node's own MCP registry offers every owner, to whom, and at what price.
        scope: 'operator:admin',
        input: {},
    },
    {
        name: 'aimeat_mcp_registry_set',
        description: "Decide who may use one of this node's own MCP servers, what a call costs them, how its tools are listed, and whether it is on at all. Operator only. Availability all-owners means everyone with an account here; allowlist means only the owners named, and an EMPTY allowlist means nobody \u2014 which is the safe reading rather than a bug. A price is in money, per call, paid by the CALLER, and a proxied call cannot take payment yet, so a priced server refuses its calls by name until it can: leave it free for now. Never price a server in morsels: morsels pace how much gets used and buy nothing. Switching it off takes it away from everybody at once, so say what will stop working before you do it.",
        caller: 'operator',
        visibility: agentEverywhere,
        // Idempotent, and NOT destructive in the ordinary sense: switching a server off keeps it and
        // its credential. What makes it worth a person's attention is the blast radius — every owner
        // on the node is affected at once — and that is what the description says rather than the hint.
        annotations: { title: "Set Who May Use a Node Server", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        input: {
            server: { type: 'string', required: true, description: "Which server on this node's registry, by its short name." },
            availability: { type: 'string', description: "'all-owners' or 'allowlist'.", zod: z.enum(['all-owners', 'allowlist']) },
            allowlist: { type: 'array', description: 'The owners who may use it. An empty list means nobody.', zod: z.array(z.string()) },
            price: { type: 'object', description: "What one call costs, in money only: {perCall, currency}. perCall is whole micro-units (1000000 is one unit of the currency) and currency is ISO 4217, such as EUR. perCall 0 makes it free again.", zod: z.object({
        perCall: z.number(),
        currency: z.string().optional(),
      }) },
            exposure: { type: 'string', description: "How its tools are reached: 'gateway' through aimeat_mcp_call, or 'flatten' listed one by one.", zod: z.enum(['gateway', 'flatten']) },
            enabled: { type: 'boolean', description: 'false takes it away from everybody at once.' },
        },
    },
    {
        name: 'aimeat_mcp_grant_list',
        description: "Which of this person's agents and apps may use which attached servers, and which tools on them. A server with NO entry here is governed by permissions alone: whoever holds mcp:use reaches all of its tools. An entry is a NARROWING of that, so read this before telling somebody what an agent can do \u2014 the permission is only half the answer.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Who May Use Which Server', readOnlyHint: true },
        // The LIST is mcp:read: knowing which agent was narrowed to what is knowing what you have,
        // and an app showing a person their own permissions must not need the word that CHANGES them.
        // aimeat_mcp_registry_list / _set ride operator:admin, with the rest of node administration.
        scope: 'mcp:read',
        input: {
            server: { type: 'string', description: 'Only for this server, by its short name.' },
        },
    },
    {
        name: 'aimeat_mcp_grant_set',
        description: "Narrow one agent or app to named tools on one attached server, optionally with arguments already decided, a call ceiling and an end date. This is how 'my coding agent may READ Jira' becomes true without also meaning it may close tickets. locked_input is the part worth understanding: {\"project\":\"SUPPORT\"} means every call lands in SUPPORT whatever the agent asks for, because those values win over what it sends. Writing a grant REPLACES any earlier one for the same agent on the same server. Needs the mcp:manage permission. Ask the person which tools before guessing; a narrowing that is too tight looks exactly like a broken server.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Idempotent: writing the same grant twice leaves the same state. Not destructive, although
        // it REPLACES an earlier grant for the same pair — what it replaces is a permission record,
        // and the thing it might take away is itself recoverable by writing it again.
        annotations: { title: 'Narrow an Agent to Named Tools', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'mcp:manage',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
            grantee: { type: 'string', required: true, description: "An agent's full name, an app as app:owner/file, or * for everything acting for this person." },
            tools: { type: 'array', required: true, description: "Which tools it may use: a list of names, or the string '*' for all of them.", zod: z.union([z.literal('*'), z.array(z.string())]) },
            locked_input: { type: 'object', description: 'Arguments it may not choose. These win over whatever it sends.' },
            call_cap: { type: 'object', description: 'At most {count} calls in {windowHours} hours.', zod: z.object({ count: z.number(), windowHours: z.number() }) },
            expires: { type: 'string', description: 'An ISO date after which this stops applying.' },
            read_only: { type: 'boolean', description: 'True: only tools the server itself marks read-only (readOnlyHint), on top of `tools`. A tool with no such mark is refused, and so is one the server adds later until it is marked.' },
        },
    },
    {
        name: 'aimeat_mcp_grant_revoke',
        description: "Remove a narrowing. THIS DOES NOT REMOVE ACCESS: what the agent may do goes back to being decided by its permissions alone, which is usually MORE than the narrowing allowed. If the intent is to stop an agent using a server, take the permission away or switch the server off instead, and say which you did. Needs the mcp:manage permission.",
        caller: 'agent',
        visibility: agentEverywhere,
        // NOT destructive in the direction people expect: removing a narrowing WIDENS what the agent
        // may do, back to whatever its permissions allow.
        annotations: { title: 'Remove a Narrowing', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'mcp:manage',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
            grantee: { type: 'string', required: true, description: 'Whose narrowing to remove.' },
        },
    },
    {
        name: 'aimeat_mcp_detach',
        description: "Remove an attached MCP server and the credential stored with it. Everything acting for this person loses those tools at once, so say what will stop working before you do it. Needs the mcp:manage permission. This does not cancel anything at the far side: a token the person created there is still theirs to revoke, and worth mentioning if the point was to cut access off.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove an MCP Server', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'mcp:manage',
        input: {
            server: { type: 'string', required: true, description: 'Which server, by its short name.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
