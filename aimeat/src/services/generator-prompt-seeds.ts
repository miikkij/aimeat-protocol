/**
 * @file generator-prompt-seeds.ts
 * @description Generator-specific prompt seed entries for the SystemPromptRecord database.
 *   These templates are editable from the admin dashboard after seeding.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial generator prompt seeds
 */

import type { PromptSeedEntry } from './prompt-defaults.js';

export const GENERATOR_PROMPT_SEEDS: PromptSeedEntry[] = [

  // ═══════════════════════════════════════════════════════════════════
  // Shared Fragments — building blocks used by multiple prompts
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-context',
    group: 'generator',
    name: 'AIMEAT Context',
    description: 'Shared preamble describing AIMEAT building blocks, extension sandbox API, and data standards. Injected into most generator prompts via {{context}}.',
    content: `You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust, fetch APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.

Extensions run in an ISOLATED V8 sandbox with ONLY this API (no Node.js, no global fetch, no setTimeout, no require, no import):
  ctx.memory.get(key) → value or null (ALWAYS null-check before using)
  ctx.memory.set(key, value) → void
  ctx.memory.search(prefix) → Array<{ key, value }>
  ctx.memory.delete(key) → boolean
  ctx.memory.getPublic(namespace, key) → value or null (read from DIFFERENT namespace)
  ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config object
  ctx.log.info/warn/error(msg, data)

AIMEAT Data Standards:
  Dates/times: ISO 8601 ONLY. Memory keys: lowercase dot-namespaced. IDs: URL-safe kebab-case.
  Locale codes: BCP 47. Coordinates: WGS84 decimal degrees. Currency: integers (morsels).`,
    variables: [],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-disclaimer',
    group: 'generator',
    name: 'Instruction Disclaimer',
    description: 'Prefix for all generator prompts — instructs the AI to follow rules exactly.',
    content: `IMPORTANT: These are detailed instructions that you MUST read carefully and follow exactly. Every rule, constraint, format requirement, and example below exists for a reason. Do NOT skip sections, do NOT invent your own conventions, and do NOT deviate from the specified output format. If a rule says "MUST" or "NEVER", treat it as absolute.`,
    variables: [],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-sandbox-constraints',
    group: 'generator',
    name: 'V8 Sandbox Constraints',
    description: 'Rules for extension code — what IS and IS NOT available in the V8 sandbox.',
    content: `## V8 Sandbox — What is NOT available
NONE of these work: require, import (except export default), Buffer, process, fs, path, crypto, URL, URLSearchParams, TextEncoder, TextDecoder, fetch (use ctx.fetch), Headers, Request, Response, FormData, Blob, atob, btoa, AbortController, structuredClone, performance, console (use ctx.log), setTimeout, setInterval.

## What IS available
Standard JavaScript: JSON, Math, Date, RegExp, Promise, async/await, String, Array, Object, Map, Set, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, Number, isNaN, isFinite, Error.

## Critical memory API rules
ctx.memory.get() returns the VALUE directly (already parsed), or null. NEVER use JSON.parse on it.
ctx.memory.search() returns Array<{key, value}> — NOT plain strings.
Always null-check: const data = await ctx.memory.get("key") || [];`,
    variables: [],
    usedIn: ['generator-autopilot'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Spec Generation Prompts
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-extension-spec',
    group: 'generator',
    name: 'Extension Spec Generator',
    description: 'Generates the formal JSON contract for an extension — actions, memory keys, schedules, config — with exact types and real examples from the data source.',
    content: `{{disclaimer}}

# Task: Generate Extension Spec

You are designing the PUBLIC CONTRACT for an AIMEAT platform extension. This spec defines what the extension provides — actions, memory keys, schedules, config — with exact types and real examples from the data source.

This is a SPEC, not code. No implementation, no function bodies, no ctx calls.
This extension is a PLATFORM CAPABILITY — it knows nothing about any app, cortex, or UI.

## Data Sources
{{data_sources}}

## Actions From Blueprint
{{blueprint_actions}}

## Data Structures
{{structures}}

## Memory Keys
{{memory_keys}}

## Schedules
{{schedules}}

## Config Keys
{{config_keys}}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation text.

{
  "name": "<kebab-case — describes the PLATFORM CAPABILITY>",
  "description": "<one-line: what this extension provides>",
  "actions": [
    {
      "id": "<action-id>",
      "description": "<what this action does>",
      "method": "POST",
      "path": "/v1/ext/<name>/<action-id>",
      "input": { "<param>": "<type and description>" },
      "output": { "<field>": "<type>" },
      "example": {
        "input": { "<real example from data source>" },
        "output": { "<real example — EXACT field names from sample data>" }
      },
      "errors": "<how errors are returned>"
    }
  ],
  "memoryKeys": [
    { "key": "<key>", "type": "<TypeScript type>", "description": "<what>", "example": "<value>" }
  ],
  "schedules": [
    { "id": "<id>", "action": "<action-id>", "cron": "<expression>", "description": "<what>" }
  ],
  "config": { "<key>": "<type — description>" },
  "usage": {
    "callPattern": "POST /v1/ext/<name>/<actionId> with JSON body",
    "authRequired": true,
    "memoryNamespace": "ext:<name>",
    "readMemory": "GET /v1/memory/ext%3A<name>/<key> (public, no auth)"
  }
}

## CRITICAL RULES
1. Use EXACT field names from data source sample entries. Copy character-for-character.
2. Every action MUST have an "example" with real data from the interview's sample entries.
3. Extension name describes the PLATFORM CAPABILITY: "prh-ytj", not "company-monitor-extension".
4. Do NOT mention any app, cortex, UI, or project.`,
    variables: ['disclaimer', 'data_sources', 'blueprint_actions', 'structures', 'memory_keys', 'schedules', 'config_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-data-api-spec',
    group: 'generator',
    name: 'Data API Spec Generator',
    description: 'Generates the data cortex spec — method signatures wrapping extension actions.',
    content: `{{disclaimer}}

# Task: Generate Data API Spec

Design the public API for a DATA CORTEX — a client-side JS library wrapping an AIMEAT extension.

## Extension Spec
\`\`\`json
{{extension_spec}}
\`\`\`

{{structures}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase — AIMEAT.<libName>>",
  "description": "<one-line>",
  "wrapsExtension": "<extension name>",
  "methods": [
    { "name": "<method>", "description": "<what>", "params": "<type>", "returns": "Promise<type>",
      "example": "const r = await AIMEAT.<libName>.<name>(<args>);",
      "returnsExample": <from extension spec>,
      "errorBehavior": "Returns null on failure" }
  ],
  "translationAccess": "getTranslations(locale) → Promise<object>",
  "settingsAccess": "getSettings() → Promise<object>"
}

## Rules
1. One method per extension action. Clean names (searchCompanies, not extSearchCompanies).
2. Return types MUST match extension spec output exactly.
3. Include getTranslations and getSettings — read from owner namespace.
4. All methods return null on failure. No exceptions.`,
    variables: ['disclaimer', 'extension_spec', 'structures'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-component-spec',
    group: 'generator',
    name: 'Component Spec Generator',
    description: 'Generates a reusable UI component spec — render signature, props, data access.',
    content: `{{disclaimer}}

# Task: Generate Component Spec

Design a REUSABLE UI COMPONENT — renders one thing well, composed by app-domain cortex.

## Component: {{component_label}}
{{view_context}}

## Available Data API
\`\`\`json
{{data_api_spec}}
\`\`\`

## Translation Keys
{{translation_keys}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase>",
  "purpose": "<one-line>",
  "render": {
    "signature": "AIMEAT.<libName>.render(container, props)",
    "props": { "<name>": "<type — description>" },
    "returns": "{ el: HTMLElement, destroy(): void, update(props): void }"
  },
  "dataAccess": ["<data API methods used>"],
  "example": "<usage showing render() with realistic props>"
}

## Rules
1. Props include callbacks for interactions (onSelect, onAdd) — component doesn't navigate.
2. Component receives locale + translations as props.
3. Keep props minimal.`,
    variables: ['disclaimer', 'component_label', 'view_context', 'data_api_spec', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app-domain-spec',
    group: 'generator',
    name: 'App-Domain Spec Generator',
    description: 'Generates the app-domain cortex spec — composes components, manages navigation.',
    content: `{{disclaimer}}

# Task: Generate App-Domain Cortex Spec

Design the top-level composition layer — composes components into views, manages auth, translations, business logic.

## Available Components
{{component_specs}}

## Available Data API
\`\`\`json
{{data_api_spec}}
\`\`\`

## Use Cases
{{use_cases}}

## Views
{{views}}

## Translation Keys
{{translation_keys}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase>",
  "methods": {
    "init": "async () → { session, translations, settings }",
    "render": "(container) → void",
    "t": "(key) → string",
    "switchLocale": "(locale) → void"
  },
  "views": ["<view>"],
  "navigation": "<sidebar | tabs>",
  "viewComposition": { "<view>": ["<components>"] },
  "scriptDependencies": ["<ordered script URLs>"],
  "example": "await AIMEAT.<libName>.init(); AIMEAT.<libName>.render(el);"
}`,
    variables: ['disclaimer', 'component_specs', 'data_api_spec', 'use_cases', 'views', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Code Generation Prompts
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-extension-code',
    group: 'generator',
    name: 'Extension Code Generator',
    description: 'Generates the full extension (YAML manifest + JS action files) from spec + data sources.',
    content: `{{disclaimer}}

{{context}}

Create an AIMEAT Extension for: {{label}}

{{spec_section}}

{{sandbox_constraints}}

## ctx.memory API — CRITICAL

ctx.memory.get() returns the VALUE directly (already parsed), or null. NEVER use JSON.parse() on it.
ctx.memory.set(key, value) stores any JSON-serializable value.
ctx.memory.search(prefix) returns Array<{key, value}> — NOT strings.
ctx.memory.getPublic(namespace, key) reads from ANY namespace (public only).

Owner data (seed data, settings, translations): use ctx.memory.getPublic(ctx.caller.gaii, key)

## Output format — SINGLE code block

Return YAML manifest + all JS files in ONE block, separated by // actions/filename.js comments.

## Rules
- metadata: name, version, description, author required
- actions: each needs id, method, path, script
- Each script: export default async function(ctx, input) { ... }
- NEVER call JSON.parse on ctx.memory.get results
- Always null-check memory values
- Each action is INDEPENDENT — no cross-file references

{{completed_context}}`,
    variables: ['disclaimer', 'context', 'label', 'spec_section', 'sandbox_constraints', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-csm',
    group: 'generator',
    name: 'CSM Generator',
    description: 'Generates a Community Service Manifest YAML — data schema, consent, moderation.',
    content: `{{disclaimer}}

{{context}}

Create a CSM (Community Service Manifest) YAML for: {{label}}

## YAML STRING RULES
Every string value MUST be on ONE line wrapped in double quotes. No block scalars (> or |).

## Structure
Return ONLY valid YAML with: csm, service (name, type, description, version), schema_mode, data_schema (required, optional), consent_requirements, moderation, ui_hints.

## Rules
- data_schema fields are MAPS not arrays
- Only include fields from raw source data, not computed values
- service.name: concise kebab-case`,
    variables: ['disclaimer', 'context', 'label'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-memory',
    group: 'generator',
    name: 'Memory Generator',
    description: 'Generates seed memory data — key-value pairs with indexes and metadata.',
    content: `{{disclaimer}}

{{context}}

Define memory structure for: {{label}}

## Memory Key Conventions
- namespace.__meta — version, key format, description
- namespace.__index — lightweight index for fast lookups
- namespace.YYYY-MM-DD — date-bucketed data
- Prefer fewer, larger keys over many small keys

Return a JSON object where keys are memory key names and values are initial data.`,
    variables: ['disclaimer', 'context', 'label'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-translation',
    group: 'generator',
    name: 'Translation Generator',
    description: 'Generates per-locale i18n strings — one locale per component.',
    content: `{{disclaimer}}

{{context}}

Create translations for: {{label}}

## Rules
- Generate ONLY the locale indicated by the label (Finnish OR English, not both)
- Keys use dot-namespaced paths: "app.nav.home", "app.filters.status"
- Finnish must be natural Finnish with correct ä, ö, å
- Include ALL text: labels, buttons, tooltips, empty states, errors

{{matching_keys_section}}

Return JSON with translations for the SINGLE locale from the label.`,
    variables: ['disclaimer', 'context', 'label', 'matching_keys_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-fix',
    group: 'generator',
    name: 'Fix Prompt',
    description: 'Prompt for fixing validation/test failures — includes original prompt, code, and errors.',
    content: `{{disclaimer}}

The following code was generated but has errors. Fix them.

## Original prompt (what was requested):
{{original_prompt}}

## Generated code (has errors):
{{code}}

## Errors to fix:
{{errors}}

## Rules
- Fix ONLY the listed errors
- Do NOT change working parts
- Return the COMPLETE fixed code, not just the changed parts
- Same output format as the original prompt`,
    variables: ['disclaimer', 'original_prompt', 'code', 'errors', 'component_type'],
    usedIn: ['generator-autopilot'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Test Generation Prompts
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-test-extension-spec',
    group: 'generator',
    name: 'Extension Test (from Spec)',
    description: 'Generates test code from the extension spec — asserts exact field names from spec examples.',
    content: `{{disclaimer}}

# Task: Generate Extension Test From Spec

Test that the extension matches its SPEC CONTRACT. If the test fails, the CODE is wrong — not the spec.

## Extension: {{extension_name}}

## Actions to Test
{{spec_actions}}

## Memory Keys to Verify
{{memory_keys}}

## Environment: Server-side sandbox
Helpers: callExt(extName, actionId, body), readExtMemory(extName, key)
End with: return { passed: boolean, errors: string[], details: string }

## Rules
- Assert EXACT field names from the spec
- For external APIs: check shape, not specific values
- For memory writes: read back and verify
- Test must be idempotent

Return ONLY executable JavaScript. No markdown fences.`,
    variables: ['disclaimer', 'extension_name', 'spec_actions', 'memory_keys'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-cortex-spec',
    group: 'generator',
    name: 'Data Cortex Test (from Spec)',
    description: 'Generates test code from the data API spec — tests each method via AIMEAT global.',
    content: `{{disclaimer}}

# Task: Generate Data Cortex Test From Spec

Test that cortex methods match their spec contracts.

## Cortex: AIMEAT.{{lib_name}}
Wraps: {{wraps_extension}}

## Methods to Test
{{spec_methods}}

## Environment: Browser (page.evaluate sandbox)
Access: window.AIMEAT.{{lib_name}}
Auth IS available.
Set results: window.__testResults = { passed, errors, details }

## Rules
- Assert EXACT field names from spec
- Methods return null on failure (not throw)
- For arrays: assert Array.isArray and length > 0

Return ONLY executable JavaScript. No markdown fences.`,
    variables: ['disclaimer', 'lib_name', 'wraps_extension', 'spec_methods'],
    usedIn: ['generator-autopilot'],
  },

];
