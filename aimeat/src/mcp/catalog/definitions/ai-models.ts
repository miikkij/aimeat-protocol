/**
 * @file ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the System 2 AI tools (docs/internal/llmproviderintegrations/07):
 *   the node MCP (src/mcp/ai-policy.ts), the connector MCP (src/cli/connect/mcp/tools/ai-policy.ts)
 *   and the shell dispatch (src/tool-dispatch/tool-call-defs-ai-models.ts) all read their name,
 *   description and input from here.
 * @version-history
 *   v1.1.0 — 2026-09-28 — aimeat_ai_providers, aimeat_ai_provider_test and aimeat_ai_routing_set
 *     (System 2 plan, V3).
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
  {
    name: 'aimeat_ai_providers',
    caller: 'agent',
    visibility: agentEverywhere,
    description: 'List the AI providers the owner\'s calls can use: the owner\'s own (OpenAI, Anthropic, Mistral, xAI, '
      + 'OpenRouter, a local server or any OpenAI-compatible address), and the node\'s. For each: its type, which '
      + 'capabilities it serves (text, vision, files, image, speech, transcription, embed) with which model, whether the '
      + 'node may pick it by capability alone (pool), whether it is tested and working (health), where the data goes, and '
      + 'whether a key is set (never the key). Also the owner\'s routing: the ordered providers per capability and the '
      + 'rules. Read this before naming a provider or model in a call, and to explain a refusal. A key is set only by the '
      + 'owner on the AI settings page, never through a tool.',
    input: {},
  },
  {
    name: 'aimeat_ai_provider_test',
    caller: 'agent',
    visibility: agentEverywhere,
    description: 'Test that one of the owner\'s providers serves one capability, with the smallest real call through the '
      + 'same gate every call uses (billed and budgeted like one). A pass marks it tested and working, which the node '
      + 'needs before it picks the provider by capability alone. capability: text (default), vision, files, '
      + 'transcription, or image (costs one small picture, so accept_cost: true is required; tell the owner first). '
      + 'Answers the model, the latency and the cost, never a key.',
    input: {
      provider: { type: 'string', description: 'The provider id, from aimeat_ai_providers.', required: true },
      capability: { type: 'string', description: 'text | vision | files | transcription | image. Default text.' },
      accept_cost: { type: 'boolean', description: 'Required true for an image test, which the provider charges for.' },
    },
  },
  {
    name: 'aimeat_ai_routing_set',
    caller: 'agent',
    visibility: agentEverywhere,
    description: 'Read or change which provider answers each AI capability and the rules for moving to the next, with '
      + 'PROPOSE-THEN-CONFIRM. With no routing: returns the current routing and the providers. With a routing and no '
      + 'confirm_token: changes NOTHING and returns the current and proposed routing with a single-use token (10 min) '
      + 'bound to exactly that change; show it to the owner. With the token: applies it. routing: { defaults?: '
      + '{ "<capability>": ["<provider id>", ...] } (first is the default, the rest are fallbacks), rules?: { fallback, '
      + 'maxAttempts (1-5), onlyTested, extendToPool, fallbackOn: [timeout, rate_limit, server_error, unavailable, auth], '
      + 'fallbackMayLeaveMachine, speechVoiceMayChange, maxCostPerCallUsd }, agent?: "<agent name>" to set that agent\'s '
      + 'own defaults instead (an agent\'s record has no rules). A named capability\'s list replaces the old one.',
    input: {
      routing: { type: 'object', description: '{ defaults?: {capability: [provider ids]}, rules?: {...}, agent?: name }. Omit to read.' },
      confirm_token: { type: 'string', description: 'Token from the propose step; omit to propose.' },
    },
  },
];
