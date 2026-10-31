/**
 * @file chat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The handbook of the `chat` surface (/v2/mcp/chat), the node's own chat: the agent
 *   handbook, because the chat is the owner's own agent, after one paragraph on how its tool list
 *   works. The handbook names tools by the job, and on this surface most of them start switched off
 *   (mcp/tool-loader.ts), so a model reading "use aimeat_decide" has to know that the tool is one
 *   call away rather than missing.
 * @structure CHAT_HANDBOOK
 * @version-history
 *   v1.1.0 — 2026-10-31 — A found tool is run with aimeat_invoke first; goose refuses one called by name
 *     until it reads its list again (v31 K35).
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { AGENT_HANDBOOK } from './agent.js';

const TOOL_LIST = `## Your tool list here

This chat starts with a small tool list: the tools most jobs need. Every other tool this guide names is still yours, one call away. When you need one you do not see, call \`aimeat_tools_find\` with what you want to do ("add a contact", "decide on a message", "publish an app"); run one of the tools it finds with \`aimeat_invoke\` (its name as \`capability\`, its inputs as \`input\`), which works at once. A call by name works only after your client has read its tool list again, which some do only on the next message. Look before you tell the person something cannot be done.`;

export const CHAT_HANDBOOK = `${TOOL_LIST}\n\n${AGENT_HANDBOOK}`;
