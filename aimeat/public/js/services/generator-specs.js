/**
 * @file generator-specs.js
 * @description Spec generation prompt builders — produce structured JSON specs
 *   that serve as formal contracts between pipeline layers. Spec is king:
 *   code is generated to match the spec, probes validate code against spec,
 *   if mismatch the CODE is regenerated (spec stays).
 * @structure
 *   - buildExtensionSpecPrompt: extension spec from blueprint + interview
 *   - buildDataApiSpecPrompt: data API spec from extension spec
 *   - buildComponentSpecPrompt: component spec from data API spec
 *   - buildAppDomainSpecPrompt: app-domain spec from component specs
 *   - formatSpecForPrompt: render spec JSON as clean prompt section
 * @usage
 *   import { buildExtensionSpecPrompt, formatSpecForPrompt } from '/js/services/generator-specs.js';
 * @version-history
 *   v1.0.0 — 2026-03-31 — Initial spec prompt builders
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

/**
 * Build prompt to generate an extension spec from the blueprint.
 * The spec defines the extension's public contract — actions, memory keys,
 * schedules, config — with exact types and examples from interview sample data.
 *
 * The extension spec is PROJECT-AGNOSTIC: it describes a platform capability,
 * not a component of a specific app. No mention of cortex, app, or UI.
 *
 * @param {object} params
 * @param {object} params.blueprint - Full blueprint JSON
 * @param {object} params.blueprintComponent - The extension component entry from blueprint.components[]
 * @param {object} params.interviewSpec - Interview JSON with data sources + sample data
 * @returns {string} Prompt text
 */
export function buildExtensionSpecPrompt({ blueprint, blueprintComponent, interviewSpec }) {
  const structures = blueprint.dataModel?.structures || {};
  const memoryKeys = blueprint.dataModel?.memoryKeys || {};
  const actions = blueprint.dataModel?.actions || {};

  // Collect data sources from interview — URLs, sample responses, response envelopes
  const dataSources = (interviewSpec?.dataSources || []).map(ds => ({
    name: ds.name,
    url: ds.url,
    responseEnvelope: ds.responseEnvelope || null,
    sampleEntry: ds.sampleEntry || null,
    sampleResponse: ds.sampleResponse || null,
    notes: ds.notes || '',
  }));

  // Collect schedules from blueprint component
  const schedules = blueprintComponent.schedules || [];

  // Collect config keys from blueprint settings
  const settingsArr = Array.isArray(blueprint.settings)
    ? blueprint.settings
    : [...(blueprint.settings?.service || []), ...(blueprint.settings?.user || [])];
  const configKeys = settingsArr.map(s => ({
    key: s.key, type: s.type || 'string', label: s.label || s.key,
  }));

  // Filter actions for this component
  const compActions = Object.entries(actions)
    .filter(([, v]) => v.component === blueprintComponent.id)
    .map(([name, def]) => ({
      id: name.replace(/^ext:/, '').replace(/^[^/]+\//, ''),
      description: def.description || '',
      input: def.input || {},
      output: def.output || {},
    }));

  // Filter memory keys for this component
  const compMemoryKeys = Object.entries(memoryKeys)
    .filter(([, v]) => v.producedBy === blueprintComponent.id || v.consumedBy?.includes(blueprintComponent.id))
    .map(([key, def]) => ({
      key,
      direction: def.producedBy === blueprintComponent.id ? 'writes' : 'reads',
      description: def.description || '',
    }));

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Extension Spec

You are designing the PUBLIC CONTRACT for an AIMEAT platform extension. This spec defines what the extension provides — actions, memory keys, schedules, config — with exact types and real examples from the data source.

This is a SPEC, not code. No implementation, no function bodies, no ctx calls.
This extension is a PLATFORM CAPABILITY — it knows nothing about any app, cortex, or UI.

## Data Sources
${dataSources.map(ds => `- **${ds.name}**: ${ds.url || 'user-input'}
${ds.responseEnvelope ? `  Response envelope: \`${typeof ds.responseEnvelope === 'string' ? ds.responseEnvelope : JSON.stringify(ds.responseEnvelope)}\`` : ''}
${ds.sampleEntry ? `  Sample entry:\n\`\`\`json\n${typeof ds.sampleEntry === 'string' ? ds.sampleEntry : JSON.stringify(ds.sampleEntry, null, 2)}\n\`\`\`` : ''}
${ds.sampleResponse ? `  Sample response:\n\`\`\`json\n${typeof ds.sampleResponse === 'string' ? ds.sampleResponse.slice(0, 2000) : JSON.stringify(ds.sampleResponse, null, 2).slice(0, 2000)}\n\`\`\`` : ''}
${ds.notes ? `  Notes: ${ds.notes}` : ''}`).join('\n\n')}

## Actions From Blueprint
${compActions.length > 0 ? compActions.map(a => `- **${a.id}**: ${a.description}
  Input: \`${JSON.stringify(a.input)}\`
  Output: \`${JSON.stringify(a.output)}\``).join('\n') : 'Infer from data sources and use cases.'}

## Data Structures
${Object.entries(structures).length > 0 ? Object.entries(structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n') : 'Infer from data source sample entries.'}

## Memory Keys
${compMemoryKeys.length > 0 ? compMemoryKeys.map(k => `- \`${k.key}\` (${k.direction}): ${k.description}`).join('\n') : 'Infer from actions — what data does the extension need to persist between calls?'}

## Schedules
${schedules.length > 0 ? schedules.map(s => `- ${s.action}: ${s.cron} — ${s.description || ''}`).join('\n') : 'None. Add @activate init if the extension needs initialization.'}

## Config Keys
${configKeys.length > 0 ? configKeys.map(k => `- ${k.key} (${k.type}): ${k.label}`).join('\n') : 'None.'}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation text.

{
  "name": "<kebab-case — describes the PLATFORM CAPABILITY, not a project>",
  "description": "<one-line: what this extension provides as a platform capability>",
  "actions": [
    {
      "id": "<actionId>",
      "description": "<what this action does>",
      "method": "POST",
      "path": "/v1/ext/<name>/<actionId>",
      "input": { "<param>": "<type and description>" },
      "output": { "<field>": "<type>" },
      "example": {
        "input": { "<real example from data source — use actual values>" },
        "output": { "<real example — EXACT field names from sample data>" }
      },
      "errors": "<how errors are returned, e.g. { error: 'message' }>"
    }
  ],
  "memoryKeys": [
    {
      "key": "<memory-key-name>",
      "type": "<TypeScript-style type, e.g. Array<{ businessId: string, addedAt: string }>>",
      "description": "<what this key stores>",
      "example": "<example value matching the type>"
    }
  ],
  "schedules": [
    { "id": "<id>", "action": "<actionId>", "cron": "<cron or @activate>", "description": "<what>" }
  ],
  "config": {
    "<key>": "<type — description>"
  },
  "usage": {
    "callPattern": "POST /v1/ext/<name>/<actionId> with JSON body",
    "authRequired": true,
    "memoryNamespace": "ext:<name>",
    "readMemory": "GET /v1/memory/ext%3A<name>/<key> (public, no auth needed)"
  }
}

## CRITICAL RULES

1. Use EXACT field names from the data source sample entries. If the API returns "totalResults" and "companies", write those — not "total" and "results". Copy character-for-character.
2. Every action MUST have an "example" with real data from the interview's sample entries.
3. The "output" types must match the example — if example has { companies: [...] }, output must have "companies".
4. Extension name describes the PLATFORM CAPABILITY: "prh-ytj" (PRH company data), not "company-monitor-extension".
5. Do NOT mention any app, cortex, UI, or project. This spec describes a standalone platform capability.
6. Memory key types must be precise enough to generate tests: "Array<{ businessId: string, addedAt: string }>" not "array".
`;
}

/**
 * Build prompt to generate a data API spec from the extension spec.
 * The data API spec defines the client-side JS library that wraps the extension.
 *
 * @param {object} params
 * @param {object} params.extensionSpec - The extension spec JSON (from buildExtensionSpecPrompt output)
 * @param {object} params.blueprint - The blueprint (for additional structure definitions)
 * @returns {string} Prompt text
 */
export function buildDataApiSpecPrompt({ extensionSpec, blueprint }) {
  const structures = blueprint?.dataModel?.structures || {};

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Data API Spec

You are designing the public API for a DATA CORTEX — a client-side JavaScript library that wraps an AIMEAT extension into clean async methods. Apps and UI components will call this library — they will never call the extension directly.

## Extension Spec (the data source you are wrapping)
\`\`\`json
${JSON.stringify(extensionSpec, null, 2)}
\`\`\`

${Object.entries(structures).length > 0 ? `## Data Structures\n${Object.entries(structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n')}` : ''}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{
  "name": "<kebab-case cortex name, e.g. prh-data>",
  "libName": "<camelCase — apps access via AIMEAT.<libName>, e.g. prhData>",
  "description": "<one-line: what data API this provides>",
  "wrapsExtension": "<extension name from spec above>",
  "methods": [
    {
      "name": "<method name — clean, no ext prefix>",
      "description": "<what it does>",
      "params": "<param: type, ...> or empty string if no params",
      "returns": "Promise<<return type — match extension spec output exactly>>",
      "example": "const result = await AIMEAT.<libName>.<name>(<args>);",
      "returnsExample": <copy the EXACT example.output from the extension spec action>,
      "errorBehavior": "Returns null on failure, logs console.warn"
    }
  ],
  "translationAccess": "getTranslations(locale: string) → Promise<object> — reads from owner namespace",
  "settingsAccess": "getSettings() → Promise<object> — reads from owner namespace"
}

## Rules

1. One method per extension action. Names: clean verbs (searchCompanies, getDetails), not prefixed (extSearchCompanies).
2. Return types MUST match extension spec output exactly. If extension returns { totalResults, companies }, this method returns the same shape.
3. Include getTranslations(locale) and getSettings() — these read from OWNER namespace via AIMEAT.data.get(), not from extension namespace.
4. Every method's "returnsExample" MUST be copied from the extension spec's action example.output — do NOT invent new examples.
5. All methods return null on failure. No exceptions thrown. Console.warn on error.
6. Do NOT include any internal functions (callExt, readExtMemory) in the spec — only public methods.
`;
}

/**
 * Build prompt to generate a component spec — a reusable UI piece.
 *
 * @param {object} params
 * @param {object} params.dataApiSpec - The data API spec JSON
 * @param {string} params.componentLabel - Human-readable name, e.g. "Company Card"
 * @param {object|string} [params.viewDefinition] - View/use case context from interview
 * @param {string[]} [params.translationKeys] - Available i18n keys
 * @returns {string} Prompt text
 */
export function buildComponentSpecPrompt({ dataApiSpec, componentLabel, viewDefinition, translationKeys }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Component Spec

You are designing the interface for a REUSABLE UI COMPONENT — a self-contained piece that renders one thing well. It will be composed by an app-domain cortex alongside other components.

## Component: ${componentLabel}
${viewDefinition ? `Context: ${typeof viewDefinition === 'string' ? viewDefinition : JSON.stringify(viewDefinition)}` : ''}

## Available Data API
\`\`\`json
${JSON.stringify(dataApiSpec, null, 2)}
\`\`\`

${translationKeys?.length > 0 ? `## Available Translation Keys (${translationKeys.length} total)\n${translationKeys.slice(0, 30).map(k => `\`${k}\``).join(', ')}${translationKeys.length > 30 ? ` ... and ${translationKeys.length - 30} more` : ''}` : ''}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{
  "name": "<kebab-case, e.g. company-card>",
  "libName": "<camelCase, e.g. companyCard>",
  "purpose": "<one-line: what this component renders>",
  "render": {
    "signature": "AIMEAT.<libName>.render(container, props)",
    "props": {
      "<propName>": "<type — description>"
    },
    "returns": "{ el: HTMLElement, destroy(): void, update(props): void }"
  },
  "dataAccess": ["<which data API methods this component calls, e.g. searchCompanies>"],
  "example": "<multi-line usage showing render() with realistic props>"
}

## Rules

1. Props MUST include callbacks for user interactions (onSelect, onAdd, onRemove) — the component does NOT navigate or manage global state itself.
2. Props include locale and translations — the component does NOT load i18n itself.
3. The component calls data API methods for its own data needs.
4. Keep the props interface minimal — only what the component actually needs.
5. Component names describe WHAT they render: "company-card", "watchlist-badge", "change-timeline" — not where they appear.
`;
}

/**
 * Build prompt to generate an app-domain cortex spec — the top-level composition layer.
 *
 * @param {object} params
 * @param {object[]} params.componentSpecs - Array of component spec JSONs
 * @param {object} params.dataApiSpec - The data API spec JSON
 * @param {object[]} [params.useCases] - Use cases from interview
 * @param {string[]} [params.translationKeys] - Available i18n keys
 * @param {object[]} [params.views] - View definitions from interview
 * @returns {string} Prompt text
 */
export function buildAppDomainSpecPrompt({ componentSpecs, dataApiSpec, useCases, translationKeys, views }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate App-Domain Cortex Spec

You are designing the top-level composition layer. It composes UI components into views, manages navigation, auth, translations, and owns all business logic.

## Available Components
${componentSpecs.map(cs => `### ${cs.name}\n\`\`\`json\n${JSON.stringify(cs, null, 2)}\n\`\`\``).join('\n\n')}

## Available Data API
\`\`\`json
${JSON.stringify(dataApiSpec, null, 2)}
\`\`\`

## Use Cases (from user interview — ALL must be supported)
${useCases?.map((uc, i) => {
    const desc = typeof uc === 'string' ? uc : uc.description || uc.title || JSON.stringify(uc);
    return `${i + 1}. ${desc}`;
  }).join('\n') || 'Not specified — infer from components and data API.'}

## Views
${views?.map(v => `- **${v.title}** (${v.type || 'page'}): ${v.description || ''}${v.interactions?.length ? ` — interactions: ${v.interactions.join(', ')}` : ''}`).join('\n') || 'Infer from use cases.'}

## Translation Keys (${translationKeys?.length || 0} available)
${translationKeys?.slice(0, 20).map(k => `\`${k}\``).join(', ')}${translationKeys?.length > 20 ? ` ... and ${translationKeys.length - 20} more` : ''}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{
  "name": "<kebab-case, e.g. prh-app-domain>",
  "libName": "<camelCase, e.g. prhApp>",
  "description": "<one-line>",
  "methods": {
    "init": "async () → { session, translations, settings } — call after auth on app boot",
    "render": "(container: HTMLElement) → void — renders full app UI into container",
    "t": "(key: string) → string — translate using current locale",
    "switchLocale": "(locale: string) → void — switch language and re-render"
  },
  "views": ["<view-name>", "..."],
  "navigation": "<sidebar | tabs | bottom-nav>",
  "viewComposition": {
    "<view-name>": ["<which components are rendered in this view>"]
  },
  "scriptDependencies": [
    "<ORDERED list of ALL cortex script URLs to load — platform UI first, then data, then components, then this>"
  ],
  "example": "await AIMEAT.<libName>.init();\\nAIMEAT.<libName>.render(document.getElementById('app'));"
}

## Rules

1. scriptDependencies: platform UI cortexes first, then data cortex, then each component, then app-domain cortex. Order matters — each depends on previous.
2. views must cover ALL use cases. Every use case must be reachable via navigation.
3. viewComposition must only reference components from the available component specs.
4. Business logic (validation, computed values, workflows, constraints) lives HERE — not in components.
`;
}

/**
 * Format a spec JSON as a clean prompt section for injection into code generation prompts.
 * @param {object} spec - The spec JSON object
 * @param {string} label - Section heading, e.g. "Extension Spec", "Data API Spec"
 * @returns {string} Formatted prompt section with heading and JSON block
 */
export function formatSpecForPrompt(spec, label) {
  if (!spec) return '';
  return `
## ${label} (formal contract — your code MUST match this exactly)

\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

Your implementation MUST match this spec. Every action/method must return the exact types declared here. Use the exact field names from the examples.
`;
}
