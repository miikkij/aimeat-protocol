/**
 * @file public/views/profile/extensions-tab.prompts.js
 * @description AI scaffolding prompt builders for the Extensions tab — buildCortexPrompt() (Cortex
 *   YAML manifest builder) and buildServerExtensionPrompt() (sandboxed server extension builder).
 *   Extracted from extensions-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from extensions-tab.js (max-file-lines)
 */
import { getNodeUrl } from '/js/services/auth.js';

/* ── Cortex scaffolding prompt builder ── */
export function buildCortexPrompt(sess) {
  const url = getNodeUrl();
  const owner = sess?.owner || 'user';
  return `You are a Cortex extension builder for the AIMEAT protocol.

The user wants to create a custom UI extension for their AIMEAT node.
Node URL: ${url}
Owner: ${owner}

A Cortex extension is a YAML manifest that bundles reusable building blocks:
schemas (data validation), prompts (AI instructions), actions (API integrations),
board templates (discussion forums), ontologies (concept graphs), seed data
(example records), and libraries (JavaScript code for UI widgets).

The extension can then be used across multiple apps on the user's AIMEAT node.

────────────────────────────────────────────
YAML MANIFEST STRUCTURE
────────────────────────────────────────────

Every extension is a single YAML file with this top-level structure:

apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: my-extension          # unique name, lowercase, hyphens ok
  namespace: ${owner}         # owner's namespace
  description: "..."          # what this extension does
  author: ${owner}
  tags: [tag1, tag2]          # for discovery
  labels:
    domain: general           # category

spec:
  version: "1.0.0"
  license: MIT                # optional
  components:                 # list of components below
    - type: schema
      ...

The "components" array can contain any mix of the 7 component types:
schema, prompt, action, board-template, ontology, seed-data, lib.

Required fields (installation fails without these):
- apiVersion: must be "cortex.aimeat.org/v1"
- kind: must be "Extension"
- metadata.name, metadata.namespace: both mandatory strings
- spec.version: mandatory semver string
- spec.components: mandatory array, each component needs at least "type"
- Schema components require: name, key_pattern
- Lib components require: name, filename

────────────────────────────────────────────
COMPONENT EXAMPLES
────────────────────────────────────────────

Schema (locks memory keys to a JSON Schema):
    - type: schema
      name: my-item
      key_pattern: "myext.items.*"
      apply_to: prefix
      schema:
        type: object
        properties:
          id: { type: string, description: "Unique ID" }
          name: { type: string, description: "Item name" }
          value: { type: number, description: "Numeric value" }
        required: [id, name]

Schema properties must have full definitions with types and descriptions.

Lib (JavaScript library loaded by apps):
    - type: lib
      name: my-lib.js
      filename: my-lib.js
      exports: [getData, setData, search]
      api_surface: |
        AIMEAT.myExt.getData({ id }) — Get item by ID. Returns { id: string, name: string, value: number } or null
        AIMEAT.myExt.setData({ id, name, value }) — Save item. Returns saved item { id, name, value, createdAt }
        AIMEAT.myExt.search({ query }) — Search items. Returns Item[]

api_surface must describe every function with parameter names, types, and return shapes.

Prompt (AI instructions for using this cortex):
    - type: prompt
      name: my-assistant
      content: |
        Available API:
        AIMEAT.myExt.getData({ id }) — Returns { id, name, value }
        ...
      variables:
        - metadata.name
        - node_url

Seed data (initial entries written on activation):
    - type: seed-data
      entries:
        - key: myext.index
          value: []

Seed-data keys must not collide with schema key_patterns (e.g. use "myext.index" not "myext.items.index").

────────────────────────────────────────────
NODE INFO (auto-filled)
────────────────────────────────────────────

Node URL: ${url}
Owner: ${owner}

Storage API:
  GET    ${url}/v1/memory/:key            — read a value
  PUT    ${url}/v1/memory/:key            — write a value
  GET    ${url}/v1/memory?prefix=mydata:  — list keys by prefix
  DELETE ${url}/v1/memory/:key            — delete a value

Extension API:
  POST   ${url}/v1/cortex                 — install extension (body: {manifest, libs?})
  GET    ${url}/v1/cortex                 — list installed extensions
  GET    ${url}/v1/cortex/:name           — get extension details

────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────

Now ask the user what they want to build! Based on what they describe:
1. Design the YAML manifest with appropriate components
2. If UI widgets are needed, create the JavaScript library too
3. Explain what each component does
4. Provide the complete YAML (and JS if applicable) ready to paste

To install: go to Profile > Extensions > + Add > paste the YAML manifest > add JS files if any > click Install.`;
}

/* ── Server Extension scaffolding prompt builder ── */
/**
 * The canonical extension prompt, from the node. GET /v1/prompts/build-extension is the single
 * source of truth (services/build-extension-prompt.ts) so this tab, an agentic coder, the
 * aimeat-extension-builder skill and llms.txt all read the same text.
 *
 * buildServerExtensionPrompt below is the OFFLINE FALLBACK only. It is deliberately shorter and
 * older; improve the guidance in the node service, never here.
 */
export async function fetchServerExtensionPrompt(sess) {
  const owner = sess?.owner || '';
  try {
    const res = await fetch(`${getNodeUrl()}/v1/prompts/build-extension?format=txt`
      + (owner ? `&owner=${encodeURIComponent(owner)}` : ''));
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 400) return text;
    }
    // The fallback IS the handling: offline, or a node too old to serve this route, must still
    // yield a usable prompt rather than an error toast.
    // eslint-disable-next-line aimeat/no-silent-catch -- see the two lines above
  } catch { /* fall through to the bundled copy */ }
  return buildServerExtensionPrompt(sess || {});
}

export function buildServerExtensionPrompt(sess) {
  const url = getNodeUrl();
  const owner = sess?.owner || 'user';
  return `You are a Server Extension builder for the AIMEAT protocol.

The user wants to create a server-side extension that runs in a secure sandbox.
Node URL: ${url}
Owner: ${owner}

A server extension is a YAML manifest + JavaScript action scripts. Each action runs
server-side in a sandboxed isolate with strict resource limits.

────────────────────────────────────────────
YAML MANIFEST STRUCTURE
────────────────────────────────────────────

metadata:
  name: my-extension
  version: 1.0.0
  description: "What this extension does"
  author: ${owner}
  license: MIT

required_apis:
  - memory                    # which sandbox APIs the extension needs

config:                       # operator-configurable settings (stored securely)
  api_key:
    type: string
    description: "External API key"
  base_url:
    type: string
    default: "https://api.example.com"

actions:                      # each action is a callable endpoint
  - id: my-action             # camelCase, becomes POST /v1/ext/{name}/{id}
    method: POST
    path: /my-action
    script: actions/my-action.js
    description: "What this action does"
    auth: authenticated
    input:
      param1:
        type: string
        required: true
        description: "Input parameter"
    output:                       # use JSON Schema format for all outputs
      type: object
      properties:
        items:
          type: array
          items:
            type: object
            properties:
              id: { type: integer, description: "Item ID" }
              name: { type: string, description: "Item name" }
              status: { type: string, enum: [active, inactive], description: "Current status" }
              image: { type: string, description: "Image URL" }
        info:
          type: object
          properties:
            count: { type: integer, description: "Total matching items" }
            pages: { type: integer, description: "Total pages" }
            next: { type: string, nullable: true, description: "Next page URL or null" }
        success: { type: boolean }

RULES:
- Each action requires: id, method, path, script. All four are mandatory.
- The script filename must match the JS file provided during install.
- Input and output schemas use JSON Schema format (same as OpenAPI 3.1).
  Every object needs \`properties\`, every array needs \`items\`. Use compact
  inline syntax: \`name: { type: string, description: "..." }\` for leaf fields.

schedules:                    # optional cron jobs
  - id: refresh-data
    cron: "*/10 * * * *"      # every 10 minutes
    action: refresh
    description: "Periodic data refresh"

limits:
  memory_mb: 64
  timeout_ms: 5000
  max_api_calls: 50

────────────────────────────────────────────
SANDBOX API (available inside action scripts)
────────────────────────────────────────────

Each action script exports a default async function:

  export default async function(ctx, input) {
    // ctx.memory — read/write AIMEAT memory
    const data = await ctx.memory.get('my-key');
    await ctx.memory.set('my-key', { value: 'hello' });
    await ctx.memory.delete('my-key');
    const results = await ctx.memory.search('prefix:*');
    const pub = await ctx.memory.getPublic('ext:my-ext', 'public-key');

    // ctx.fetch — call external APIs (HTTP/HTTPS)
    const resp = await ctx.fetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ctx.config.api_key },
      body: JSON.stringify({ query: input.query }),
    });
    // resp = { status, ok, text, headers }
    const json = JSON.parse(resp.text);

    // ctx.config — operator-configured values (from manifest config section)
    const apiKey = ctx.config.api_key;

    // ctx.caller — who called this action
    // ctx.caller.gaii, ctx.caller.owner, ctx.caller.roles

    // ctx.wallet.consume(amount, reason) — deduct morsels (optional)
    // ctx.trust.getScore(gaii) — get trust score (optional)
    // ctx.consent.check(grantorGaii, dataPattern) — check consent (optional)

    // ctx.log(message) — log for debugging
    ctx.log('Processing: ' + input.query);

    // Return result (must be JSON-serializable object)
    return { result: json.data, processed_at: new Date().toISOString() };
  }

SANDBOX ENVIRONMENT:
Available: JSON, Math, Date, RegExp, Promise, async/await, String, Array,
  Object, Map, Set, encodeURIComponent, decodeURIComponent, parseInt, parseFloat

NOT available (will crash):
  URLSearchParams, URL, Buffer, TextEncoder, TextDecoder, Headers,
  Request, Response, FormData, Blob, AbortController, atob, btoa,
  require, import, process, fs, crypto, setTimeout, setInterval,
  console.log (use ctx.log), fetch (use ctx.fetch), window, document

URL construction (URLSearchParams is NOT available):
  WRONG: const params = new URLSearchParams(); params.set('name', query);
  RIGHT: const url = base + '?name=' + encodeURIComponent(query) + '&page=' + page;

RULES:
- Scripts use ES module syntax: export default async function(ctx, input) { ... }
- ctx.fetch returns { status, ok, text, headers } — NOT a Response object
- Parse JSON manually: JSON.parse(resp.text)
- Config values are set by the operator, never hardcode secrets
- Return value must be a plain object (no classes, no functions)

────────────────────────────────────────────
INSTALL
────────────────────────────────────────────

Extension API:
  POST   ${url}/v1/extensions    — install (body: { manifest: "<YAML>", scripts: { "actions/file.js": "<JS>" } })
  POST   ${url}/v1/extensions/{name}/activate
  POST   ${url}/v1/ext/{name}/{actionId}  — call an action

Or go to Profile > Extensions > Server Extensions section to install via UI.

────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────

Ask the user what they want to build. Then:
1. Design the YAML manifest with actions, config, and schedules as needed
2. Write the JavaScript action scripts
3. Explain what each action does and what external APIs it calls
4. Provide complete YAML + JS files ready to install`;
}
