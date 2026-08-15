/**
 * @file tool-call-defs-app-draft-edit.ts
 * @description CLI-fallback definitions for the four incremental app-draft tools: write a piece,
 *   replace an exact passage, read a line range, seed the slot from a published version.
 *
 *   Their own file rather than tool-call-defs-apps.ts, which is already 716 lines and would go past
 *   the 800-line ceiling with these in it.
 *
 *   Each is a thin proxy to the REST route its MCP twin calls, which is the point: the draft edit
 *   exists once, in services/app-draft-edit.ts, and all three doors reach it the same way. Note that
 *   `content` here is PLAIN TEXT while aimeat_app_draft_save takes base64 — a caller composing HTML
 *   is not moving a file, and base64 would inflate every chunk by a third.
 * @structure appDraftEditTools — ConnectCliToolDefinition[]
 * @usage
 *   import { appDraftEditTools } from './tool-call-defs-app-draft-edit.js';
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean } from './tool-call-helpers.js';

export const appDraftEditTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/apps/:owner/:filename/draft/write
        name: 'aimeat_app_draft_write',
        description: 'Write a PIECE of the app draft, so a file larger than one model response can be built across calls. content is plain UTF-8 text, not base64.',
        input: {
            filename: { type: 'string', required: true, description: 'App filename this draft stages (e.g. "pong.html").' },
            content: { type: 'string', required: true, description: 'The text to write. Plain UTF-8, not base64.' },
            mode: { type: 'string', enum: ['append', 'replace'], description: 'append (default) adds to the end; replace overwrites the whole draft.' },
            expected_size_bytes: { type: 'number', description: 'Refuse unless the draft is currently this many bytes.' },
            name: { type: 'string', description: 'Display name (defaults to the live app\'s, or the draft\'s once set).' },
            description: { type: 'string', description: 'Description (defaults to the live app\'s, or the draft\'s once set).' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            const body: JsonObject = { content: requiredString(input, 'content') };
            const mode = optionalString(input, 'mode'); if (mode) body.mode = mode;
            const expected = optionalNumber(input, 'expected_size_bytes'); if (expected !== undefined) body.expected_size_bytes = expected;
            const name = optionalString(input, 'name'); if (name) body.name = name;
            const description = optionalString(input, 'description'); if (description !== undefined) body.description = description;
            return client.post(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/draft/write`, body);
        },
    },
    {
        // → POST /v1/apps/:owner/:filename/draft/replace
        name: 'aimeat_app_draft_replace',
        description: 'Replace an exact passage inside the app draft. old_string must match exactly and be unique unless replace_all is set.',
        input: {
            filename: { type: 'string', required: true, description: 'App filename whose draft to edit.' },
            old_string: { type: 'string', required: true, description: 'The exact text to replace, including indentation.' },
            new_string: { type: 'string', required: true, description: 'What to put there instead.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring exactly one.' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            const body: JsonObject = {
                old_string: requiredString(input, 'old_string'),
                new_string: requiredString(input, 'new_string'),
            };
            if (optionalBoolean(input, 'replace_all')) body.replace_all = true;
            return client.post(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/draft/replace`, body);
        },
    },
    {
        // → GET /v1/apps/:owner/:filename/draft/lines
        name: 'aimeat_app_draft_read',
        description: 'Read a line range of the app draft, with the total line count and size. Bounded, so one call cannot pull a whole app into context.',
        input: {
            filename: { type: 'string', required: true, description: 'App filename whose draft to read.' },
            offset: { type: 'number', description: 'First line to return, 1-based. Default 1.' },
            limit: { type: 'number', description: 'How many lines to return. Default 400, maximum 2000.' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            const qs = query({
                offset: optionalNumber(input, 'offset'),
                limit: optionalNumber(input, 'limit'),
            });
            return client.get(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/draft/lines${qs}`);
        },
    },
    {
        // → POST /v1/apps/:owner/:filename/draft/seed
        name: 'aimeat_app_draft_seed',
        description: 'Copy a published app into the draft slot, server-side, so an app that is already live can be continued.',
        input: {
            filename: { type: 'string', required: true, description: 'The draft slot to write into.' },
            from_filename: { type: 'string', description: 'The published app to copy from. Defaults to filename.' },
            version: { type: 'number', description: 'Which published version. Defaults to the newest.' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            const body: JsonObject = {};
            const from = optionalString(input, 'from_filename'); if (from) body.from_filename = from;
            const version = optionalNumber(input, 'version'); if (version !== undefined) body.version = version;
            return client.post(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/draft/seed`, body);
        },
    },
    {
        // → POST /v1/apps/:owner/:filename/screenshot/capture
        name: 'aimeat_app_screenshot',
        description: 'Render a published app in a real browser, store the picture, and return its URL so you can look at what you built.',
        input: {
            filename: { type: 'string', required: true, description: 'The published app to photograph (e.g. "pong.html").' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            return client.post(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/screenshot/capture`, {});
        },
    },
];
