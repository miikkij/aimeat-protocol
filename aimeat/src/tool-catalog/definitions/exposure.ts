/**
 * @file src/tool-catalog/definitions/exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_exposure_report: what of the person's own content someone outside can read, and
 *   how to close each (plan doc-mvcn6c7e4e5q, V6.3). On all three surfaces: the node's MCP endpoint
 *   (src/mcp/exposure.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-exposure.ts), the last two over GET /v1/exposure/mine.
 *
 *   Not named with "visibility": aimeat_visibility_report is the traffic report (who found the
 *   person's place), a different question.
 * @structure exposureTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.1.0 — 2026-10-18 — The description says each item's classification and the conflicts listed
 *     first (plan doc-mvdipuyqraas, L4.1).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.3).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const exposureTools = [
    {
        name: 'aimeat_exposure_report',
        description: 'Everything of the person\'s own that someone else can read, and how to close each one. Use it when the person asks what a stranger can see of theirs, before they put something in, or when they want to tidy up what they have shared. Each item is one thing (a memory record, a file, an app, a shared workspace page, an organism, a board, a knowledge package, a package, a data package, a skill, the welcome page, a company front page, an exchange offering or need, an agent in the public agent list) with its `level`: "public" (anyone), "link" (anyone who holds the address: an app with no access code, an open workspace share), "signed-in" (any account on this node) or "organism" (the members of the organisation in `organism_id`). `how_to_close` is one sentence naming the tool and the endpoint that closes it. `counts` gives the numbers by level and by kind; `notes` says what is not counted (a presigned download link, an access-coded app, a password-protected share, sharing groups). Where classification is on, an item carries `classification`: its effective label (`label`, `name`, `color`, and `from`: its own or the workspace, organism, board or app that raised it), the label\'s `max_audience` (the widest level it allows), and `conflict` when the item\'s level is wider than that. A conflict is listed first, with `lower_to`, the widest level its own setting can take within the cap; an item the person\'s own exception lets stay wider is `excepted`, not a conflict. The report\'s `classification` counts both. Tell the person about the conflicts first, then what is open to everyone, in their words, and offer to lower or close what they did not mean to share; change nothing without asking. Content of the person\'s agents is included, because it is theirs.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'What Others Can Read', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/exposure/mine asks: the report lists what the person holds.
        scope: 'memory:read',
        surfaces: ['agent', 'appdev', 'service'],
        input: {},
    },
] as const satisfies readonly AimeatToolDefinition[];
