/**
 * @file generator-prompts-cortex-data.js
 * @deprecated DEPRECATED — kept as backup/reference. Prompts now served from database seeds.
 * @description Prompt template for generating data cortex components.
 *   Data cortex is the data repository layer — wraps extension actions for
 *   external data, uses AIMEAT platform libraries for internal data.
 *   Pure data access, no UI.
 * @usage
 *   import { buildDataCortexPrompt } from '/js/services/generator-prompts-cortex-data.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial data cortex prompt template
 *   v1.1.0 — 2026-03-26 — Add full cortex YAML manifest format to output section
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

/**
 * Build prompt for generating a data cortex component.
 * @param {string} label - Component label
 * @param {string} projectDescription - Project description
 * @param {object} blueprint - Full blueprint with structures/actions
 * @param {Array} completedBundles - Context bundles from completed components
 * @returns {string} Complete prompt
 */
export function buildDataCortexPrompt(label, projectDescription, blueprint, completedBundles) {
  const structures = blueprint?.dataModel?.structures || {};
  const actions = blueprint?.dataModel?.actions || {};

  // Find extension bundle
  const extBundle = completedBundles.find(b => b.type === 'extension');

  // Find cortex actions (methods this data cortex must export)
  const cortexActions = Object.entries(actions)
    .filter(([key]) => key.startsWith('cortex:'))
    .map(([key, def]) => ({ method: key.replace('cortex:', ''), ...def }));

  // Build structures section
  const structuresText = Object.entries(structures).map(([name, schema]) =>
    `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
  ).join('\n\n');

  return `${INSTRUCTION_DISCLAIMER}
Create a Data Cortex library for: ${label}

Project: ${projectDescription}

## Goal

Build a client-side JavaScript library (IIFE) that provides data access methods.
This is the DATA LAYER — pure data access, no UI rendering.
Other cortex components will use this library to get and modify data.

## Structures (shared data types — use these exact shapes)

${structuresText}

## Methods to Export

${cortexActions.map(a => {
  const outputRef = a.output?.$ref || JSON.stringify(a.output || 'any');
  return `- **${a.method}**(${Object.keys(a.input || {}).join(', ')}) → returns ${outputRef}`;
}).join('\n')}

${extBundle ? `
## Extension (this cortex wraps it)

Extension name: ${extBundle.registeredAs}
Actions: ${extBundle.actions?.join(', ') || 'none'}

### Actual responses from live probes:
${(extBundle.probeResults || []).map(p =>
  `${p.action}(${JSON.stringify(p.input)}) → ${JSON.stringify(p.response).substring(0, 500)}`
).join('\n')}

Use callExt('${extBundle.registeredAs}', actionId, body) for extension calls.
session.fetch returns ALREADY-PARSED JSON — use resp.data, never resp.json().
` : `
## No Extension

This data cortex uses AIMEAT platform libraries directly (no extension needed).
`}

## AIMEAT Platform Libraries Available

- **AIMEAT.data** — get(key), set(key, value), delete(key), list(opts), search(query), getPublic(gaii, key), getEntry(key), update(key, value, version)
- **AIMEAT.storage** — upload(file), download(key), list(), delete(key)
- **AIMEAT.social** — createBoard(name), post(boardId, content), boards(), posts(boardId)
- **AIMEAT.wallet** — balance(), transactions()
- **AIMEAT.auth** — login(), getSession(), mountLoginButton(container)

## Data Access Rules (CRITICAL — follow precisely)

Two namespaces, two different methods:

1. **Extension runtime data** (watchlist items, cached API results, change logs — data the EXTENSION wrote via ctx.memory.set):
   → Read with: \`AIMEAT.data.getPublic('ext:EXTENSION_NAME', key)\`
   → This reads from the extension's own namespace. Public, no auth needed.

2. **Owner/user data** (translations, settings, seed data — data stored by memory/translation components):
   → Read with: \`AIMEAT.data.get(key)\`
   → This reads from the CURRENT USER's own namespace. Requires auth session.

NEVER read translations or settings from ext: namespace. They live in the owner namespace.
NEVER read extension runtime data with data.get() — that reads the wrong namespace.

## Output Format

Return TWO separate, properly tagged code blocks.
The installer expects them separately — YAML defines the manifest, JS is the library file.

CRITICAL: Use \`\`\`yaml for the manifest and \`\`\`javascript for the library code.
Do NOT combine them into a single block. Do NOT use an untagged block.

First block — YAML manifest:
\`\`\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-name
  namespace: community
  description: "What this data cortex does"
  author: generator
  tags: [data, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: prompt
      name: domain-assistant
      content: |
        You are using the {{metadata.name}} cortex library.
        Node URL: {{node_url}}

        Available API:
        AIMEAT.yourLib.methodName(params) — Description
        ...

        To load in an app:
        <script src="{{node_url}}/v1/cortex/kebab-case-name/libs/kebab-case-name.js"></script>

    - type: lib
      name: kebab-case-name
      filename: kebab-case-name.js
      exports: [methodName, ...]
      api_surface: |
        AIMEAT.yourLib.methodName(params) — Description and return type
        ...
\`\`\`

Second block — JavaScript library:
\`\`\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'yourLibName'; // camelCase of metadata.name
  const EXT_NAME = 'extension-name'; // kebab-case extension name from the extension section above

  // ── EXACT callExt implementation — DO NOT MODIFY THIS PATTERN ──
  // URL pattern is ALWAYS: /v1/ext/{extensionName}/{actionId}
  // session.fetch returns ALREADY-PARSED JSON — use resp.data directly, NEVER resp.json()
  async function callExt(actionId, body) {
    var resp = await AIMEAT.session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return resp.data;
  }

  // ── EXACT readExtMemory implementation — DO NOT MODIFY THIS PATTERN ──
  async function readExtMemory(key) {
    return await AIMEAT.data.getPublic('ext:' + EXT_NAME, key);
  }

  // ── Public data access methods ──
  // CRITICAL: Every method takes a SINGLE OBJECT parameter and destructures it.
  // This matches the spec contract. The test will call: lib.methodName({ key: value })
  // Example:
  //   async function doSomething(params) {
  //     var id = params.id;
  //     var filter = params.filter || 'all';
  //     return await callExt('doSomething', { id: id, filter: filter });
  //   }
  // NEVER use positional parameters like methodName(a, b) — always methodName(params).
  // Method names in exports MUST match the blueprint "produces: api:XXX" names EXACTLY.

  async function methodName(params) { ... }

  // Register
  const exports = { methodName, ... };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`
`;
}
