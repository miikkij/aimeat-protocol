/**
 * @file generator-prompts-cortex-data.js
 * @description Prompt template for generating data cortex components.
 *   Data cortex is the data repository layer — wraps extension actions for
 *   external data, uses AIMEAT platform libraries for internal data.
 *   Pure data access, no UI.
 * @usage
 *   import { buildDataCortexPrompt } from '/js/services/generator-prompts-cortex-data.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial data cortex prompt template
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

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
  const memoryKeys = blueprint?.dataModel?.memoryKeys || {};

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
  const inputStr = a.input ? JSON.stringify(a.input) : '{}';
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

- **AIMEAT.data** — get(key), set(key, value), delete(key), list(), search(query), getPublic(namespace, key)
- **AIMEAT.storage** — upload(file), download(key), list(), delete(key)
- **AIMEAT.social** — createBoard(name), post(boardId, content), boards(), posts(boardId)
- **AIMEAT.wallet** — balance(), transactions()
- **AIMEAT.auth** — getSession()

## Output Format

Single IIFE that registers on window.AIMEAT:

\`\`\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'yourLibName'; // camelCase of metadata.name

  // Internal helpers (callExt, readExtMemory — private, not exported)
  // ...

  // Public data access methods
  async function methodName(params) { ... }

  // Register
  const exports = { methodName, ... };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`

Return TWO code blocks: \`\`\`yaml for the cortex manifest and \`\`\`javascript for the library.
`;
}
