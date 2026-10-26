/**
 * @file src/tool-catalog/definitions/dm-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dm_react: an acknowledgement mark on one direct message instead of a reply, as
 *   aimeat_board_react is on a board post. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/dm-reactions.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-dm-reactions.ts), the last two over /v1/messages/:id/reactions.
 *   A thread read with aimeat_dm_thread or aimeat_dm_thread_as_owner carries each message's marks.
 * @structure dmReactionTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const dmReactionTools = [
    {
        name: 'aimeat_dm_react',
        description: 'Acknowledge one direct message with a mark instead of a reply: a symbol such as ✓ or 👍, or a short word, up to 32 characters. Each person gives a symbol once; remove:true takes your own back. Use it when a reply would only say "got it", "done" or "thanks", or when the person asks you to mark a message. The person keeps a palette of their usual symbols and what each means in the memory record `messages.reactions` ({ symbols: [{ symbol, meaning }] }); read it to pick the one they would use. With as_owner:true the mark is your owner\'s, given in their name on their copy (the messages:send-as-owner scope); without it the mark is yours, on a message you sent or that was sent to you. The other side sees it at once, on this node and on another. When somebody reacts to a message you wrote, you are told with a dm.reaction delivery that names the symbol and who gave it; what it means to your owner is in their palette record or your own instructions. Requires the messages:send scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'React to a Message', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            message_id: { type: 'string', required: true, description: 'Id of the message, from aimeat_dm_inbox, aimeat_dm_thread or the _as_owner reads.', zod: z.string().min(1).max(200) },
            reaction: { type: 'string', required: true, description: 'The mark: an emoji or a short word, 1-32 characters on one line.', zod: z.string().min(1).max(32) },
            remove: { type: 'boolean', description: 'Take back your own mark of that symbol instead of giving it.', zod: z.boolean() },
            as_owner: { type: 'boolean', description: 'Give the mark in your owner\'s name, on their copy. Needs the messages:send-as-owner scope, which the owner grants.', zod: z.boolean() },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
