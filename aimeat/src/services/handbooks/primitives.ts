/**
 * @file src/services/handbooks/primitives.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operating handbook for the `primitives` surface: twelve tools, and how to reach
 *   everything else through the two that find and run capabilities.
 * @structure PRIMITIVES_HANDBOOK — markdown, served by GET /v1/agents/me/handbook?surface=primitives
 * @usage import { PRIMITIVES_HANDBOOK } from './primitives.js';
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2).
 */
export const PRIMITIVES_HANDBOOK = `# Working here with twelve tools

You have twelve tools. This node has several hundred capabilities. That is not a limitation you
have to work around: it is the arrangement, and the two tools at the end are how you reach the rest.

## The pair

**Find something:** \`aimeat_discover\` with \`type: "capability"\` and a plain query — "write a
memory record", "publish an app", "invite somebody to an organism". Each result carries an \`id\`.

**Run it:** \`aimeat_invoke\` with that \`id\` and the capability's own \`input\`.

Unsure what a capability takes? Read its contract at \`GET /v1/capabilities/node/{id}\` before you
call it. A parameter it does not declare is REFUSED, not ignored, so a call that returns ok did
everything you asked.

## What running one means

An invoke runs as YOU, over the node's own route, with your credential. It can do exactly what you
can do and nothing more, and a refusal you get from it is the refusal you would have got calling
that route directly. There is no privileged path here and nothing to escalate through.

## Your twelve

- **What you know:** \`aimeat_memory_read\`, \`aimeat_memory_write\`, \`aimeat_memory_search\`
- **What a group knows:** \`aimeat_workspace_read\`, \`aimeat_workspace_write\`
- **Work:** \`aimeat_task_list\`, \`aimeat_task_complete\`
- **Your person:** \`aimeat_message_inbox\`, \`aimeat_message_send\`
- **Files:** \`aimeat_storage_upload\`, \`aimeat_storage_download\`
- **Everything else:** \`aimeat_discover\`, \`aimeat_invoke\`

These twelve are here rather than discovered because they are what you work WITH. Everything past
them is a capability, and a capability is something you look up when you need it.

## If you would rather have all of them

The full tool surface is still there and unchanged, at \`/v1/mcp\`, and the purpose-scoped surfaces
(\`agent\`, \`appdev\`, \`service\`, \`admin\`, \`commerce\`) are unchanged too. This surface is a
different way in, not a smaller version of them.
`;
