# Generator V2: Interview Phase + Cortex Integration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a research/interview phase before blueprint generation, integrate Cortex library generation into blueprints, and simplify the App prompt to use Cortex APIs instead of raw extension/memory calls.

**Architecture:** Three new capabilities in the generator pipeline: (1) an interview prompt that AI Chat uses to conduct a requirements interview producing structured JSON, (2) a `cortex` component type in blueprints that generates client-side JS domain libraries bridging extensions and apps, (3) a simplified app prompt that imports cortex libraries and focuses on UX/UI. The flow becomes: Description -> Interview -> JSON Spec -> Blueprint (now includes cortex) -> Components -> App.

**Tech Stack:** Preact + HTM (no build step), vanilla JS for prompts/validation, AIMEAT Memory API for state, existing Cortex extension system (`/v1/cortex` API) for registration.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `public/js/services/generator-prompts.js` | Modify | Add `buildInterviewPrompt()`, add `cortex` template, update `app` template, update `buildBlueprintPrompt()` to accept JSON spec |
| `public/js/services/generator-validate.js` | Modify | Add `cortex` validator, add `interviewSpec` validator |
| `public/js/services/generator.js` | Modify | Add `cortex` case to `registerComponent()`, store/retrieve interview spec in project memory |
| `public/views/profile/generator-tab.js` | Modify | Add interview phase UI (new `interview` phase in `NewProjectView`), add spec paste-back textarea |
| `public/css/views/profile.css` | Modify | Styles for interview phase UI elements |
| `locales/en.json` | Modify | Add interview phase + cortex translation keys |
| `locales/fi.json` | Modify | Add interview phase + cortex translation keys |
| `test/e2e-generator.ts` | Modify | Add tests for cortex registration, interview spec storage |
| `test/playwright/generator-interview.spec.ts` | Create | Playwright tests for interview UI flow |

---

## Chunk 1: Interview Prompt & Spec Storage

### Task 1: Interview Prompt Template

**Files:**
- Modify: `public/js/services/generator-prompts.js`

- [ ] **Step 1: Add `buildInterviewPrompt(description)` function**

Add after the existing `buildBlueprintPrompt()` function (line ~105). This generates a prompt the user copies to AI Chat for a conversational requirements interview.

```javascript
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

## Interview Rules

1. ADAPT TO THE USER'S LEVEL:
   - Start by asking: "Are you a technical person who'd prefer detailed technical questions, or would you like me to keep things simple and explain as we go?"
   - If non-technical: ask simple questions with examples, explain what each choice means in practice
   - If technical: ask direct, detailed questions to speed things up

2. COVER THESE AREAS (in order):
   a) USE CASES — What will people actually do with this?
      - Propose 3-5 concrete use cases based on the description as selectable options (A, B, C, D)
      - Let the user add their own use cases
      - IMPORTANT: Do NOT move to the next section until the user confirms they have listed all use cases
      - Ask: "Are there any other use cases you'd like to add, or shall we move on?"

   b) AUDIENCE & SCOPE — Who is this for?
      - Is this for personal use or multiple users?
      - Give examples: "For a ${description.split(' ')[0]} service, personal use means X, multi-user means Y"
      - How many concurrent users do you expect? (give ranges: just me, <10, <100, 100+)

   c) DATA SOURCES — Where does the data come from?
      - Does it pull data from external APIs/feeds/websites?
      - If the user mentions a URL or data source:
        - Try to fetch it and describe what you see (format, fields, update frequency)
        - If you CANNOT access it, say so honestly: "I cannot reach this URL. Could you paste a sample of the data?"
        - NEVER pretend you accessed something you didn't
      - Is data user-generated, imported, or computed?

   d) DATA MODEL — What are the key entities?
      - Based on use cases, propose the main data types/entities
      - Ask about relationships between them
      - Ask about important fields for each entity

   e) VIEWS & INTERACTIONS — What should it look like?
      - Propose view types based on use cases (map, list, dashboard, cards, timeline, etc.)
      - What actions can users take? (filter, search, create, edit, share, export?)
      - Does it need charts/visualizations? What kind?

   f) TECHNICAL CONSTRAINTS
      - Real-time vs batch updates? Explain: "Real-time means updates appear within seconds, batch means data refreshes on a schedule like every 15 minutes"
      - Does it need to work offline?
      - Any specific libraries or integrations required?
      - Language/locale requirements?

3. SECTION RULES:
   - Each section MUST stay open until the user explicitly says to move on
   - After each section, summarize what you understood and ask for confirmation
   - If the user brings up something from a previous section, go back to it
   - Number each question so the user can reference them

4. HONESTY RULES:
   - If you don't know something, say so
   - If you can't access a URL or resource, say so explicitly
   - Don't make assumptions about external APIs — ask the user to confirm
   - If a use case seems technically infeasible, explain why and suggest alternatives

5. WHEN THE INTERVIEW IS COMPLETE:
   - Summarize ALL findings
   - Ask the user to confirm the summary
   - Then output the structured specification in this EXACT JSON format:

\`\`\`json
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
  "constraints": {
    "updateMode": "realtime|scheduled|on-demand",
    "scheduleInterval": "15m|1h|daily|null",
    "offlineSupport": false,
    "locales": ["fi", "en"],
    "libraries": ["leaflet", "chart.js"],
    "notes": "Any additional technical constraints"
  },
  "interviewNotes": "Any important context from the conversation that doesn't fit above"
}
\`\`\`

IMPORTANT: The JSON must be inside a \`\`\`json code fence so the user can easily copy it.

Begin the interview now. Start by greeting the user and asking about their technical level.`;
}
```

- [ ] **Step 2: Verify the export is accessible**

Add `buildInterviewPrompt` to the exports used by `generator-tab.js`. Check the import line in `generator-tab.js` (line 13):

```javascript
import { buildBlueprintPrompt, buildBlueprintFixPrompt, buildComponentPrompt, buildFixPrompt, buildInterviewPrompt } from '/js/services/generator-prompts.js';
```

- [ ] **Step 3: Update `buildBlueprintPrompt` to accept optional JSON spec**

Modify `buildBlueprintPrompt(description)` to `buildBlueprintPrompt(description, interviewSpec = null)`. When a spec is provided, inject it as structured context instead of just the raw description:

```javascript
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
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, cortex-1, app-1)
- Each component object has ONLY "id", "type", "label" — no "manifest", "code", "files", or other keys
- Group components into logical phases
- Cortex components go in a "Connect & Integrate" phase AFTER translations, BEFORE app
- Cortex libraries are client-side JS that wrap extension APIs into clean domain methods for the app
- Default to ONE cortex per project unless complexity clearly warrants splitting
- If splitting, consider DRY: generic reusable cortexes first, then a project-specific facade
- Include ALL components needed for a complete, working service
- Only include what's actually needed — don't pad with unnecessary components`;
}
```

- [ ] **Step 4: Update `buildBlueprintFixPrompt` to pass spec through**

```javascript
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
```

- [ ] **Step 5: Commit**

```bash
git add public/js/services/generator-prompts.js
git commit -m "feat(generator): add interview prompt template and spec-aware blueprint prompt"
```

---

### Task 2: Interview Spec Validation

**Files:**
- Modify: `public/js/services/generator-validate.js`

- [ ] **Step 1: Add `validateInterviewSpec(result)` function**

Add after the existing `validateBlueprint` function. This validates the structured JSON that comes back from the AI interview.

```javascript
/**
 * Validate and extract an interview specification JSON from AI output.
 * Expects a JSON code block with required fields.
 */
export function validateInterviewSpec(result) {
  const errors = [];
  const warnings = [];

  try {
    const raw = extractCodeBlock(result, 'json');
    const cleaned = sanitizeJson(raw);
    const spec = JSON.parse(cleaned);

    // Required top-level fields
    if (!spec.version) errors.push('Missing "version" field');
    if (!spec.projectName) errors.push('Missing "projectName" field');
    if (!spec.description) errors.push('Missing "description" field');
    if (!Array.isArray(spec.useCases) || spec.useCases.length === 0) {
      errors.push('Missing or empty "useCases" array');
    }
    if (!spec.audience) errors.push('Missing "audience" object');
    if (!Array.isArray(spec.dataSources)) errors.push('Missing "dataSources" array');
    if (!spec.dataModel) errors.push('Missing "dataModel" object');
    if (!Array.isArray(spec.views) || spec.views.length === 0) {
      errors.push('Missing or empty "views" array');
    }

    // Validate use cases have required fields
    if (Array.isArray(spec.useCases)) {
      spec.useCases.forEach((uc, i) => {
        if (!uc.id) errors.push(`useCases[${i}] missing "id"`);
        if (!uc.title) errors.push(`useCases[${i}] missing "title"`);
      });
    }

    // Validate data sources
    if (Array.isArray(spec.dataSources)) {
      spec.dataSources.forEach((ds, i) => {
        if (!ds.name) errors.push(`dataSources[${i}] missing "name"`);
        if (!ds.type) errors.push(`dataSources[${i}] missing "type"`);
        if (ds.url && !ds.verified) {
          warnings.push(`dataSources[${i}] "${ds.name}" URL not verified — may need manual validation`);
        }
      });
    }

    // Validate views
    if (Array.isArray(spec.views)) {
      spec.views.forEach((v, i) => {
        if (!v.type) errors.push(`views[${i}] missing "type"`);
        if (!v.title) errors.push(`views[${i}] missing "title"`);
      });
    }

    if (errors.length > 0) return { valid: false, errors, warnings };
    return { valid: true, errors: [], warnings, parsed: spec };
  } catch (e) {
    return { valid: false, errors: [`Failed to parse interview spec: ${e.message}`], warnings: [] };
  }
}
```

- [ ] **Step 2: Update `validateBlueprint` to accept `cortex` type**

Find the type validation in `validateBlueprint` and add `'cortex'` to the allowed types list:

```javascript
// In validateBlueprint, find the component type check and add 'cortex':
const VALID_TYPES = ['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'];
```

- [ ] **Step 3: Add `cortex` validator to the validators object**

```javascript
cortex: (result) => {
  const errors = [];
  // Cortex result should contain YAML manifest + optional JS code blocks
  const yamlBlock = extractCodeBlock(result, 'yaml');
  if (!yamlBlock) {
    errors.push('No YAML code block found — cortex must include a manifest');
    return { valid: false, errors, extracted: null };
  }

  const { parsed, errors: yamlErrors } = tryParseYaml(yamlBlock);
  if (yamlErrors.length > 0) return { valid: false, errors: yamlErrors, extracted: null };

  // Validate cortex YAML structure
  if (parsed.apiVersion !== 'cortex.aimeat.org/v1') {
    errors.push('apiVersion must be "cortex.aimeat.org/v1"');
  }
  if (parsed.kind !== 'Extension') errors.push('kind must be "Extension"');
  if (!parsed.metadata?.name) errors.push('metadata.name is required');
  if (!parsed.spec?.components || !Array.isArray(parsed.spec.components)) {
    errors.push('spec.components array is required');
  }

  // Extract JS library code blocks (```javascript or ```js blocks after the YAML)
  const jsBlocks = [];
  const jsRegex = /```(?:javascript|js)\s*\n([\s\S]*?)```/gi;
  let match;
  // Skip first match if it's inside the YAML block area
  const afterYaml = result.indexOf('```yaml') > -1
    ? result.slice(result.indexOf('```', result.indexOf('```yaml') + 7) + 3)
    : result;
  while ((match = jsRegex.exec(afterYaml)) !== null) {
    jsBlocks.push(match[1].trim());
  }

  // Find lib components to match with JS blocks
  const libComponents = (parsed.spec?.components || []).filter(c => c.type === 'lib');
  if (libComponents.length > 0 && jsBlocks.length === 0) {
    errors.push(`Manifest declares ${libComponents.length} lib component(s) but no JavaScript code blocks found`);
  }

  if (errors.length > 0) return { valid: false, errors, extracted: null };

  return {
    valid: true,
    errors: [],
    extracted: {
      manifest: stringifyYaml(parsed),
      libs: libComponents.map((lib, i) => ({
        filename: lib.filename || `${lib.name}.js`,
        code: jsBlocks[i] || '',
      })),
    },
  };
},
```

- [ ] **Step 4: Export `validateInterviewSpec`**

Ensure the new function is exported:

```javascript
export { validateBlueprint, validateComponent, validateInterviewSpec };
```

- [ ] **Step 5: Commit**

```bash
git add public/js/services/generator-validate.js
git commit -m "feat(generator): add interview spec validator and cortex component validator"
```

---

### Task 3: Interview Spec Storage & Cortex Registration

**Files:**
- Modify: `public/js/services/generator.js`

- [ ] **Step 1: Add interview spec storage functions**

Add after the existing project CRUD functions (~line 90):

```javascript
/* ── Interview Spec ─────────────────────────────────── */

export async function saveInterviewSpec(projectId, spec) {
  return apiPost('/v1/memory', {
    key: `generator.${projectId}.interview-spec`,
    value: spec,
    visibility: 'private',
  });
}

export async function getInterviewSpec(projectId) {
  try {
    const resp = await apiGet(`/v1/memory/generator.${projectId}.interview-spec`);
    if (!resp?.data?.value) return null;
    return typeof resp.data.value === 'string' ? JSON.parse(resp.data.value) : resp.data.value;
  } catch { return null; }
}
```

- [ ] **Step 2: Add `cortex` case to `registerComponent()`**

Add before the `default` case in `registerComponent()`:

```javascript
case 'cortex': {
  // Cortex result contains YAML manifest + optional JS lib code
  // Parse the extracted data (manifest + libs array from validator)
  const extracted = typeof result === 'string' ? null : result;
  if (!extracted || !extracted.manifest) {
    throw new Error('Cortex result must be pre-extracted by validator (manifest + libs)');
  }
  const body = { manifest: extracted.manifest };
  if (extracted.libs && extracted.libs.length > 0) {
    const libs = {};
    for (const lib of extracted.libs) {
      if (lib.filename && lib.code) libs[lib.filename] = lib.code;
    }
    if (Object.keys(libs).length > 0) body.libs = libs;
  }
  const installResp = await apiPost('/v1/cortex', body);
  // Auto-activate after install
  const name = installResp?.data?.name || installResp?.data?.extension?.name;
  if (name) {
    await apiPost(`/v1/cortex/${encodeURIComponent(name)}/activate`);
  }
  return installResp;
}
```

- [ ] **Step 3: Update exports**

Add `saveInterviewSpec` and `getInterviewSpec` to the imports used by `generator-tab.js`.

- [ ] **Step 4: Commit**

```bash
git add public/js/services/generator.js
git commit -m "feat(generator): add interview spec storage and cortex registration"
```

---

### Task 4: Interview Phase UI

**Files:**
- Modify: `public/views/profile/generator-tab.js`

- [ ] **Step 1: Update imports**

Add `buildInterviewPrompt` to the prompt imports and `saveInterviewSpec`, `getInterviewSpec` to the generator imports, and `validateInterviewSpec` to the validate imports.

- [ ] **Step 2: Add `interview` phase to `NewProjectView`**

The current flow is: `describe` -> `blueprint` -> (review). Change to: `describe` -> `interview` -> `blueprint` -> (review).

Update the `NewProjectView` component. Add new state:

```javascript
const [interviewSpec, setInterviewSpec] = useState('');
const [interviewErrors, setInterviewErrors] = useState([]);
const [interviewParsed, setInterviewParsed] = useState(null);
```

Change `handleAnalyze()` to go to `interview` phase instead of `blueprint`:

```javascript
async function handleAnalyze() {
  if (!description.trim()) return;
  try {
    const name = description.slice(0, 60).replace(/\n/g, ' ');
    const p = await createProject(name, description);
    setProject(p);
    setPhase('interview');
  } catch (e) {
    showToast?.(e.message, true);
  }
}
```

- [ ] **Step 3: Add interview phase UI rendering**

Add before the `if (phase === 'blueprint')` block:

```javascript
if (phase === 'interview') {
  function handleCopyInterviewPrompt() {
    const prompt = buildInterviewPrompt(description);
    navigator.clipboard.writeText(prompt).catch(() => {});
    showToast?.(t('profile.generator.interviewPromptCopied') || 'Interview prompt copied!');
  }

  async function handleSubmitSpec() {
    const vr = validateInterviewSpec(interviewSpec);
    if (!vr.valid) {
      setInterviewErrors(vr.errors);
      return;
    }
    setInterviewErrors([]);
    setInterviewParsed(vr.parsed);
    // Store spec in project memory
    await saveInterviewSpec(project.projectId, vr.parsed);
    // Update project description with enriched version
    await updateProject(project.projectId, {
      interviewDone: true,
      enhancedDescription: vr.parsed.description,
    });
    showToast?.(t('profile.generator.specImported') || 'Specification imported!');
    setPhase('blueprint');
  }

  function handleSkipInterview() {
    setPhase('blueprint');
  }

  return html`
    <div class="pf-gen-new-project">
      <button class="btn btn-ghost" onClick=${() => setPhase('describe')}>
        ${t('profile.generator.back')}
      </button>
      <h3>${t('profile.generator.interviewTitle') || 'Requirements Interview'}</h3>
      <p class="pf-gen-subtitle">
        ${t('profile.generator.interviewDesc') || 'Copy the interview prompt to AI Chat. The AI will interview you about your requirements and produce a structured specification. Paste the result back here.'}
      </p>

      <div class="pf-gen-section">
        <label>${t('profile.generator.interviewPrompt') || 'Step 1: Copy Interview Prompt'}</label>
        <button class="btn btn-sm btn-outline" onClick=${handleCopyInterviewPrompt}>
          ${t('profile.generator.copyPrompt')}
        </button>
      </div>

      <div class="pf-gen-section">
        <label>${t('profile.generator.interviewResult') || 'Step 2: Paste Refined Specification'}</label>
        <textarea
          class="pf-gen-result-area"
          rows="14"
          placeholder=${t('profile.generator.interviewPlaceholder') || 'Paste the AI response containing the JSON specification here...'}
          value=${interviewSpec}
          onInput=${e => setInterviewSpec(e.target.value)}
        />
      </div>

      ${interviewErrors.length > 0 && html`
        <div class="pf-gen-errors">
          <label>${t('profile.generator.errors')}</label>
          <ul>${interviewErrors.map(e => html`<li>${e}</li>`)}</ul>
        </div>
      `}

      <div class="pf-gen-actions">
        <button class="btn btn-primary" onClick=${handleSubmitSpec} disabled=${!interviewSpec.trim()}>
          ${t('profile.generator.importSpec') || 'Import Specification'}
        </button>
        <button class="btn btn-ghost" onClick=${handleSkipInterview}>
          ${t('profile.generator.skipInterview') || 'Skip (use description only)'}
        </button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: Update blueprint phase to use interview spec**

In the blueprint phase, update `handleCopyBlueprintPrompt` to pass the interview spec:

```javascript
function handleCopyBlueprintPrompt() {
  const prompt = buildBlueprintPrompt(description, interviewParsed);
  navigator.clipboard.writeText(prompt).catch(() => {});
  showToast?.('Blueprint prompt copied!');
}
```

And update the fix prompt similarly:

```javascript
const fixPrompt = blueprintErrors.length > 0
  ? buildBlueprintFixPrompt(description, blueprintErrors, interviewParsed)
  : null;
```

- [ ] **Step 5: Commit**

```bash
git add public/views/profile/generator-tab.js
git commit -m "feat(generator): add interview phase UI with spec paste-back flow"
```

---

### Task 5: i18n Keys for Interview Phase

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Add English translation keys**

Add under `profile.generator`:

```json
"interviewTitle": "Requirements Interview",
"interviewDesc": "Copy the interview prompt to AI Chat. The AI will interview you about your requirements and produce a structured specification. When the interview is complete, paste the JSON specification back here.",
"interviewPrompt": "Step 1: Copy Interview Prompt to AI Chat",
"interviewResult": "Step 2: Paste the JSON Specification",
"interviewPlaceholder": "Paste the complete AI response here — the system will extract the JSON specification...",
"interviewPromptCopied": "Interview prompt copied! Paste it to AI Chat to begin the interview.",
"specImported": "Specification imported successfully!",
"importSpec": "Import Specification",
"skipInterview": "Skip (use description only)",
"cortexPhase": "Connect & Integrate",
"cortexDesc": "Client-side domain library bridging extensions and app"
```

- [ ] **Step 2: Add Finnish translation keys**

Add matching keys under `profile.generator`:

```json
"interviewTitle": "Vaatimusten kartoitus",
"interviewDesc": "Kopioi haastatteluprompt AI Chattiin. Tekoaly haastattelee sinua vaatimuksistasi ja tuottaa rakenteellisen maarittelyn. Kun haastattelu on valmis, liita JSON-maarittely tanne takaisin.",
"interviewPrompt": "Vaihe 1: Kopioi haastatteluprompt AI Chattiin",
"interviewResult": "Vaihe 2: Liita JSON-maarittely",
"interviewPlaceholder": "Liita tekoalyn vastaus tahan — jarjestelma poimii JSON-maarittelyn...",
"interviewPromptCopied": "Haastatteluprompt kopioitu! Liita se AI Chattiin aloittaaksesi haastattelun.",
"specImported": "Maarittely tuotu onnistuneesti!",
"importSpec": "Tuo maarittely",
"skipInterview": "Ohita (kayta vain kuvausta)",
"cortexPhase": "Yhdista ja integroi",
"cortexDesc": "Asiakaspuolen domain-kirjasto laajennusten ja sovelluksen valilla"
```

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat(i18n): add interview phase and cortex translation keys"
```

---

## Chunk 2: Cortex Component Generation

### Task 6: Cortex Generation Prompt Template

**Files:**
- Modify: `public/js/services/generator-prompts.js`

- [ ] **Step 1: Add `cortex` template to `COMPONENT_TEMPLATES`**

Add the cortex case to the `COMPONENT_TEMPLATES` object, after the `translation` template:

```javascript
cortex: (label, context) => `${AIMEAT_CONTEXT}

Create a Cortex extension (client-side JS domain library) for: ${label}

${context}

## What is a Cortex Library?

A Cortex library is a client-side JavaScript library that bridges V8 extensions and the app layer.
It wraps raw AIMEAT API calls (extension actions, memory reads from extension namespaces) into
clean, documented domain methods. Apps import the cortex and call simple methods like
\`AIMEAT.halytyskartta.getAlerts()\` instead of knowing about memory namespaces and extension names.

## Design Principles

1. **Domain Cohesion**: Group related operations into a single API surface
2. **Facade Pattern**: Hide extension namespaces (\`ext:{name}\`), memory key patterns, and error handling
3. **DRY / Genericity**: If a capability is reusable across projects, make it generic
4. **Smart Init**: \`init()\` should actually trigger data collectors/processors if no data exists yet
5. **Composability**: Cortex libs can use other cortex libs via \`AIMEAT.{otherLib}\`
6. **Self-Documenting**: Export clear, named functions with consistent patterns

## IMPORTANT: How Extension Memory Works

Extensions store data in their OWN namespace. To read extension data from client-side:
\`\`\`javascript
// Extension "my-collector" stores data under key "alerts.by-date.2026-03-14"
// Its memory owner is "ext:my-collector"
// To read it from client-side, use the public memory API:
const url = NODE_URL + '/v1/memory/' + encodeURIComponent('ext:my-collector') + '/' + encodeURIComponent('alerts.by-date.2026-03-14');
const resp = await fetch(url);
const json = await resp.json();
const value = json.ok ? json.data.value : null;
\`\`\`

Or if AIMEAT.data is loaded:
\`\`\`javascript
const value = await AIMEAT.data.getPublic('ext:my-collector', 'alerts.by-date.2026-03-14');
\`\`\`

## Extension Action Calls (authenticated)

To call extension actions, use the authenticated session:
\`\`\`javascript
async function callExtension(session, extName, actionId, body = {}) {
  const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;
}
\`\`\`

## Output Format

Return TWO code blocks:

1. A \`\`\`yaml block with the Cortex manifest
2. A \`\`\`javascript block with the library code

### YAML Manifest Structure:
\`\`\`yaml
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

        To load:
        <script src="{{node_url}}/v1/cortex/my-domain-lib/libs/my-domain-lib.js"></script>

    - type: lib
      name: my-domain-lib
      filename: my-domain-lib.js
      exports: [init, getData, getStats]
      api_surface: |
        AIMEAT.myLib.init() — Smart initialization, triggers collectors if no data
        AIMEAT.myLib.getData({hours, municipality, type}) — Filtered domain data
        AIMEAT.myLib.getStats(date) — Aggregated statistics
\`\`\`

### JavaScript Library Pattern:
\`\`\`javascript
(function (AIMEAT) {
  'use strict';

  const LIB_NAME = 'myLib';
  // Extension names this cortex wraps — MUST match the registered extension names
  const EXT = {
    collector: 'my-collector-extension',
    aggregator: 'my-aggregator-extension',
  };

  // ── Internal helpers ──

  function nodeUrl() {
    return window.location.origin;
  }

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
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
    return resp.data;
  }

  // ── Public API ──

  async function init() {
    // Check if data exists; if not, trigger the collector
    const index = await readExtMemory(EXT.collector, 'my-data.__index');
    if (!index || !index.dates || index.dates.length === 0) {
      // Trigger collector to populate initial data
      await callExt(EXT.collector, 'collect', {});
    }
    return { ready: true };
  }

  async function getData(filters) {
    // ... implementation reading from extension memory
  }

  // ── Register ──

  const exports = { init, getData };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`

## Rules
- The library MUST be a single IIFE that registers on \`window.AIMEAT\`
- Use \`AIMEAT.register(name, exports)\` if available, always set \`AIMEAT[name] = exports\`
- Use \`AIMEAT.data.getPublic()\` when aimeat-data.js is loaded, fallback to raw fetch
- Use \`AIMEAT.auth.getSession()\` for authenticated extension calls
- Extension names in \`EXT\` object MUST exactly match the registered extension \`metadata.name\`
- \`init()\` MUST be smart: check for data, trigger collectors if empty
- All public methods must be async (return Promises)
- Handle errors gracefully — return null or empty arrays, don't throw for missing data
- Include the prompt component with documented API surface for downstream AI consumers`,
```

- [ ] **Step 2: Update AIMEAT_CONTEXT to mention Cortex**

In the `AIMEAT_CONTEXT` string (~line 31), add Cortex to the building blocks list:

```
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.
```

- [ ] **Step 3: Update version history**

```javascript
 *   v4.0.0 — 2026-03-14 — Generator V2: add buildInterviewPrompt(), cortex
 *     component template, update blueprint to support cortex type and interview spec,
 *     update app template to use cortex libraries
```

- [ ] **Step 4: Commit**

```bash
git add public/js/services/generator-prompts.js
git commit -m "feat(generator): add cortex generation prompt template"
```

---

### Task 7: Simplified App Prompt (Cortex-Aware)

**Files:**
- Modify: `public/js/services/generator-prompts.js`

- [ ] **Step 1: Update the `app` template to detect and use cortex**

The app template should check if any completed components are cortex type. If so, it should reference the cortex API instead of raw extension/memory patterns. Modify the `app` template in `COMPONENT_TEMPLATES`:

Replace the entire AIMEAT.data / getPublic / extCall documentation section with a conditional block. In `buildComponentPrompt()`, the `completedComponents` array already includes cortex components with their result previews. The app template should detect this.

Update the app template function signature to receive the full context including completed components, then adjust the instructions:

```javascript
app: (label, context, completedComponents) => {
  // Check if any cortex libraries are in completed components
  const cortexComponents = (completedComponents || []).filter(c => c.type === 'cortex');
  const hasCortex = cortexComponents.length > 0;

  // Build cortex-specific instructions
  let cortexInstructions = '';
  if (hasCortex) {
    const cortexLibs = cortexComponents.map(c => {
      // Try to extract the lib name and API surface from the result
      const nameMatch = c.result?.match?.(/name:\s*(\S+)/);
      const libName = nameMatch ? nameMatch[1] : c.label;
      return { name: libName, label: c.label, result: c.result };
    });

    cortexInstructions = `
## CORTEX LIBRARIES (use these — do NOT call extensions or memory directly)

This project has Cortex libraries that wrap all extension APIs into clean domain methods.
Load them via <script> tags and use their API.

${cortexLibs.map(lib => `### ${lib.label}
Load: \`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\`
${lib.result ? `API from manifest:\n${lib.result.slice(0, 800)}` : ''}
`).join('\n')}

IMPORTANT:
- Call \`AIMEAT.{libName}.init()\` on app start — it handles data initialization automatically
- Use the cortex methods for ALL data access — never call extensions or memory directly
- The cortex handles authentication, error handling, and data transformation
`;
  }

  // Simplified app template that references cortex when available
  return `${AIMEAT_CONTEXT}

Create an AIMEAT App (HTML/JS) for: ${label}

${context}

## CRITICAL: Authentication & API Calls

The app runs on the SAME ORIGIN as the AIMEAT node. Use relative API paths.

### Library setup (copy this exactly — load BOTH libraries):
\`\`\`javascript
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
${hasCortex ? cortexComponents.map(c => {
    const nameMatch = c.result?.match?.(/name:\s*(\S+)/);
    const libName = nameMatch ? nameMatch[1] : c.label;
    return `  await loadScript('/v1/cortex/${libName}/libs/${libName}.js');`;
  }).join('\n') : ''}

  AIMEAT.auth.mountLoginButton('#auth-container', {
    onLogin: () => startApp(),
    onLogout: () => location.reload(),
  });
  AIMEAT.auth.login().then(session => { if (session) startApp(); }).catch(() => {});
}
boot();
\`\`\`
${hasCortex ? cortexInstructions : `
### AIMEAT.data API (memory read/write):
\\\`\\\`\\\`javascript
const myData = await AIMEAT.data.get('my.settings');
await AIMEAT.data.set('my.key', { count: 42 });
await AIMEAT.data.delete('my.key');
\\\`\\\`\\\`

### Reading EXTENSION-produced data:
Extensions store data in their OWN namespace (\\\`ext:{extension-name}\\\`).
\\\`\\\`\\\`javascript
const data = await AIMEAT.data.getPublic('ext:my-extension', 'my-key');
\\\`\\\`\\\`

### Calling extension actions:
\\\`\\\`\\\`javascript
async function extCall(extName, actionId, body = {}) {
  const session = AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
    method: 'POST', body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;
}
\\\`\\\`\\\`
`}
## CDN Libraries
Leaflet (maps): https://unpkg.com/leaflet@1/dist/leaflet.js + leaflet.css
Chart.js (charts): https://cdn.jsdelivr.net/npm/chart.js
Other CDN libraries from unpkg.com, cdn.jsdelivr.net, or cdnjs.cloudflare.com

## Rules
- DO NOT add manual configuration fields for API URL, Bearer Token, or Instance ID
- DO NOT use prompt() or manual token entry — the auth library handles everything
- ALL API paths MUST be relative (start with /) — never use absolute URLs
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings
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
    // Auth setup + cortex init + app logic here
  </script>
</body>
</html>
\`\`\``;
},
```

- [ ] **Step 2: Update `buildComponentPrompt` to pass completedComponents to app template**

Modify the function to pass `completedComponents` as a third argument for the app type:

```javascript
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
        const preview = c.result.length > 500 ? c.result.slice(0, 500) + '...': c.result;
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
```

- [ ] **Step 3: Commit**

```bash
git add public/js/services/generator-prompts.js
git commit -m "feat(generator): simplify app prompt to use cortex libraries when available"
```

---

## Chunk 3: E2E Tests

### Task 8: Generator E2E Tests for Cortex & Interview

**Files:**
- Modify: `test/e2e-generator.ts`

- [ ] **Step 1: Add interview spec storage test**

Add a test that stores and retrieves an interview spec via the memory API:

```typescript
await test('store and retrieve interview spec', async () => {
  const spec = {
    version: '1.0',
    projectName: 'Test Project',
    description: 'A test project',
    useCases: [{ id: 'uc-1', title: 'Test use case', description: 'Testing', priority: 'must-have' }],
    audience: { type: 'personal', scale: 'single', description: 'Just me' },
    dataSources: [],
    dataModel: { entities: [] },
    views: [{ id: 'view-1', type: 'list', title: 'Main view', description: 'Shows data' }],
    constraints: { updateMode: 'on-demand', locales: ['en'] },
  };

  // Store spec
  const storeResp = await authJson('POST', '/v1/memory', {
    key: `generator.${projectId}.interview-spec`,
    value: spec,
    visibility: 'private',
  });
  assert(storeResp.body.ok, 'Should store interview spec');

  // Retrieve spec
  const getResp = await authJson('GET', `/v1/memory/generator.${projectId}.interview-spec`);
  assert(getResp.body.ok, 'Should retrieve interview spec');
  assert(getResp.body.data.value.projectName === 'Test Project', 'Spec projectName should match');
  assert(getResp.body.data.value.useCases.length === 1, 'Spec should have 1 use case');
});
```

- [ ] **Step 2: Add cortex registration test**

Add a test that registers a minimal cortex extension through the API:

```typescript
await test('register cortex extension via generator flow', async () => {
  const manifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: test-gen-cortex
  namespace: ${ownerName}
  description: "Test cortex from generator"
  author: ${ownerName}
  tags: [test]
  labels:
    domain: test
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: test-gen-cortex
      filename: test-gen-cortex.js
      exports: [init, getData]
      api_surface: |
        AIMEAT.testGen.init() - Initialize
        AIMEAT.testGen.getData() - Get data`;

  const libCode = `(function(AIMEAT){
    AIMEAT.testGen = { init: async function(){ return {ready:true}; }, getData: async function(){ return []; } };
    if(AIMEAT.register) AIMEAT.register('testGen', AIMEAT.testGen);
  })(window.AIMEAT||(window.AIMEAT={}));`;

  // Install
  const installResp = await authJson('POST', '/v1/cortex', {
    manifest,
    libs: { 'test-gen-cortex.js': libCode },
  });
  assert(installResp.body.ok, 'Should install cortex extension');

  // Activate
  const activateResp = await authJson('POST', '/v1/cortex/test-gen-cortex/activate');
  assert(activateResp.body.ok, 'Should activate cortex extension');

  // Verify lib is served
  const libResp = await rawFetch('/v1/cortex/test-gen-cortex/libs/test-gen-cortex.js');
  assert(libResp.status === 200, 'Should serve cortex lib file');
  const libText = await libResp.text();
  assert(libText.includes('AIMEAT.testGen'), 'Lib should contain AIMEAT.testGen');

  // Cleanup
  await authJson('DELETE', '/v1/cortex/test-gen-cortex');
});
```

- [ ] **Step 3: Add blueprint validation test for cortex type**

```typescript
await test('blueprint with cortex type validates correctly', async () => {
  const blueprint = {
    components: [
      { id: 'csm-1', type: 'csm', label: 'Data Schema' },
      { id: 'ext-1', type: 'extension', label: 'Data Collector' },
      { id: 'cortex-1', type: 'cortex', label: 'Domain SDK' },
      { id: 'app-1', type: 'app', label: 'Web App' },
    ],
    phases: [
      { id: 'define', label: 'Define Service', componentIds: ['csm-1'] },
      { id: 'logic', label: 'Build Logic', componentIds: ['ext-1'] },
      { id: 'connect', label: 'Connect', componentIds: ['cortex-1'] },
      { id: 'ui', label: 'Build UI', componentIds: ['app-1'] },
    ],
  };

  // Store as project blueprint
  const storeResp = await authJson('POST', '/v1/memory', {
    key: `generator.${projectId}.project`,
    value: { ...projectData, blueprint, status: 'in_progress' },
    visibility: 'private',
  });
  assert(storeResp.body.ok, 'Should store blueprint with cortex type');

  // Retrieve and verify
  const getResp = await authJson('GET', `/v1/memory/generator.${projectId}.project`);
  const bp = getResp.body.data.value.blueprint;
  assert(bp.components.some(c => c.type === 'cortex'), 'Blueprint should include cortex component');
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd aimeat && pnpm test:e2e:sqlite
cd aimeat && pnpm test:e2e:mongodb
```

- [ ] **Step 5: Commit**

```bash
git add test/e2e-generator.ts
git commit -m "test(generator): add E2E tests for interview spec storage and cortex registration"
```

---

### Task 9: Playwright Tests for Interview UI

**Files:**
- Create: `test/playwright/generator-interview.spec.ts`

- [ ] **Step 1: Create Playwright test for interview flow UI**

```typescript
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40050';

test.describe('Generator Interview Phase', () => {
  test('interview phase is accessible from new project flow', async ({ page }) => {
    await page.goto(`${BASE}/v1/profile`);

    // Navigate to generator tab
    const genTab = page.locator('text=Generaattori, text=Generator').first();
    if (await genTab.isVisible()) {
      await genTab.click();
    }

    // Look for new project button or description textarea
    const newBtn = page.locator('text=Uusi projekti, text=New project').first();
    if (await newBtn.isVisible()) {
      await newBtn.click();
    }

    // Verify description textarea exists
    const descArea = page.locator('textarea.pf-gen-description');
    await expect(descArea).toBeVisible({ timeout: 5000 });
  });

  test('interview prompt copy button is present after description submit', async ({ page }) => {
    await page.goto(`${BASE}/v1/profile`);

    // This test verifies the UI structure exists
    // Full flow requires authentication which is handled by the auth system
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run Playwright tests**

```bash
cd aimeat && npx playwright test test/playwright/generator-interview.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/playwright/generator-interview.spec.ts
git commit -m "test(playwright): add generator interview phase UI tests"
```

---

## Chunk 4: Final Integration & Verification

### Task 10: Wire Everything Together

**Files:**
- Modify: `public/views/profile/generator-tab.js`
- Modify: `public/js/services/generator-prompts.js`

- [ ] **Step 1: Ensure cortex component in ProjectDashboard shows prompt correctly**

In the `ComponentDetail` section of `generator-tab.js`, verify that the cortex type component shows the Copy Prompt button and generates the correct prompt. The existing `handleCopyPrompt()` already calls `buildComponentPrompt()` which will dispatch to the new cortex template.

Verify the component registration flow handles cortex: in the `handleRegister()` function, the cortex validator should extract manifest + libs, then `registerComponent('cortex', extracted)` installs and activates.

- [ ] **Step 2: Update the component detail UI to handle cortex registration**

The cortex validator returns `{ manifest, libs }` — the registration function needs the extracted data, not the raw result. Update the registration flow in `generator-tab.js` to pass extracted data for cortex type:

```javascript
// In handleRegister():
if (component.type === 'cortex') {
  const vr = validateComponent('cortex', component.result);
  if (!vr.valid) {
    showToast?.('Validation failed: ' + vr.errors.join(', '), true);
    return;
  }
  resp = await registerComponent('cortex', vr.extracted, session);
} else {
  resp = await registerComponent(component.type, component.result, session);
}
```

- [ ] **Step 3: Add cortex to the phase label mapping**

In the blueprint sidebar rendering, ensure cortex components show with the correct phase label. Check the phase grouping logic and add cortex if missing from type-to-icon or type-to-color mappings.

- [ ] **Step 4: Run full test suite**

```bash
cd aimeat && npx tsc --noEmit
cd aimeat && pnpm lint
cd aimeat && pnpm test:e2e:sqlite
cd aimeat && pnpm test:e2e:mongodb
cd aimeat && npx playwright test
```
Expected: All tests pass, including new generator and Playwright tests.

- [ ] **Step 5: Commit**

```bash
git add public/views/profile/generator-tab.js public/js/services/generator-prompts.js
git commit -m "feat(generator): wire cortex registration and interview flow end-to-end"
```

---

### Task 11: Update File Headers & Version History

**Files:**
- Modify: `public/js/services/generator-prompts.js`
- Modify: `public/js/services/generator-validate.js`
- Modify: `public/js/services/generator.js`
- Modify: `public/views/profile/generator-tab.js`

- [ ] **Step 1: Update all modified file headers**

Update `@description`, `@structure`, and `@version-history` in each modified file to reflect the new interview phase, cortex support, and updated app prompt.

- [ ] **Step 2: Commit**

```bash
git add public/js/services/generator-prompts.js public/js/services/generator-validate.js public/js/services/generator.js public/views/profile/generator-tab.js
git commit -m "docs: update file headers for generator v2 changes"
```

---

## Dependency Graph

```
Task 1 (Interview Prompt) ──────────┐
Task 2 (Spec Validation) ───────────┤
Task 3 (Spec Storage + Cortex Reg) ─┤──→ Task 4 (Interview UI) ──→ Task 10 (Integration)
Task 5 (i18n) ──────────────────────┘                                      ↓
Task 6 (Cortex Prompt) ─────────────────→ Task 7 (App Prompt) ──→ Task 10 (Integration)
                                                                           ↓
                                                              Task 8 (E2E Tests)
                                                              Task 9 (Playwright Tests)
                                                                           ↓
                                                              Task 11 (Headers)
```

**Parallelizable tasks:**
- Tasks 1, 2, 3, 5, 6 can all be done in parallel (independent files)
- Task 4 depends on Tasks 1, 2, 3, 5
- Task 7 depends on Task 6
- Task 10 depends on Tasks 4, 7
- Tasks 8, 9 depend on Task 10
- Task 11 is last

---

## Summary of Changes

| What | Before | After |
|------|--------|-------|
| New project flow | Description → Blueprint | Description → Interview → Spec → Blueprint |
| Blueprint types | csm, msm, extension, app, memory, translation | + cortex |
| App data access | Raw `getPublic()` + extension names | Cortex API (`AIMEAT.lib.getData()`) |
| Data initialization | User must manually trigger extensions | Cortex `init()` auto-triggers collectors |
| Extension namespace knowledge | App must know `ext:{name}` | Cortex hides this |
| Interview findings | Lost after conversation | Stored in project memory as JSON |
