/**
 * @file generator-prompts.js
 * @description Prompt templates for the service generator — blueprint analysis,
 *   per-component-type generation prompts, and fix/retry prompts.
 *   Used by generator-tab.js to produce copy-to-clipboard prompts for AI chat.
 * @structure
 *   - AIMEAT_CONTEXT: shared preamble describing building blocks
 *   - buildBlueprintPrompt(description): lightweight JSON blueprint prompt
 *   - buildComponentPrompt(type, label, ...): per-type generation prompt
 *   - buildInterviewPrompt(description): structured requirements interview prompt
 *   - buildBlueprintFixPrompt(description, errors): retry prompt for blueprint failures
 *   - buildFixPrompt(original, failed, errors): generic retry prompt for components
 *   - cortex template: IIFE domain library generation prompt
 * @usage import { buildBlueprintPrompt, buildComponentPrompt } from '/js/services/generator-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial prompt templates
 *   v1.1.0 — 2026-03-14 — Tighten blueprint prompt to reject extra fields;
 *     add buildBlueprintFixPrompt that regenerates instead of patching
 *   v2.0.0 — 2026-03-14 — Fix MSM prompt to match real parseMsm() format
 *     (service/auth/actions structure, not name/endpoints); fix Extension prompt
 *     to match POST /v1/extensions format (metadata/actions with script refs)
 *   v2.1.0 — 2026-03-14 — Rewrite App prompt to use aimeat-auth.js library
 *     for automatic authentication instead of manual token/URL configuration
 *   v3.0.0 — 2026-03-14 — Major overhaul: add data standards to AIMEAT_CONTEXT,
 *     improve all prompts with sandbox limitations, real API limits, memory patterns,
 *     translation key conventions, app CDN/CSP guidance, ctx.fetch documentation
 *   v3.1.0 — 2026-03-14 — Fix app prompt: extension data lives in ext:{name}
 *     namespace, apps must use AIMEAT.data.getPublic() to read it, not .get()
 *   v4.0.0 — 2026-03-14 — Add buildInterviewPrompt for requirements interview,
 *     add cortex component type, pass interviewSpec through blueprint prompts
 *   v4.1.0 — 2026-03-14 — Make app template cortex-aware: detect completed cortex
 *     components, inject cortex script loads in boot(), show cortex API docs instead
 *     of raw extension/memory docs when cortex is available
 *   v4.2.0 — 2026-03-15 — Scope interview prompt to AIMEAT domain: remove
 *     framework/deployment/infra questions, add style/look-and-feel section,
 *     add style object to JSON spec output
 *   v4.3.0 — 2026-03-15 — Major interview prompt rewrite: add 20-question budget,
 *     explicit "YOU DECIDE" list for implementation details, batch questions per section,
 *     prioritize use cases (up to 8 questions), reduce other sections to 2-3 each,
 *     shorter summaries between sections
 */

/* ── AIMEAT Capabilities Context ─────────────────────── */

const AIMEAT_CONTEXT = `
You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust, fetch APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.

Extensions run in an ISOLATED V8 sandbox with ONLY this API (no Node.js, no global fetch, no setTimeout, no require, no import):
  ctx.memory.get(key) → value or null
  ctx.memory.set(key, value) → void
  ctx.memory.search(prefix) → Array<{ key, value }> (NOT plain strings!)
  ctx.memory.delete(key) → boolean
  ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }
    Use ctx.fetch for ALL HTTP requests. Global fetch() is NOT available.
    Response body is always .text (string) — parse JSON with JSON.parse(resp.text).
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config object (from manifest config section)
  ctx.instance = { id, config } (when called via instance endpoint)
  ctx.log.info/warn/error(msg, data)

AIMEAT Data Standards (MUST follow in ALL components):
  Dates/times: ISO 8601 ONLY — "2026-03-14T13:00:00.000Z". NEVER store RFC 2822 ("Sat, 14 Mar ..."), Unix timestamps, or locale-formatted dates. Convert all dates to ISO before storing.
  Memory keys: lowercase dot-namespaced — "alerts.by-date.2026-03-14". Dates in keys MUST use YYYY-MM-DD.
  IDs: URL-safe strings (kebab-case or hex hashes). No spaces, no special characters.
  Locale codes: BCP 47 — "fi", "en", "fi-FI", "en-US".
  Coordinates: { latitude: number, longitude: number } — WGS84 decimal degrees.
  Currency/amounts: integers (no floats) — morsels are whole numbers.
`.trim();

/* ── Blueprint Prompt ────────────────────────────────── */

export function buildBlueprintPrompt(description, interviewSpec = null) {
  const specContext = interviewSpec ? `
## Refined Specification (from requirements interview)
\`\`\`json
${JSON.stringify(interviewSpec, null, 2)}
\`\`\`

Use the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.
` : '';

  return `${AIMEAT_CONTEXT}

The user wants to create this service:
---
${description}
---
${specContext}
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
    { "id": "cortex-1", "type": "cortex", "label": "Human-readable name" },
    { "id": "app-1", "type": "app", "label": "Human-readable name" }
  ],
  "phases": [
    { "id": "define", "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "logic", "label": "Build Logic", "componentIds": ["ext-1"] },
    { "id": "connect", "label": "Connect & Integrate", "componentIds": ["cortex-1"] },
    { "id": "ui", "label": "Build UI", "componentIds": ["app-1"] }
  ]
}

Rules:
- Component types: csm, msm, extension, app, memory, translation, cortex
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, app-1)
- Each component object has ONLY "id", "type", "label" — no "manifest", "code", "files", or other keys
- Group components into logical phases
- Include ALL components needed for a complete, working service
- Cortex components go in a "Connect & Integrate" phase AFTER translations, BEFORE app
- Cortex libraries are client-side JS that wrap extension APIs into clean domain methods for the app
- Default to ONE cortex per project unless complexity clearly warrants splitting
- Only include what's actually needed — don't pad with unnecessary components

## CRITICAL: When to use extension vs cortex vs app

Extensions run in a V8 SANDBOX on the server. Use an extension ONLY when:
- Scheduled/recurring server-side work (fetch RSS every 15 min, nightly aggregation)
- Server-to-server API calls that the browser cannot make (CORS, auth, rate limits)
- Heavy computation that must run even when no browser is open
- Writing seed/reference data to memory that other components depend on

Do NOT create an extension for:
- Querying/filtering data that already exists in memory — cortex reads memory directly
- Distance/proximity calculations — cortex or app does math client-side
- Export (CSV/JSON generation) — app generates files in the browser
- User preferences / settings — app reads/writes memory directly via AIMEAT.data
- Data transformations for display — cortex methods transform data for the app
- CRUD on the user's own data — app uses AIMEAT.data.get/set/delete

Cortex wraps memory reads + extension action calls into clean domain methods.
App handles all UI, user interaction, client-side computation, and display logic.

Rule of thumb: if a browser can do it, don't make it an extension.`;
}

/* ── Interview Prompt ──────────────────────────────────── */

/**
 * Build an interview prompt that the user copies to AI Chat.
 * AI Chat interviews the user and produces a structured JSON spec.
 */
export function buildInterviewPrompt(description) {
  return `You are a requirements analyst for the AIMEAT service generator.
The user wants to build a service. Your job is to interview them to produce a clear, structured specification.

## User's Initial Description
---
${description}
---

## CRITICAL — Interview Discipline

QUESTION BUDGET: You have a maximum of 20 questions total across all sections.
Use cases get the most (up to 8), other sections 2-3 each. Batch related questions together.
Do NOT split every detail into a separate numbered question.

YOU DECIDE (never ask the user about these — the generator handles them):
- Implementation details: file formats, data serialization, error handling, API design, caching
- Technical methods: how to fetch data, how to parse it, how to store it, how to compute derived values
- UI component details: which chart library, marker clustering, column ordering, widget placement
- Infrastructure: scheduler times, retention periods, timeout values, rate limits, job scheduling
- Data schema internals: field names, ID generation, deduplication strategy, index design
- Code-level choices: typography/font specifics, animation libraries, export format implementation

The user describes WHAT they want and WHY. The generator decides HOW.

## Interview Rules

1. ADAPT TO THE USER'S LEVEL:
   - Start by asking: "Are you a technical person who'd prefer detailed technical questions, or would you like me to keep things simple and explain as we go?"
   - If non-technical: ask simple questions with examples
   - If technical: ask direct questions to speed things up

2. COVER THESE AREAS (in order):
   a) USE CASES — What will people actually do with this? (up to 8 questions)
      This is the MOST IMPORTANT section. Spend time here.
      - Propose 3-5 concrete use cases based on the description as selectable options (A, B, C, D)
      - For each use case, include a one-sentence description of what it means in practice
      - Let the user add their own use cases
      - For must-have use cases, ask 1-2 clarifying questions about scope and defaults
      - IMPORTANT: Do NOT move to the next section until the user confirms all use cases
      - Ask: "Any other use cases, or shall we move on?"

   b) AUDIENCE & SCOPE — Who is this for? (2-3 questions)
      Ask in ONE batch:
      - Personal or multi-user?
      - Scale: just me / <10 / <100 / 100+?
      - Any special display context? (kiosk, mobile, embedded)

   c) DATA SOURCES — Where does the data come from? (2-3 questions)
      - What external feeds/APIs/URLs does it use?
      - If the user mentions a URL: try to fetch it and describe what you see
        - If you CANNOT access it, say so honestly — NEVER pretend you accessed something
      - Is any data user-generated or computed from other data?

   d) DATA MODEL — What are the key entities? (1-2 questions)
      - Propose entities based on use cases (just name + one-line description each)
      - Ask: "Does this cover your data, or is anything missing?"
      - Do NOT ask about individual fields, ID formats, or storage details — the generator decides those

   e) VIEWS & INTERACTIONS — What should it look like? (2-3 questions)
      - Propose views based on use cases (map, list, dashboard, cards, timeline, etc.)
      - Ask which views are essential vs optional
      - Ask about key interactions (filter, search, create, export)
      - Do NOT ask about individual UI controls, column orders, or widget placement

   f) STYLE & LOOK — How should it feel? (2-3 questions)
      Ask in ONE batch:
      - Mood: clean/minimal, playful, data-dense/professional?
      - Color feel: suggest a palette based on the domain (e.g., "neutral + severity colors" for alerts)
      - Layout preference: tabs, single page, split panels?
      - Any apps or websites whose look they admire?

   g) CONSTRAINTS & PREFERENCES (1-2 questions)
      Ask in ONE batch:
      - How often should data refresh?
      - What languages does the UI need?
      - Any domain-specific rules the generator should know?

3. STAY IN SCOPE — This is an AIMEAT service:
   - The AIMEAT platform handles: storage, scheduling, auth, serving, i18n
   - Do NOT ask about frameworks, runtimes, databases, Docker, deployment, hosting, CI/CD
   - Do NOT ask about file formats, build tools, API design, error handling, data serialization
   - Do NOT ask about retention periods, scheduler times, geolocation methods, caching
   - Focus ONLY on WHAT the service does — the generator handles architecture and implementation

4. SECTION RULES:
   - Each section stays open until the user confirms
   - After each section, give a brief summary (2-3 bullet points) and ask for confirmation
   - Do NOT repeat the full accumulated summary after every section — just the current one
   - If the user brings up something from a previous section, go back to it

5. HONESTY RULES:
   - If you don't know something, say so
   - If you can't access a URL, say so explicitly
   - Don't make assumptions about external APIs — ask the user
   - If a use case seems infeasible, explain why and suggest alternatives

6. WHEN THE INTERVIEW IS COMPLETE:
   - Give a BRIEF final summary (one paragraph, not a section-by-section repetition)
   - Ask the user to confirm
   - Then output the structured specification in this EXACT JSON format:

\\\`\\\`\\\`json
{
  "version": "1.0",
  "projectName": "Human-readable project name",
  "description": "Enhanced description incorporating all interview findings",
  "technicalLevel": "beginner|intermediate|advanced",
  "useCases": [
    {
      "id": "uc-1",
      "title": "Use case title",
      "description": "What the user does and why",
      "priority": "must-have|nice-to-have"
    }
  ],
  "audience": {
    "type": "personal|multi-user",
    "scale": "single|small|medium|large",
    "description": "Who uses this and how"
  },
  "dataSources": [
    {
      "id": "ds-1",
      "name": "Source name",
      "type": "rss|api|websocket|user-input|computed",
      "url": "https://... or null",
      "format": "xml|json|html|csv|unknown",
      "updateFrequency": "realtime|minutes|hourly|daily|on-demand",
      "sampleFields": ["field1", "field2"],
      "notes": "Any observations from fetching/analyzing the source",
      "verified": true
    }
  ],
  "dataModel": {
    "entities": [
      {
        "name": "entity-name",
        "description": "What this entity represents",
        "fields": [
          { "name": "fieldName", "type": "string|number|boolean|date|coordinates|array|object", "required": true, "description": "What this field holds" }
        ],
        "relationships": ["related-to entity-name-2 via fieldName"]
      }
    ]
  },
  "views": [
    {
      "id": "view-1",
      "type": "map|list|dashboard|cards|timeline|form|detail|settings",
      "title": "View title",
      "description": "What this view shows",
      "dataEntities": ["entity-name"],
      "interactions": ["filter", "search", "create", "export"],
      "visualizations": ["bar-chart", "pie-chart", "heatmap"]
    }
  ],
  "style": {
    "mood": "minimal|playful|professional|data-dense",
    "colorPalette": "Description or hex values",
    "typography": "standard|compact|large-display",
    "layout": "single-page|tabbed|split-panel|fullscreen",
    "animations": "none|subtle|rich",
    "displayContext": "desktop|mobile|kiosk|embedded",
    "references": "Any reference apps or styles the user mentioned"
  },
  "constraints": {
    "updateMode": "realtime|scheduled|on-demand",
    "scheduleInterval": "15m|1h|daily|null",
    "locales": ["fi", "en"],
    "domainRules": "Any domain-specific rules or edge cases",
    "notes": "Any additional context that doesn't fit above"
  },
  "interviewNotes": "Any important context from the conversation that doesn't fit above"
}
\\\`\\\`\\\`

IMPORTANT: The JSON must be inside a \\\`\\\`\\\`json code fence so the user can easily copy it.

Begin the interview now. Start by greeting the user and asking about their technical level.`;
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
- All date/time fields MUST be type: string with description mentioning ISO 8601 format
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
  type: none
  param_name: ""
  env_var: ""
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
- For public APIs (RSS feeds, open data) use \`auth.type: none\` — many APIs don't require authentication
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

## V8 Sandbox Constraints (CRITICAL — read before writing code)

Extension code runs in an ISOLATED V8 sandbox. The following are NOT available:
- No \`require()\`, no \`import\` (except \`export default\` for the action entry point)
- No Node.js APIs (fs, path, crypto, Buffer, process, etc.)
- No \`fetch()\` global — use \`ctx.fetch()\` instead
- No \`setTimeout\`, \`setInterval\`, \`setImmediate\`
- No \`console.log\` — use \`ctx.log.info/warn/error()\`
- No DOM APIs (document, window, etc.)

What IS available:
- Standard JS built-ins: JSON, Math, Date, String, Array, Object, Map, Set, RegExp, Promise, etc.
- \`ctx\` API object (memory, fetch, wallet, consent, trust, caller, config, log)
- \`export default async function(ctx, input) { ... }\` — the action entry point

## ctx.memory API — CRITICAL details

### ctx.memory.get(key) returns the VALUE directly, or undefined
- It does NOT return a string — do NOT call JSON.parse() on the result
- ALWAYS check for undefined/null before using the result

WRONG:
  const data = JSON.parse(await ctx.memory.get("my.key"));  // CRASH: "undefined" is not valid JSON

CORRECT:
  const data = await ctx.memory.get("my.key");
  if (!data) return { error: "No data found" };
  // data is already a JS object/array/value — use it directly

### ctx.memory.set(key, value) stores any JSON-serializable value
  await ctx.memory.set("alerts.2026-03-14", { items: [...], count: 5 });

### ctx.memory.search(prefix) returns objects, NOT strings

WRONG:
  const keys = await ctx.memory.search("prefix.");
  for (const key of keys) { await ctx.memory.get(key); }  // ERROR: key is {key,value} not string

CORRECT:
  const results = await ctx.memory.search("prefix.");
  for (const entry of results) {
    const key = entry.key;    // string
    const value = entry.value; // the stored value — already parsed, NOT a string
  }

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
  timeout_ms: 30000
  max_api_calls: 500
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
  // Use ctx.fetch(url, opts) for HTTP requests — global fetch() is NOT available
  const resp = await ctx.fetch('https://example.com/api');
  if (!resp.ok) {
    ctx.log.error('API request failed', { status: resp.status });
    return { error: 'Request failed with status ' + resp.status };
  }
  const data = JSON.parse(resp.text);
  return { result: data };
}
\`\`\`

CRITICAL: Do NOT use separate code blocks. Put YAML manifest and ALL JavaScript files in ONE block.
Each JavaScript file MUST start with a comment line: // actions/{filename}.js

## Additional rules
- \`metadata\` section MUST have: name, version, description, author
- \`actions\` array MUST NOT be empty — each action needs: id, method, path, script
- Each action's \`script\` field value must match a \`// actions/{script}\` comment below the YAML
- \`limits.timeout_ms\`: use 30000 for extensions that call external APIs, 5000 for memory-only
- \`limits.max_api_calls\`: use 500 for data collectors (many memory writes per run), 100 for simple actions
- All helper functions must be defined INSIDE the same script file — no imports, no cross-file references
- If two actions need the same helper, DUPLICATE the helper in both script files
- NEVER reference functions from another action's script — each script runs in its own isolated scope
- NEVER call JSON.parse() on ctx.memory.get() results — they are already parsed JS values
- Always check for undefined/null before using memory values
- Always convert dates to ISO 8601 before storing in memory`,

  app: (label, context, completedComponents) => {
    // Check if any cortex libraries are in completed components
    const cortexComponents = (completedComponents || []).filter(c => c.type === 'cortex');
    const hasCortex = cortexComponents.length > 0;

    let cortexInstructions = '';
    let cortexScriptLoads = '';
    if (hasCortex) {
      const cortexLibs = cortexComponents.map(c => {
        const nameMatch = c.result?.match?.(/name:\s*"?([^\s"]+)"?/);
        const libName = nameMatch ? nameMatch[1] : c.label;
        return { name: libName, label: c.label, result: c.result };
      });

      cortexScriptLoads = cortexLibs.map(lib =>
        `  await loadScript('/v1/cortex/${lib.name}/libs/${lib.name}.js');`
      ).join('\n');

      cortexInstructions = `
## CORTEX LIBRARIES (use these — do NOT call extensions or memory directly)

This project has Cortex libraries that wrap all extension APIs into clean domain methods.
Load them via <script> tags and use their API.

${cortexLibs.map(lib => `### ${lib.label}
Load: \\\`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\\\`
${lib.result ? `API from manifest:\n${lib.result.slice(0, 800)}` : ''}
`).join('\n')}

IMPORTANT:
- Call \\\`AIMEAT.{libName}.init()\\\` on app start — it handles data initialization automatically
- Use the cortex methods for ALL data access — never call extensions or memory directly
- The cortex handles authentication, error handling, and data transformation
`;
    }

    return `${AIMEAT_CONTEXT}

Create an AIMEAT App (HTML/JS) for: ${label}

${context}

## CRITICAL: Authentication & API Calls

The app runs on the SAME ORIGIN as the AIMEAT node. Use relative API paths (e.g., "/v1/ext/..."), NOT absolute URLs.

### Library setup (copy this exactly — load BOTH libraries):
\`\`\`javascript
// Load AIMEAT libraries — auth handles login/JWT, data handles memory API
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function boot() {
  await loadScript('/v1/libs/aimeat-auth.js');
  await loadScript('/v1/libs/aimeat-data.js');
${hasCortex ? '\n' + cortexScriptLoads : ''}
  AIMEAT.auth.mountLoginButton('#auth-container', {
    onLogin: () => startApp(),
    onLogout: () => location.reload(),
  });
  AIMEAT.auth.login().then(session => { if (session) startApp(); }).catch(() => {});
}
boot();
\`\`\`

${hasCortex ? cortexInstructions : `### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
\\\`\\\`\\\`javascript
// Read YOUR OWN memory key — returns the stored value directly, or null
const myData = await AIMEAT.data.get('my.settings');

// Write a memory key (your own namespace)
await AIMEAT.data.set('my.key', { count: 42 });

// Delete your own memory key
await AIMEAT.data.delete('my.key');
\\\`\\\`\\\`

### Reading EXTENSION-produced data (CRITICAL — most apps need this):
Extensions store data in their OWN namespace (\\\`ext:{extension-name}\\\`).
To read data that an extension wrote, use \\\`getPublic()\\\`:
\\\`\\\`\\\`javascript
// WRONG — this reads YOUR memory, not the extension's:
const data = await AIMEAT.data.get('alerts.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'alerts.by-date.__index');
\\\`\\\`\\\`
The first argument is the extension's memory owner: \\\`"ext:" + extensionName\\\` (the \\\`name\\\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (alerts, stats, risk profiles, caches, etc.).
\\\`getPublic()\\\` returns the value directly (auto-unwraps), or null if not found.

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):
\\\`\\\`\\\`javascript
// Helper for extension calls (copy this):
async function extCall(extName, actionId, body = {}, instanceId = null) {
  const session = AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const path = instanceId
    ? '/v1/ext/' + extName + '/' + instanceId + '/' + actionId
    : '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage:
const result = await extCall('my-extension', 'my-action', { query: 'test' });
\\\`\\\`\\\``}

## CDN Libraries

The AIMEAT app catalog allows external CDN scripts. You may use these via <script> tags:
- Leaflet (maps): https://unpkg.com/leaflet@1/dist/leaflet.js + leaflet.css
- Chart.js (charts): https://cdn.jsdelivr.net/npm/chart.js
- Other CDN libraries from unpkg.com, cdn.jsdelivr.net, or cdnjs.cloudflare.com

## Rules
- DO NOT add manual configuration fields for API URL, Bearer Token, or Instance ID
- DO NOT use prompt() or manual token entry — the auth library handles everything
- ALL API paths MUST be relative (start with /) — never use absolute URLs or NODE_URL
- Use \`window.AIMEAT.auth.getSession()\` to check if logged in; show a "Sign in" message if not
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
${hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : ''}

Return a complete HTML file with an app manifest comment at the top:

\`\`\`html
<!-- AIMEAT App Manifest
name: kebab-case-name
version: 1.0.0
description: What this app does
entry: index.html
-->
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>App Name</title></head>
<body>
  <div id="auth-container"></div>
  <div id="app"></div>
  <script>
    // Auth setup + API helper + app logic here
  </script>
</body>
</html>
\`\`\``;
  },

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

Values are JSON objects. Keep individual values under 100KB.

## Rules
- All keys MUST be lowercase with dots as namespace separators
- Date-bucketed keys MUST use YYYY-MM-DD format: "alerts.by-date.2026-03-14"
- All date/time values inside objects MUST be ISO 8601: "2026-03-14T13:00:00.000Z"
- Include __meta with version and description for every namespace
- Include __index if consumers need to discover which keys exist (e.g., list of dates with data)
- Keep __index lightweight — just key names, counts, and pointers. NOT full data copies.
- Use arrays for ordered collections within a bucket (e.g., alerts per day)
- Use meaningful field names that match the CSM data_schema where applicable

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

- Keys use dot-namespaced paths matching the UI structure: "app.alerts.title", "app.filters.severity"
- Group by UI section: "app.nav.*", "app.map.*", "app.filters.*", "app.stats.*"
- Include domain-specific terms: incident types, severity levels, status labels
- Use interpolation with \${variable} syntax for dynamic values: "Found \${count} alerts"

## Rules
- MUST include BOTH "en" and "fi" locales
- Finnish translations must be natural Finnish, not machine-translated
- Include ALL text that appears in the UI — labels, buttons, tooltips, empty states, error messages
- Keep keys consistent with what the App component will reference
- Use plural-aware keys where needed: "alert.one" / "alert.many"

Return JSON with translations for each locale:
\`\`\`json
{
  "en": {
    "app.title": "App Title",
    "app.nav.home": "Home",
    "app.filters.severity": "Severity",
    "app.filters.all": "All",
    "app.empty": "No data found",
    "app.error": "Something went wrong",
    "domain.type.fire": "Fire",
    "domain.severity.small": "Small"
  },
  "fi": {
    "app.title": "Sovelluksen nimi",
    "app.nav.home": "Etusivu",
    "app.filters.severity": "Vakavuus",
    "app.filters.all": "Kaikki",
    "app.empty": "Tietoja ei löytynyt",
    "app.error": "Jokin meni pieleen",
    "domain.type.fire": "Tulipalo",
    "domain.severity.small": "Pieni"
  }
}
\`\`\``,

  cortex: (label, context, completedComponents) => {
    // Build extension reference from completed components
    const extComponents = (completedComponents || []).filter(c => c.type === 'extension');
    let extRef = '';
    if (extComponents.length > 0) {
      extRef = `\n## Registered Extensions (your cortex wraps these)\n`;
      for (const ext of extComponents) {
        const nameMatch = ext.result?.match?.(/name:\s*"?([^\s"]+)"?/);
        const extName = nameMatch ? nameMatch[1] : ext.label;
        extRef += `- **${extName}** (${ext.label}): memory owner = \`ext:${extName}\`\n`;
        if (ext.result) {
          const preview = ext.result.length > 400 ? ext.result.slice(0, 400) + '...' : ext.result;
          extRef += `  Manifest preview:\n${preview}\n`;
        }
      }
    }

    return `${AIMEAT_CONTEXT}

Create a Cortex extension (client-side JS domain library) for: ${label}

${context}
${extRef}
## What is a Cortex Library?

A Cortex library is a client-side JavaScript library that bridges V8 extensions and the app layer.
It wraps raw AIMEAT API calls (extension actions, memory reads from extension namespaces) into
clean, documented domain methods. Apps import the cortex and call simple methods like
\`AIMEAT.myLib.getData()\` instead of knowing about memory namespaces and extension names.

## Design Principles

1. **Domain Cohesion**: Group related operations into a single API surface
2. **Facade Pattern**: Hide extension namespaces (\`ext:{name}\`), memory key patterns, and error handling
3. **DRY / Genericity**: If a capability is reusable across projects, make it generic
4. **Smart Init**: \`init()\` should actually trigger data collectors/processors if no data exists yet
5. **Composability**: Cortex libs can use other cortex libs via \`AIMEAT.{otherLib}\`
6. **Self-Documenting**: Export clear, named functions with consistent patterns

## IMPORTANT: How Extension Memory Works

Extensions store data in their OWN namespace. To read extension data from client-side:
\\\`\\\`\\\`javascript
// If AIMEAT.data is loaded (preferred):
const value = await AIMEAT.data.getPublic('ext:my-collector', 'alerts.by-date.__index');

// Fallback without AIMEAT.data:
const url = NODE_URL + '/v1/memory/' + encodeURIComponent('ext:my-collector') + '/' + encodeURIComponent(key);
const resp = await fetch(url);
const json = await resp.json();
const value = json.ok ? json.data.value : null;
\\\`\\\`\\\`

## Extension Action Calls (authenticated)

\\\`\\\`\\\`javascript
async function callExt(extName, actionId, body) {
  const session = AIMEAT.auth && AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
    method: 'POST', body: JSON.stringify(body || {}),
  });
  if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
  return resp.data;
}
\\\`\\\`\\\`

## Output Format

Return TWO code blocks:

1. A \\\`\\\`\\\`yaml block with the Cortex manifest
2. A \\\`\\\`\\\`javascript block with the library code

### YAML Manifest Structure:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: my-domain-lib
  namespace: community
  description: "What this library does"
  author: generator
  tags: [domain, tag1, tag2]
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
        AIMEAT.myLib.init() — Initialize and trigger data collection if needed
        AIMEAT.myLib.getData(filters) — Get filtered data
        AIMEAT.myLib.getStats(date) — Get statistics for a date

        To load in an app:
        <script src="{{node_url}}/v1/cortex/my-domain-lib/libs/my-domain-lib.js"></script>

    - type: lib
      name: my-domain-lib
      filename: my-domain-lib.js
      exports: [init, getData, getStats]
      api_surface: |
        AIMEAT.myLib.init() — Smart initialization, triggers collectors if no data
        AIMEAT.myLib.getData({hours, type}) — Filtered domain data
        AIMEAT.myLib.getStats(date) — Aggregated statistics
\\\`\\\`\\\`

### JavaScript Library Pattern:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';

  const LIB_NAME = 'myLib';
  // Extension names this cortex wraps — MUST match the registered extension names
  const EXT = {
    collector: 'my-collector-extension',
    aggregator: 'my-aggregator-extension',
  };

  // ── Internal helpers ──

  function nodeUrl() { return window.location.origin; }

  async function readExtMemory(extName, key) {
    if (AIMEAT.data && AIMEAT.data.getPublic) {
      return AIMEAT.data.getPublic('ext:' + extName, key);
    }
    const url = nodeUrl() + '/v1/memory/' + encodeURIComponent('ext:' + extName) + '/' + encodeURIComponent(key);
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.ok ? json.data.value : null;
  }

  async function callExt(extName, actionId, body) {
    const session = AIMEAT.auth && AIMEAT.auth.getSession();
    if (!session) throw new Error('Not logged in');
    const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
      method: 'POST', body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
    return resp.data;
  }

  // ── Public API ──

  async function init() {
    const index = await readExtMemory(EXT.collector, 'my-data.__index');
    if (!index || !index.dates || index.dates.length === 0) {
      await callExt(EXT.collector, 'collect', {});
    }
    return { ready: true };
  }

  async function getData(filters) {
    // Read from extension memory, apply filters, return clean data
  }

  // ── Register ──
  const exports = { init, getData };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\`

## Rules
- The library MUST be a single IIFE that registers on \`window.AIMEAT\`
- Use \`AIMEAT.register(name, exports)\` if available, always set \`AIMEAT[name] = exports\`
- Use \`AIMEAT.data.getPublic()\` when aimeat-data.js is loaded, fallback to raw fetch
- Use \`AIMEAT.auth.getSession()\` for authenticated extension calls
- Extension names in \`EXT\` object MUST exactly match the registered extension \`metadata.name\`
- \`init()\` MUST be smart: check for data, trigger collectors if empty
- All public methods must be async (return Promises)
- Handle errors gracefully — return null or empty arrays, don't throw for missing data
- Include the prompt component with documented API surface for downstream AI consumers`;
  },
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

  // App and cortex templates receive completedComponents for cross-referencing
  if (type === 'app' || type === 'cortex') {
    return template(label, context, completedComponents);
  }

  return template(label, context);
}

/* ── Fix Prompts ─────────────────────────────────────── */

export function buildBlueprintFixPrompt(description, errors, interviewSpec = null) {
  return `Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have EXACTLY three fields: "id", "type", "label"
- The entire response must be valid JSON — no trailing commas, no unescaped quotes

${buildBlueprintPrompt(description, interviewSpec)}`;
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
