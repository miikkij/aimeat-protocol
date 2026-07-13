/**
 * @file public/js/services/generator-prompts-templates.js
 * @description COMPONENT_TEMPLATES map (csm, msm, extension, app, memory, translation, cortex) for the generator. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

import { AIMEAT_CONTEXT } from './generator-prompts-context.js';
import { extensionTemplate } from './generator-prompts-template-extension.js';
import { appTemplate } from './generator-prompts-template-app.js';
import { cortexTemplate } from './generator-prompts-template-cortex.js';

export const COMPONENT_TEMPLATES = {
  csm: (label, context) => `${AIMEAT_CONTEXT}

Create a CSM (Community Service Manifest) YAML for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG — will crash the parser:
  description: > This is a multi-line folded string
  description: This has (parens) and special: chars
  description: |
    This is a literal block

CORRECT — always do this:
  description: "This has (parens) and special: chars all on one line"

## Structure

Return ONLY valid YAML in a yaml code block. Copy this structure EXACTLY:
\`\`\`yaml
csm: "1.0"
service:
  name: kebab-case-name
  type: directory
  description: "What this service does — keep on ONE line in double quotes"
  version: "1.0"
schema_mode: open
data_schema:
  required:
    fieldName:
      type: string
    anotherField:
      type: number
  optional:
    optionalField:
      type: string
      enum: [value1, value2]
consent_requirements:
  visibility_default: public
  requires_consent: false
  consent_purpose: "Why consent is needed"
  data_retention: "365_days"
moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [fieldName, anotherField]
  detail_view: [fieldName, anotherField, optionalField]
  search_fields: [fieldName]
\`\`\`

## Additional rules
- data_schema.required and data_schema.optional are MAPS (fieldName: {type: ...}), NOT arrays (- name: ...)
- data_schema.required MUST have at least one field
- Field types: string, number, integer, boolean, array, object
- All date/time fields MUST be type: string with description mentioning ISO 8601 format
- service.name: concise kebab-case identifier, 1-3 words. Use the project's own name when it has one. Do NOT invent generic abbreviations or add redundant suffixes like "-service" or "-monitor".
- ONLY include fields that exist in the raw source data. Computed/derived values (aggregates, scores, trends, risk levels, statistics) are calculated by extensions and stored in separate memory keys — they do NOT belong in the CSM data_schema.
- Avoid redundant fields. If the source provides a unique identifier (e.g. guid), do not add a second id field. If a value is always the same (e.g. single data source), do not include it as a field.`,

  msm: (label, context) => `${AIMEAT_CONTEXT}

Create an MSM (Micro Service Manifest) YAML for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG: description: > This is a folded string
WRONG: description: This has (parens) and colons: here
CORRECT: description: "This has (parens) and colons: here — all on one line"

## Structure

Return ONLY valid YAML in a yaml code block. Copy this structure EXACTLY:
\`\`\`yaml
msm: "1.0"
service:
  name: "Human Readable Service Name"
  description: "What this integration does — one line, double quoted"
  homepage: "https://api.example.com"
  category: data
  tags: [tag1, tag2]
auth:
  type: none
  param_name: ""
  env_var: ""
actions:
  - id: actionId
    display_name: "Human Readable Action Name"
    description: "What this action does"
    endpoint:
      method: GET
      url: "https://api.example.com/path?q={input.query}"
    input:
      query:
        type: string
        required: true
        description: "Search query"
    output:
      result:
        type: string
        description: "The result"
\`\`\`

## Additional rules
- \`service\` section with \`name\`, \`description\`, \`category\` is REQUIRED
- \`category\` must be one of: data, utility, image, communication, analytics, analysis
- \`auth.type\` must be one of: bearer, query_param, oauth2, api_key, none
- For public APIs (RSS feeds, open data) use \`auth.type: none\` — many APIs don't require authentication
- \`actions\` is an array — each action needs: id, display_name, description, endpoint (method + url), input, output
- Each action output MUST have at least one field`,

  extension: extensionTemplate,

  app: appTemplate,

  memory: (label, context) => `${AIMEAT_CONTEXT}

Define memory structure for: ${label}

${context}

## Memory Key Conventions

AIMEAT memory uses dot-namespaced keys with a standard metadata pattern:

- \`namespace.__meta\` — describes the namespace (version, key format, description)
- \`namespace.__index\` — lightweight index for fast lookups (list of dates, counts, rankings)
- \`namespace.__config\` — configuration for the namespace (TTLs, thresholds, weights)
- \`namespace.YYYY-MM-DD\` — date-bucketed data (one key per day)
- \`namespace.item-id\` — individual items

Values are JSON objects — a single value can hold arrays, nested objects, and large datasets (up to several MB). There is NO reason to split a dataset across multiple keys when it logically belongs together.

## Rules
- All keys MUST be lowercase with dots as namespace separators
- Date-bucketed keys MUST use YYYY-MM-DD format: "items.by-date.2026-03-14"
- All date/time values inside objects MUST be ISO 8601: "2026-03-14T13:00:00.000Z"
- Include __meta with version and description for every namespace
- Include __index if consumers need to discover which keys exist (e.g., list of dates with data)
- Keep __index lightweight — just key names, counts, and pointers. NOT full data copies.
- Use arrays for ordered collections within a bucket (e.g., entries per day)
- Use meaningful field names that match the CSM data_schema where applicable
- PREFER fewer, larger keys over many small keys. A lookup table, reference dataset, or configuration object should be ONE key containing the full data structure (object or array), NOT split into one key per entry. For example, a list of 300 items should be ONE key "catalog.data" containing the full array — NOT 300 separate keys.

Return a JSON object where keys are memory key names and values are the initial/template data:
\`\`\`json
{
  "namespace.__meta": {
    "version": "1.0",
    "description": "What this namespace stores",
    "keyFormat": "namespace.YYYY-MM-DD"
  },
  "namespace.__index": {
    "dates": [],
    "totalItems": 0,
    "lastUpdated": ""
  },
  "namespace.YYYY-MM-DD": {
    "date": "YYYY-MM-DD",
    "items": []
  }
}
\`\`\``,

  translation: (label, context) => `${AIMEAT_CONTEXT}

Create translations for: ${label}

${context}

## Translation Key Conventions

- Keys use dot-namespaced paths matching the UI structure: "app.list.title", "app.filters.status"
- Group by UI section: "app.nav.*", "app.map.*", "app.filters.*", "app.stats.*"
- Include domain-specific terms: categories, statuses, types relevant to the project
- Use interpolation with \${variable} syntax for dynamic values: "Found \${count} items"

## CRITICAL: Generate ONLY the locale indicated by the label

Each translation component covers ONE locale. The label tells you which one:
- "Finnish (fi) Strings" → generate ONLY Finnish translations under the "fi" root key
- "English (en) Strings" → generate ONLY English translations under the "en" root key

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER generate both locales in one component.                         ║
║  If the label says "Finnish", output ONLY { "fi": { ... } }.           ║
║  If the label says "English", output ONLY { "en": { ... } }.           ║
║  The other locale is handled by a SEPARATE component in the blueprint. ║
╚══════════════════════════════════════════════════════════════════════════╝

## Rules
- The root key MUST match the locale in the label: "en" for English, "fi" for Finnish
- NEVER include the other locale — it will be generated in its own component
- Finnish translations must be natural Finnish with correct characters (ä, ö, å) — not machine-translated
- Include ALL text that appears in the UI — labels, buttons, tooltips, empty states, error messages
- Keep keys consistent with what the App component will reference
- Use plural-aware keys where needed: "item.one" / "item.many"
- Both locale components MUST use the SAME key structure — the app uses the same keys for both

Return JSON with translations for the SINGLE locale from the label:

Example — if label is "Finnish (fi) Strings":
\`\`\`json
{
  "fi": {
    "app.title": "Sovelluksen nimi",
    "app.nav.home": "Etusivu",
    "app.filters.status": "Tila",
    "app.filters.all": "Kaikki",
    "app.empty": "Tietoja ei löytynyt",
    "app.error": "Jokin meni pieleen",
    "domain.type.example_category": "Esimerkkikategoria",
    "domain.status.active": "Aktiivinen"
  }
}
\`\`\`

Example — if label is "English (en) Strings":
\`\`\`json
{
  "en": {
    "app.title": "App Title",
    "app.nav.home": "Home",
    "app.filters.status": "Status",
    "app.filters.all": "All",
    "app.empty": "No data found",
    "app.error": "Something went wrong",
    "domain.type.example_category": "Example Category",
    "domain.status.active": "Active"
  }
}
\`\`\``,

  cortex: cortexTemplate,
};
