/**
 * @file generator-prompts.js
 * @description Prompt templates for the service generator — blueprint analysis,
 *   per-component-type generation prompts, and fix/retry prompts.
 *   Used by generator-tab.js to produce copy-to-clipboard prompts for AI chat.
 * @structure
 *   - AIMEAT_CONTEXT: shared preamble describing building blocks
 *   - buildBlueprintPrompt(description): lightweight JSON blueprint prompt
 *   - buildComponentPrompt(type, label, ...): per-type generation prompt
 *   - buildBlueprintFixPrompt(description, errors): retry prompt for blueprint failures
 *   - buildFixPrompt(original, failed, errors): generic retry prompt for components
 * @usage import { buildBlueprintPrompt, buildComponentPrompt } from '/js/services/generator-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial prompt templates
 *   v1.1.0 — 2026-03-14 — Tighten blueprint prompt to reject extra fields;
 *     add buildBlueprintFixPrompt that regenerates instead of patching
 *   v2.0.0 — 2026-03-14 — Fix MSM prompt to match real parseMsm() format
 *     (service/auth/actions structure, not name/endpoints); fix Extension prompt
 *     to match POST /v1/extensions format (metadata/actions with script refs)
 */

/* ── AIMEAT Capabilities Context ─────────────────────── */

const AIMEAT_CONTEXT = `
You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.

Extensions run in isolated V8 with this API:
  ctx.memory.get(key), ctx.memory.set(key, value), ctx.memory.search(prefix), ctx.memory.delete(key)
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config, ctx.instance = { id, config }
  ctx.log.info/warn/error(msg, data)
`.trim();

/* ── Blueprint Prompt ────────────────────────────────── */

export function buildBlueprintPrompt(description) {
  return `${AIMEAT_CONTEXT}

The user wants to create this service:
---
${description}
---

Analyze this request and produce a JSON blueprint listing ALL components needed.

CRITICAL: Return ONLY a JSON object with "components" and "phases" arrays. Nothing else.
Each component has EXACTLY three fields: "id", "type", "label". No other fields.
Do NOT include manifest content, code, HTML, translations, or any implementation details.
The blueprint is a lightweight plan — actual content is generated later per component.

Format:
{
  "components": [
    { "id": "csm-1", "type": "csm", "label": "Human-readable name" },
    { "id": "ext-1", "type": "extension", "label": "Human-readable name" },
    { "id": "app-1", "type": "app", "label": "Human-readable name" }
  ],
  "phases": [
    { "id": "define", "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "logic", "label": "Build Logic", "componentIds": ["ext-1"] },
    { "id": "ui", "label": "Build UI", "componentIds": ["app-1"] }
  ]
}

Rules:
- Component types: csm, msm, extension, app, memory, translation
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, app-1)
- Each component object has ONLY "id", "type", "label" — no "manifest", "code", "files", or other keys
- Group components into logical phases
- Include ALL components needed for a complete, working service
- Only include what's actually needed — don't pad with unnecessary components`;
}

/* ── Component Prompts ───────────────────────────────── */

const COMPONENT_TEMPLATES = {
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
- Keep fields reasonable — only what the service actually needs`,

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
  type: api_key
  param_name: apikey
  env_var: MY_API_KEY
actions:
  - id: action-id
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
- \`actions\` is an array — each action needs: id, display_name, description, endpoint (method + url), input, output
- Each action output MUST have at least one field`,

  extension: (label, context) => `${AIMEAT_CONTEXT}

Create an AIMEAT Extension for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG: description: > This is a folded string
WRONG: description: This has (parens) and colons: here
CORRECT: description: "This has (parens) and colons: here — all on one line"

## Output format — SINGLE block, copy-paste friendly

Return EVERYTHING in ONE code block. The YAML manifest first, then all JavaScript files separated by // actions/filename.js comments. The user will copy-paste the entire response at once.

\`\`\`
metadata:
  name: kebab-case-name
  version: "1.0.0"
  description: "What this extension does — one line, double quoted"
  author: generator
required_apis: [memory]
config: {}
limits:
  memory_mb: 128
  timeout_ms: 5000
  max_api_calls: 100
actions:
  - id: action-id
    description: "What this action does"
    method: POST
    path: /v1/ext/{name}/:instanceId/action-id
    auth: required
    input: {}
    output: {}
    script: action-id.js
// actions/action-id.js
export default async function(ctx, input) {
  // Use ctx.memory, ctx.wallet, ctx.caller, ctx.log
  return { result: 'data' };
}
\`\`\`

CRITICAL: Do NOT use separate code blocks. Put YAML manifest and ALL JavaScript files in ONE block.
Each JavaScript file MUST start with a comment line: // actions/{filename}.js

## Additional rules
- \`metadata\` section MUST have: name, version, description, author
- \`actions\` array MUST NOT be empty — each action needs: id, method, path, script
- Each action's \`script\` field value must match a \`// actions/{script}\` comment below the YAML`,

  app: (label, context) => `${AIMEAT_CONTEXT}

Create an AIMEAT App (HTML/JS) for: ${label}

${context}

Return a complete HTML file that:
- Uses vanilla JS (no build step needed)
- Calls AIMEAT APIs via fetch() with Bearer token auth
- Has a clean, responsive UI
- Include an app manifest comment at the top:

\`\`\`html
<!-- AIMEAT App Manifest
name: kebab-case-name
version: 1.0.0
description: What this app does
entry: index.html
-->
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>App Name</title></head>
<body>
  <!-- App UI here -->
  <script>
    // AIMEAT API calls here
  </script>
</body>
</html>
\`\`\``,

  memory: (label, context) => `${AIMEAT_CONTEXT}

Define memory structure for: ${label}

${context}

Return a JSON object where keys are memory key names and values are the initial data:
\`\`\`json
{
  "namespace.key1": { "field": "value" },
  "namespace.key2": { "field": "value" }
}
\`\`\``,

  translation: (label, context) => `${AIMEAT_CONTEXT}

Create translations for: ${label}

${context}

Return JSON with translations for each locale:
\`\`\`json
{
  "en": { "key.path": "English text" },
  "fi": { "key.path": "Finnish text" }
}
\`\`\``,
};

export function buildComponentPrompt(type, label, projectDescription, blueprint, completedComponents) {
  const template = COMPONENT_TEMPLATES[type];
  if (!template) throw new Error(`No template for type: ${type}`);

  let context = `Project: ${projectDescription}\n`;
  if (blueprint) {
    context += `\nBlueprint components: ${blueprint.components.map(c => `${c.id} (${c.type}: ${c.label})`).join(', ')}\n`;
  }
  if (completedComponents && completedComponents.length > 0) {
    context += '\nAlready completed:\n';
    for (const c of completedComponents) {
      context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
      if (c.result) {
        const preview = c.result.length > 500 ? c.result.slice(0, 500) + '...' : c.result;
        context += `  Result preview:\n${preview}\n`;
      }
    }
  }

  return template(label, context);
}

/* ── Fix Prompts ─────────────────────────────────────── */

export function buildBlueprintFixPrompt(description, errors) {
  return `Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have EXACTLY three fields: "id", "type", "label"
- The entire response must be valid JSON — no trailing commas, no unescaped quotes

${buildBlueprintPrompt(description)}`;
}

export function buildFixPrompt(originalPrompt, failedResult, errors) {
  return `The following result had validation errors. Fix ONLY the errors listed below.

ORIGINAL PROMPT:
${originalPrompt}

FAILED RESULT:
${failedResult}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Return the corrected result in the same format as the original.`;
}
