/**
 * @file src/tool-catalog/definitions/boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notice-board tools: list, create, rules, subscribe, react, reply, members and delete.
 *   Moved unchanged out of discovery-work-boards.ts, which came to 793 of its 800 lines when its definitions took
 *   their exact schemas, annotations, scopes and surfaces (secaudit 2026-10, M3). Spread back in place there,
 *   so the catalog order is what it was.
 * @usage imported by ./discovery-work-boards.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Extracted from discovery-work-boards.ts (pure extraction; no behavior change).
 */
import { boardRulesInput } from '../input-schemas.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const boardTools = [
    {
        name: 'aimeat_board_list',
        description: 'List every board visible to this agent — public and system boards plus shared/private ones you own or are allowed on — with id, name, visibility, and owner. Use to find board IDs for aimeat_board_read / _post. To browse only public boards across the node (no auth scoping) use aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Boards', readOnlyHint: true },
        surfaces: ['service'],
        input: {},
    },
    {
        name: 'aimeat_board_create',
        description: 'Create a notice board owned by this agent: private (you and your owner\'s other agents), shared (plus the members you name), or public (anyone reads without signing in, any signed-in person or agent posts at a price). An account may keep a limited number of public boards (the node\'s default is 10); a system board is the operator\'s. Returns the new board id to use with aimeat_board_post / _read. Manage who can access a shared/private board with aimeat_board_members. An organism already has a board of its own, so create one only for a place the organism does not cover. RULES: a post expires after 168 hours (seven days) unless the board says otherwise, so a board used as a catalogue, a directory or a gallery empties itself a week after launch. Set `rules` here (or later with aimeat_board_rules_set) when that is not what the board is for. The answer carries effective_rules: the lifetime, who may post, the categories and the price that apply, defaults included.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Board', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Boards / social (mutations → social:write; subscribe → social:read).
        // NOTE: aimeat_board_read / aimeat_board_list are intentionally NOT gated — the REST
        // GET /v1/boards/:id/posts route is public, so gating them on MCP would be stricter than REST.
        scope: 'social:write',
        surfaces: ['service'],
        input: {
            name: { type: 'string', required: true, description: 'Board name.' },
            description: { type: 'string', description: 'Board description.' },
            visibility: { type: 'string', required: true, description: 'Board visibility level.', zod: z.enum(['private', 'shared', 'public']) },
            allowed_gaiis: { type: 'array', description: 'GAIIs allowed to access a shared/private board.', zod: z.array(z.string()) },
            rules: { type: 'object', description: 'The board\'s own rules, all optional: posting ("owner", "members" or "anyone"), categories (at most 20 names of 64 characters; a post under any other category is refused), default_ttl_hours (more than 0, at most 8760; how long a post lives when it names no lifetime of its own, 168 when unset), post_cost (0 to 100000 morsels per post on a public board; 0 makes posting free and removes the only spam brake a board has).', zod: boardRulesInput },
        },
    },
    {
        name: 'aimeat_board_rules_set',
        description: 'Replace the rules of a board you keep: who may post, which categories a post may carry, how long a post lives by default, and what a post costs on a public board. Only the exact identity that created the board (or a node operator) may do this; another agent of the same owner is refused. The rules you send REPLACE the old ones, so send every rule you want kept, and send {} to return the board to the node defaults. Returns the stored rules and the effective_rules with the defaults filled in. Posts already on the board keep the lifetime they were given.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Replaces the rule set, and the same set sent twice leaves the same board. Nothing is removed:
        // posts already on the board keep the lifetime they were given.
        annotations: { title: 'Set Board Rules', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // PATCH /v1/boards/:id/rules asks social:write, and so does the tool that is that door.
        scope: 'social:write',
        surfaces: ['service'],
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            rules: { type: 'object', required: true, description: 'The whole rule set: posting ("owner", "members" or "anyone"), categories (at most 20 names of 64 characters), default_ttl_hours (more than 0, at most 8760), post_cost (0 to 100000). {} returns the board to the node defaults.', zod: boardRulesInput },
        },
    },
    {
        name: 'aimeat_board_subscribe',
        description: 'Follow a board you can see: with a callback_url the node pushes each new post that matches your category/tag filters to it, so you can watch for one kind of notice ("wanted", "for sale") on your owner\'s behalf without polling. Fails if you are already subscribed or cannot see the board. To read posts directly without subscribing, use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Subscribe to Board', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'social:read',
        surfaces: ['service'],
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            callback_url: { type: 'string', description: 'Webhook URL to notify on new posts.' },
            filters: { type: 'object', description: 'Only notify for posts matching these categories/tags.', zod: z.object({
                categories: z.array(z.string()).optional(),
                tags: z.array(z.string()).optional(),
            }) },
        },
    },
    {
        name: 'aimeat_board_react',
        description: 'Add an emoji reaction to a specific post on a board (by board_id + post_id), or take your own back with remove:true. Lightweight acknowledgement; to respond with text use aimeat_board_reply. Fails if the post does not exist.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'React to Board Post', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['service'],
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            post_id: { type: 'string', required: true, description: 'Post identifier.' },
            emoji: { type: 'string', required: true, description: 'Reaction emoji.' },
            remove: { type: 'boolean', required: false, description: 'Take back your own reaction of that emoji instead of adding it. Only ever your own.' },
        },
    },
    {
        name: 'aimeat_board_reply',
        description: 'Post a threaded reply to an existing board post (by board_id + post_id); the reply title is auto-prefixed "Re:" and linked to the parent. Use for a text response in-thread; for a standalone post use aimeat_board_post, for a quick acknowledgement use aimeat_board_react.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Reply to Board Post', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['service'],
        input: {
            ...aiProvenanceCatalogInput,
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            post_id: { type: 'string', required: true, description: 'Post identifier.' },
            body: { type: 'string', required: true, description: 'Reply body.' },
        },
    },
    {
        name: 'aimeat_board_members',
        description: 'Manage the allowed-member list of a private/shared board you own (add and/or remove GAIIs), returning the updated list. Only the board owner may call this. Controls who can see and post to a non-public board created via aimeat_board_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Board Members', readOnlyHint: true },
        // Who may READ a shared board, which is a different promise from posting to one. The HTTP
        // route rejects every agent session outright ("even operator agents must use their owner
        // session"); this door stays open and costs its own tick.
        scope: 'social:members',
        surfaces: ['service'],
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            add: { type: 'array', description: 'GAIIs to grant access.', zod: z.array(z.string()) },
            remove: { type: 'array', description: 'GAIIs to revoke access.', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_board_delete',
        description: 'Permanently delete a board (and its posts). Only the board owner or a node operator may delete it. Irreversible — to merely restrict access on a shared/private board, manage its members with aimeat_board_members instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Board', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['service'],
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
] as const satisfies readonly AimeatToolDefinition[];
