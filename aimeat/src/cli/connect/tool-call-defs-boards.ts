/**
 * @file cli/connect/tool-call-defs-boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The board connect-call tool definitions: read, post, list, create, subscribe, react,
 *   reply, members and delete. Pure extraction from tool-call-defs-core.ts, which crossed the
 *   800-line ceiling; the handlers are unchanged from the day they moved.
 * @structure boardTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { boardTools } from './tool-call-defs-boards.js';
 * @version-history
 *   v1.0.0 -- 2026-09-06 -- Extracted from tool-call-defs-core.ts (max-file-lines). The two entries
 *     that had been sitting apart from the rest (board_read, board_post) join them here.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalArray, optionalRecord } from './tool-call-helpers.js';

export const boardTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_board_read',
        handler: ({ client }, input) => client.get(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts${query({
            category: optionalString(input, 'category'),
            limit: optionalNumber(input, 'limit'),
        })}`),
    },
    {
        name: 'aimeat_board_post',
        handler: ({ client }, input) => {
            const body: JsonObject = { title: requiredString(input, 'title'), body: requiredString(input, 'body') };
            const category = optionalString(input, 'category');
            if (category) body.category = category;
            return client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`, body);
        },
    },
    {
        name: 'aimeat_board_list',
        handler: ({ client }) => client.get('/v1/boards'),
    },
    {
        name: 'aimeat_board_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description');
            const visibility = optionalString(input, 'visibility');
            const allowedGaiis = optionalArray(input, 'allowed_gaiis');
            if (description) body.description = description;
            if (visibility) body.visibility = visibility;
            // Without this a shared or private board is created with nobody on it, which reads as
            // "the board is broken" rather than "the guest list never left your machine".
            if (allowedGaiis) body.allowed_gaiis = allowedGaiis;
            return client.post('/v1/boards', body);
        },
    },
    {
        name: 'aimeat_board_subscribe',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const callbackUrl = optionalString(input, 'callback_url');
            const filters = optionalRecord(input, 'filters');
            if (callbackUrl) body.callback_url = callbackUrl;
            if (filters) body.filters = filters;
            return client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/subscribe`, body);
        },
    },
    {
        name: 'aimeat_board_react',
        handler: ({ client }, input) => {
            // `reaction` is the body key BoardReactionSchema names; this table sent `emoji`, so a
            // fleet agent's reaction failed validation on the way in. The same key, the same word,
            // on all three surfaces now — and `remove` withdraws the caller's own mark.
            const path = `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/react`;
            const emoji = requiredString(input, 'emoji');
            return input.remove === true
                ? client.delete(`${path}?reaction=${encodeURIComponent(emoji)}`)
                : client.post(path, { reaction: emoji });
        },
    },
    {
        name: 'aimeat_board_reply',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/replies`,
            { body: requiredString(input, 'body') },
        ),
    },
    {
        name: 'aimeat_board_members',
        // PATCH takes `add`/`remove` lists, which is what the catalog and the connector-MCP door
        // publish. `members` was a name nothing declared, so the tool never left the dispatch.
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const add = optionalArray(input, 'add'); if (add) body.add = add;
            const remove = optionalArray(input, 'remove'); if (remove) body.remove = remove;
            return client.patch(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/members`, body);
        },
    },
    {
        name: 'aimeat_board_delete',
        handler: ({ client }, input) => client.delete(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}`),
    },
];
