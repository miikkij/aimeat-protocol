/**
 * @file spec-prompts.ts
 * @description Spec-generation prompts (extension spec, data-API spec, component spec, app-domain spec).
 *   Extracted verbatim from generator-prompt-seeds.ts — content is calibrated, DO NOT edit values.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompt-seeds.ts (pure extraction, no logic change)
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const SPEC_PROMPT_SEEDS: PromptSeedEntry[] = [
  // ═══════════════════════════════════════════════════════════════════
  // Spec Generation Prompts — kept from v1 (these were already correct)
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-extension-spec',
    group: 'generator',
    name: 'Extension Spec Generator',
    description: 'Generates formal JSON contract for an extension — actions, memory keys, schedules, config.',
    content: `{{disclaimer}}

# Task: Generate Extension Spec

You are designing the PUBLIC CONTRACT for an AIMEAT platform extension. This spec defines what the extension provides — actions, memory keys, schedules, config — with exact types and real examples from the data source.

This is a SPEC, not code. No implementation, no function bodies, no ctx calls.
This extension is a PLATFORM CAPABILITY — it knows nothing about any app, cortex, or UI.

## Data Sources
{{data_sources}}

## Actions From Blueprint (MUST use these EXACT action IDs)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your spec MUST include ALL actions listed below with the EXACT IDs.   ║
║  Do NOT rename them. Do NOT drop any. Do NOT merge them.               ║
║  The blueprint is the contract — every action must appear in your spec. ║
╚══════════════════════════════════════════════════════════════════════════╝

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
      "id": "<actionId>",
      "description": "<what this action does>",
      "method": "POST",
      "path": "/v1/ext/<name>/<actionId>",
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
    { "id": "<id>", "action": "<actionId>", "cron": "<expression>", "description": "<what>" }
  ],
  "config": { "<key>": "<type — description>" },
  "dataSources": [
    { "name": "<name>", "baseUrl": "<EXACT base URL from the data source above>", "notes": "<any important API details>" }
  ],
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
3. Extension name describes the PLATFORM CAPABILITY: e.g. "weather-data", not "weather-monitor-extension".
4. Do NOT mention any app, cortex, UI, or project.
5. The "dataSources" section MUST include the EXACT base URLs from the Data Sources section above. The code generator needs these URLs to implement the extension. Copy them character-for-character.
6. Action IDs MUST be camelCase: "getItems", NOT "get-items". This is the coding standard.
7. The "output" field MUST list actual field names and types — NEVER use "$ref". Expand all references into concrete field descriptions. The test generator needs real field names to write assertions.`,
    variables: ['disclaimer', 'data_sources', 'blueprint_actions', 'structures', 'memory_keys', 'schedules', 'config_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-data-api-spec',
    group: 'generator',
    name: 'Data API Spec Generator',
    description: 'Generates data cortex spec — method signatures wrapping extension actions.',
    content: `{{disclaimer}}

# Task: Generate Data API Spec

Design the public API for a DATA CORTEX — a client-side JS library that exposes clean async data methods. It EITHER wraps an AIMEAT extension's actions, OR (when the Extension Spec below is empty \`{}\` — i.e. this app has NO extension) reads the owner's own data directly via AIMEAT.data.get(ownerGaii, key). Both are fully supported; pick based on whether an Extension Spec is present.

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
  "wrapsExtension": "<extension name — or null if the Extension Spec above is empty / this app has no extension>",
  "methods": [
    { "name": "<method>", "description": "<what>", "params": "<type>", "returns": "Promise<type>",
      "example": "const r = await AIMEAT.<libName>.<name>(<args>);",
      "returnsExample": "<from extension spec>",
      "errorBehavior": "Returns null on failure" }
  ],
  "translationAccess": "getTranslations(locale) → Promise<object>",
  "settingsAccess": "getSettings() → Promise<object>"
}

## Required Methods (from blueprint — MUST use these EXACT names)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your spec MUST include ALL methods listed below with the EXACT names. ║
║  Do NOT rename them. Do NOT use the extension action names instead.    ║
║  The blueprint is the contract — every method must appear in your spec. ║
╚══════════════════════════════════════════════════════════════════════════╝

{{blueprint_methods}}

If an Extension Spec is provided, each method wraps one or more extension actions — map them appropriately.
For example, if the blueprint requires "getItems" and the extension has "fetchAllItems",
create a method named "getItems" that internally calls the extension's "fetchAllItems".
If the Extension Spec is empty (NO extension), each method instead reads and transforms the owner's own
data via AIMEAT.data.get(ownerGaii, "<memory key from the blueprint dataModel>"); set wrapsExtension to null
and take "returnsExample" from the blueprint structures rather than an extension spec.

## Rules
1. Method names MUST match the blueprint list above EXACTLY. Do NOT use extension action names as method names.
2. Return types MUST match extension spec output exactly.
3. Include getTranslations and getSettings — read from owner namespace.
4. All methods return null on failure. No exceptions.
5. params field MUST be an object type (e.g. "{ query: string, type: string }"), NEVER positional parameters.
6. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.`,
    variables: ['disclaimer', 'extension_spec', 'structures', 'blueprint_methods'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-component-spec',
    group: 'generator',
    name: 'Component Spec Generator',
    description: 'Generates reusable UI component spec — render signature, props, data access.',
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

## UI Components (daisyUI)

Choose daisyUI components for this feature's UI. The code generator uses your choices.

**Data display**: table, card, stat, carousel, timeline, chat, collapse
**Forms**: input, textarea, select, checkbox, radio, toggle, range, file-input
**Actions**: button (btn), dropdown, swap
**Feedback**: alert, badge, loading, progress, tooltip, toast
**Layout**: tabs, accordion, drawer, modal, hero, divider
**Navigation**: navbar, menu, breadcrumbs, pagination, steps

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
  "example": "<usage showing render() with realistic props>",
  "ui": {
    "layout": "<primary container: card | hero | none>",
    "components": ["<daisyUI component names>"],
    "navigation": "<tabs | menu | steps | breadcrumbs | none>"
  }
}

## Rules
1. Props include callbacks for interactions (onSelect, onAdd) — component doesn't navigate.
2. Component receives locale + translations as props.
3. Keep props minimal.
4. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.
5. The component loads translations internally via AIMEAT.data.get() — the translations prop is optional and can be omitted from the example.
6. ui.components: list daisyUI component names this feature uses. Code generator includes class reference for ONLY these.`,
    variables: ['disclaimer', 'component_label', 'view_context', 'data_api_spec', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app-domain-spec',
    group: 'generator',
    name: 'App-Domain Spec Generator',
    description: 'Generates app-domain cortex spec — composes components, manages navigation.',
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

## App Shell (daisyUI)

Choose layout and navigation for the app shell.

**Layout**: drawer (sidebar+content), navbar+content, hero+sections
**Navigation**: tabs, menu, breadcrumbs, steps, bottom-navigation, navbar
**Feedback**: modal, toast, alert

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
  "example": "await AIMEAT.<libName>.init(); AIMEAT.<libName>.render(el);",
  "appShell": "<drawer | navbar | tabs>",
  "navStyle": "<tabs | menu | breadcrumbs | steps>"
}

## Rules
1. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.
2. appShell and navStyle: choose daisyUI layout patterns from the list above.`,
    variables: ['disclaimer', 'component_specs', 'data_api_spec', 'use_cases', 'views', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },
];
