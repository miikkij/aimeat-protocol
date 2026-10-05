/**
 * @file ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the System 2 AI tools (docs/internal/llmproviderintegrations/07):
 *   the node MCP (src/mcp/ai-policy.ts), the connector MCP (src/cli/connect/mcp/tools/ai-policy.ts)
 *   and the shell dispatch (src/tool-dispatch/tool-call-defs-ai-models.ts) all read their name,
 *   description and input from here.
 * @version-history
 *   2026-10-06 — aimeat_ai_policy_set and aimeat_ai_routing_set ask ai:use as well, the word the read
 *     they make when given nothing asks (secaudit 2026-10 follow-up, A4).
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.3.2 — 2026-10-02 — aimeat_ai_capabilities names agentFix, fix and settingsUrl.
 *   v1.3.1 — 2026-09-28 — aimeat_ai_role_set's bindings: null also dismisses the app's request; a role
 *     that lacks a capability the app's role needs is refused.
 *   v1.3.0 — 2026-09-28 — AI roles: aimeat_ai_roles and aimeat_ai_role_set; `role` (AI_ROLE_PARAM) on
 *     aimeat_ai_transcribe and aimeat_ai_embed.
 *   v1.2.1 — 2026-09-28 — aimeat_ai_embed's description: only when the person decided it, for a
 *     collection far larger than one prompt; never proposed by the AI.
 *   v1.2.0 — 2026-09-28 — aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and
 *     aimeat_ai_embed (System 2 plan, V5).
 *   v1.1.0 — 2026-09-28 — aimeat_ai_providers, aimeat_ai_provider_test and aimeat_ai_routing_set
 *     (System 2 plan, V3).
 *   v1.0.0 — 2026-09-28 — aimeat_ai_policy_set (System 2 plan, V2).
 */
import { z } from 'zod';
import { type AimeatToolDefinition, agentEverywhere } from './types.js';

/** The `role` parameter of every tool that makes an AI call, in one wording (services/ai/roles.ts). */
export const AI_ROLE_PARAM = 'The AI role to run as: one of your roles (aimeat_ai_roles), or for an app a role it declares and you bound. A named model or provider wins over it.';

export const aiModelTools = [
  {
    name: 'aimeat_ai_policy_set',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'Set the AI Model Policy (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Which models every AI call of the owner may use: a rule the owner set over their own apps and agents.
        // Given nothing, the tool reads the policy, which GET /v1/ai/policy gates on ai:use; both
        // words, so it is offered only to an agent both of its calls admit (secaudit 2026-10 follow-up, A4).
        scope: ['memory:write-reserved', 'ai:use'],
        surfaces: ['agent', 'admin'],
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
        annotations: { title: 'List AI Providers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Reading the providers shows no key; a test spends like a call.
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'List the AI providers the owner\'s calls can use: the owner\'s own (OpenAI, Anthropic, Mistral, xAI, '
      + 'OpenRouter, a local server, any OpenAI-compatible address, or an installed extension of theirs), and the node\'s. For each: its type, which '
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
        annotations: { title: 'Test an AI Provider', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'Test that one of the owner\'s providers serves one capability, with the smallest real call through the '
      + 'same gate every call uses (billed and budgeted like one). A pass marks it tested and working, which the node '
      + 'needs before it picks the provider by capability alone. capability: text (default), vision, files, '
      + 'transcription, speech (one spoken word), embed (one vector), or image (costs one small picture, so '
      + 'accept_cost: true is required; tell the owner first). '
      + 'Answers the model, the latency and the cost, never a key.',
    input: {
      provider: { type: 'string', description: 'The provider id, from aimeat_ai_providers.', required: true },
      capability: { type: 'string', description: 'text | vision | files | transcription | speech | embed | image. Default text.' },
      accept_cost: { type: 'boolean', description: 'Required true for an image test, which the provider charges for.' },
    },
  },
  {
    name: 'aimeat_ai_routing_set',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'Set the AI Routing (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Which provider answers first and whether a fallback may leave this machine: the owner's rule.
        // Given nothing, the tool reads the routing, which GET /v1/ai/routing gates on ai:use; both
        // words, so it is offered only to an agent both of its calls admit (secaudit 2026-10 follow-up, A4).
        scope: ['memory:write-reserved', 'ai:use'],
        surfaces: ['agent', 'admin'],
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
  {
    name: 'aimeat_ai_capabilities',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'What AI Can Do Here', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // What the caller can do, the catalogue, and two calls that spend like any other.
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'CALL THIS FIRST before you plan anything that uses AI: an app, an automation or your own work. Answers, '
      + 'per capability (text, vision, files, image, speech, transcription, embed), whether it is on for you right now, '
      + 'the model and provider a call would use, its price from the model catalogue, and a one-line howTo. For a '
      + 'capability that is off: the reason (NO_MODEL, NO_PROVIDER_SUPPORTS, NO_KEY, POLICY_EMPTY, BUDGET_EXHAUSTED, '
      + 'RETIRED_MODEL, UNTESTED, APP_NOT_ALLOWED), agentFix (what you can do), fix (the sentence to tell the owner, in their language) '
      + 'and settingsUrl (the link that opens their AI settings where it is fixed). Also the '
      + 'owner\'s model policy, today\'s budget, and the guide skill (aimeat-ai-capabilities). Spends nothing.',
    input: {
      app_id: { type: 'string', description: 'The app you act for, when you do: its own model list and preferences count.' },
    },
  },
  {
    name: 'aimeat_ai_models',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'List AI Models', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'The model catalogue: which models of OpenRouter, OpenAI, Anthropic, xAI, Mistral and DeepSeek the node '
      + 'knows, what each takes and gives (caps), its limits, its price and its status (active, retiring, retired). '
      + 'allowed: true keeps only the models you can use now (a provider of that type serves the capability, and the '
      + 'owner\'s policy allows the model). Use the `ref` it lists (<type>:<model id>) in a call, a policy or an app\'s '
      + 'aimeat-ai meta. A model on the owner\'s own machine is not in the catalogue.',
    input: {
      capability: { type: 'string', description: 'text | vision | files | image | speech | transcription | embed.' },
      type: { type: 'string', description: 'openrouter | openai | anthropic | xai | mistral | deepseek.' },
      status: { type: 'string', description: 'Comma-separated: active, retiring, retired; or all. Default active,retiring.' },
      allowed: { type: 'boolean', description: 'true: only the models you can use now.' },
    },
  },
  {
    name: 'aimeat_ai_transcribe',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'Transcribe Audio', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'Transcribe an audio file in your storage to text, on the owner\'s providers and budget (the '
      + 'transcription capability). Store the file first (aimeat_storage_upload) and pass its storage_key. Answers the '
      + 'text, the model, the language, the seconds and what it cost. Refusals name what to set (NO_STT_MODEL, '
      + 'AI_CAPABILITY_UNAVAILABLE with a fix).',
    input: {
      storage_key: { type: 'string', description: 'The audio file\'s key in your storage.', required: true },
      filename: { type: 'string', description: 'The file name the provider sees; its extension names the format. Defaults to the key\'s last part.' },
      language: { type: 'string', description: 'ISO-639-1 hint (fi, en). Omit to let the model detect it.' },
      model: { type: 'string', description: 'A model reference; omit to let the owner\'s providers choose.' },
      provider: { type: 'string', description: 'A provider id or type to use, with no fallback.' },
      app_id: { type: 'string', description: 'The app this is for, so its spend is attributed.' },
      role: { type: 'string', description: AI_ROLE_PARAM, zod: z.string().min(1).max(300) },
    },
  },
  {
    name: 'aimeat_ai_embed',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'Make Embeddings', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'Turn texts into embedding vectors (the embed capability), on the owner\'s providers and budget. Use it '
      + 'only when the person decided it: never propose it yourself. It is for a collection far larger than one prompt '
      + '(hundreds of thousands of tokens) that people search by meaning; a collection that fits one prompt goes to a '
      + 'text model whole, and word search comes first (skill aimeat-ai-capabilities, section 4). Store '
      + 'the answered `model` beside the vectors: vectors of different models cannot be compared, so a fallback only '
      + 'ever uses the same model. At most 256 texts and 500 000 characters per call.',
    input: {
      input: { type: 'array', description: 'The texts, one vector each.', required: true, zod: z.array(z.string()).min(1) },
      model: { type: 'string', description: 'A model reference; omit to let the owner\'s providers choose.' },
      provider: { type: 'string', description: 'A provider id or type to use, with no fallback.' },
      app_id: { type: 'string', description: 'The app this is for, so its spend is attributed.' },
      role: { type: 'string', description: AI_ROLE_PARAM, zod: z.string().min(1).max(300) },
    },
  },
  {
    name: 'aimeat_ai_roles',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'List AI Roles', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The roles show no key; changing one or binding an app's role is the owner's rule, as the routing is.
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
    description: 'List the owner\'s AI roles and the AI roles apps ask for. A capability says what a model does (text, '
      + 'vision, files, image, speech, transcription, embed); a role says what it is used for: the built-in reasoning '
      + 'and execution, or one the owner made (for example summarizer). For each capability it needs, a role has its own '
      + 'ordered providers and models, and it may keep to this machine (local) or set a price ceiling per call. Pass a '
      + 'role id as `role` in an AI call to run as it. An app declares the roles it needs in its aimeat-ai meta, and an '
      + 'app\'s role runs only after the owner binds it to one of their roles. For each app the answer lists its roles '
      + 'with the binding (boundTo, null while unbound) and, for an unbound role the app already asked for, requestedAt: '
      + 'show the owner which app roles wait for a binding, and propose one with aimeat_ai_role_set.',
    input: {},
  },
  {
    name: 'aimeat_ai_role_set',
    caller: 'agent',
    visibility: agentEverywhere,
        annotations: { title: 'Set the AI Roles (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write-reserved',
        surfaces: ['agent', 'admin'],
    description: 'Change the owner\'s AI roles, or bind an app\'s AI role to one of them, with PROPOSE-THEN-CONFIRM. With '
      + 'roles, bindings or both and no confirm_token: changes NOTHING and returns the current and proposed change with a '
      + 'single-use token (10 min) bound to exactly that change; show it to the owner. With the same change plus the '
      + 'token: applies it. roles: { "<role id>": { title, purpose?, capabilities: { "<capability>": [{ provider, '
      + 'model? }, ...] }, local?, maxCostPerCallUsd? } or null to remove } (an id is lower-case letters, digits and '
      + '"-"; the first provider is tried first, at most 5; the built-in reasoning and execution cannot be removed). '
      + 'bindings: { "<owner>/<file>.html#<role name>": "<your role id>" or null to unbind }. Binding an app\'s role is '
      + 'the owner\'s approval of what that app may run. Read the roles and the providers first (aimeat_ai_roles, '
      + 'aimeat_ai_providers).',
    input: {
      roles: { type: 'object', description: '{ "<role id>": { title, purpose?, capabilities: {capability: [{provider, model?}]}, local?, maxCostPerCallUsd? } or null }.' },
      bindings: { type: 'object', description: '{ "<owner>/<file>.html#<role name>": "<your role id>" or null }. Null unbinds and dismisses the app\'s request; a role that lacks a capability the app\'s role needs is refused.' },
      confirm_token: { type: 'string', description: 'Token from the propose step; omit to propose.' },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
