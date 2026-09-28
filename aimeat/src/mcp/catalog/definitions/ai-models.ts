/**
 * @file ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the System 2 AI tools (docs/internal/llmproviderintegrations/07):
 *   the node MCP (src/mcp/ai-policy.ts), the connector MCP (src/cli/connect/mcp/tools/ai-policy.ts)
 *   and the shell dispatch (src/tool-dispatch/tool-call-defs-ai-models.ts) all read their name,
 *   description and input from here.
 * @version-history
 *   v1.0.0 — 2026-09-28 — aimeat_ai_policy_set (System 2 plan, V2).
 */
import { type AimeatToolDefinition, agentEverywhere } from './types.js';

export const aiModelTools: AimeatToolDefinition[] = [
  {
    name: 'aimeat_ai_policy_set',
    caller: 'agent',
    visibility: agentEverywhere,
    description: 'Read or change which AI models the owner\'s calls may use, with PROPOSE-THEN-CONFIRM. '
      + 'With no policy: returns the current policy and the node\'s recommended models. With a policy and no confirm_token: '
      + 'changes NOTHING and returns the current and proposed policy with a single-use token (10 min) bound to exactly that '
      + 'policy; show the change to the owner. With the token: applies it. Modes: open (no limit), recommended (the node\'s '
      + 'list per capability, following its updates), custom (allow: your own list). Every reference is <type>:<model id>, '
      + 'e.g. openrouter:anthropic/claude-opus-5.5. appliesTo switches say whose calls it covers (owner, chat, agents, apps); '
      + 'apps and agents tighten it for one app (owner/file.html) or one agent. Every layer only tightens. '
      + 'Suggest mode recommended when the owner has a provider and no policy.',
    input: {
      policy: { type: 'object', description: '{ mode: open|recommended|custom, allow?: [refs], appliesTo?: {owner, chat, agents, apps}, apps?: {"owner/file.html": {allow}}, agents?: {name: {allow}} }. Omit to read.' },
      confirm_token: { type: 'string', description: 'Token from the propose step; omit to propose.' },
    },
  },
];
