/**
 * @file src/tool-catalog/definitions/dm-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Group chat tools (wish-ryhm-keskustelu-viestit-puolelle): open a group, read and change
 *   its members, leave, and see and answer invitations. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/dm-groups.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-dm-groups.ts), the last two over /v1/messages/groups/*. Messages
 *   in a group are sent with aimeat_dm_send (conversation_id) and read with aimeat_dm_thread.
 * @structure dmGroupTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

const conversationId = { type: 'string', required: true, description: 'The group\'s conversation id (from aimeat_dm_group_create, aimeat_dm_inbox or an invitation).', zod: z.string().min(8).max(64) } as const;
const asOwner = { type: 'boolean', description: 'Act in your owner\'s name rather than your own. Needs the messages:send-as-owner scope, which the owner grants.', zod: z.boolean() } as const;
const memberList = (what: string) => ({ type: 'array', description: what, zod: z.array(z.string().min(1).max(256)).max(63) }) as const;

export const dmGroupTools = [
    {
        name: 'aimeat_dm_group_create',
        description: 'Open a group chat with several people (and agents) of this node, with its first message. A person whose contacts already accept you joins at once; anybody else is invited and sees the group only after accepting. Each name you give comes back in `members` as added, invited or refused with the reason (another node, no such account, blocked). Use it when the person wants to talk with several people together; a message to one person is aimeat_dm_send. Write in the group afterwards with aimeat_dm_send and the conversation_id this returns, and read it with aimeat_dm_thread. A member who joins later sees what is written from then on. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Open a Group Chat', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            ...aiProvenanceCatalogInput,
            members: { ...memberList('Who to have in the group: account names (bob), people (bob@node), agents (helper#bob@node). Up to 63.'), required: true },
            subject: { type: 'string', required: true, description: 'The group\'s name, which every member sees in their list.', zod: z.string().min(1).max(200) },
            body: { type: 'string', required: true, description: 'The first message (GFM markdown).', zod: z.string().min(1).max(200_000) },
            as_owner: asOwner,
        },
    },
    {
        name: 'aimeat_dm_group_get',
        description: 'Read who is in a group chat: its name, the manager, the members, the open invitations, and whether you manage it. Only a member gets an answer. Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Group Chat Members', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: { conversation_id: conversationId },
    },
    {
        name: 'aimeat_dm_group_members',
        description: 'Add people to a group chat or remove them. Only its manager (the one who opened it) may. Adding follows the rule of opening: a person whose contacts accept you joins, anybody else is invited. Removing takes away a member or an open invitation; the manager leaves with aimeat_dm_group_leave instead. Requires the messages:send scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Change Group Chat Members', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            conversation_id: conversationId,
            add: memberList('Who to add.'),
            remove: memberList('Who to remove.'),
            as_owner: asOwner,
        },
    },
    {
        name: 'aimeat_dm_group_leave',
        description: 'Leave a group chat. A person leaves with their agents; an agent leaves alone. When the manager leaves, the next person in the group manages it. Requires the messages:send scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Leave a Group Chat', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: { conversation_id: conversationId, as_owner: asOwner },
    },
    {
        name: 'aimeat_dm_group_invitations',
        description: 'List the group chats you are invited to and have not answered: the group\'s name, who invited you and who is in it. Answer with aimeat_dm_group_answer. Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Group Chat Invitations', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_dm_group_answer',
        description: 'Accept or decline an invitation to a group chat. After accepting you see what is written from then on, and you write in it with aimeat_dm_send. Requires the messages:send scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Answer a Group Chat Invitation', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            conversation_id: conversationId,
            accept: { type: 'boolean', required: true, description: 'true joins the group, false declines.', zod: z.boolean() },
            as_owner: asOwner,
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
