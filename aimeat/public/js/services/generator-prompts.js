/**
 * Generator Prompts — templates for blueprint analysis and component generation
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

Analyze this request and produce a JSON blueprint with ALL components needed.

Return ONLY valid JSON in this exact format:
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
- Group components into logical phases
- Include ALL components needed for a complete, working service
- Only include what's actually needed — don't pad with unnecessary components`;
}

/* ── Component Prompts ───────────────────────────────── */

const COMPONENT_TEMPLATES = {
  csm: (label, context) => `${AIMEAT_CONTEXT}

Create a CSM (Community Service Manifest) YAML for: ${label}

${context}

Return ONLY valid YAML in CSM format:
\`\`\`yaml
name: kebab-case-name
version: "1.0"
description: What this schema defines
fields:
  - name: fieldName
    type: string|number|boolean|array|object
    required: true|false
    description: What this field contains
consent:
  default_visibility: public|private|restricted
  requires_consent: true|false
  retention_days: 365
\`\`\``,

  msm: (label, context) => `${AIMEAT_CONTEXT}

Create an MSM (Micro Service Manifest) YAML for: ${label}

${context}

Return ONLY valid YAML in MSM format:
\`\`\`yaml
name: kebab-case-name
version: "1.0"
description: What this integration does
auth:
  type: api_key|oauth2|basic|none
  config: {}
endpoints:
  - id: endpoint-id
    method: GET|POST|PUT|DELETE
    url: https://api.example.com/path
    description: What this endpoint does
    input_schema:
      type: object
      properties: {}
    output_schema:
      type: object
      properties: {}
\`\`\``,

  extension: (label, context) => `${AIMEAT_CONTEXT}

Create an AIMEAT Extension for: ${label}

${context}

Return TWO code blocks:

1. extension.yaml manifest:
\`\`\`yaml
extension: "1.0"
metadata:
  name: kebab-case-name
  version: "1.0.0"
  description: What this extension does
  author: generator
required_apis: [memory]
config: {}
limits:
  memory_mb: 128
  timeout_ms: 5000
  max_api_calls: 100
actions:
  - id: action-id
    description: What this action does
    method: POST
    path: /v1/ext/{name}/:instanceId/action-id
    auth: required
    input: {}
    output: {}
    script: actions/action-id.js
\`\`\`

2. For EACH action, a JavaScript file:
\`\`\`javascript
// actions/action-id.js
export default async function(ctx, input) {
  // Use ctx.memory, ctx.wallet, ctx.caller, ctx.log
  return { result: 'data' };
}
\`\`\``,

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

/* ── Fix Prompt ──────────────────────────────────────── */

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
