# Package Builder Prompt -- Design Spec

## Goal

Create a self-contained prompt that users paste into Claude Code, VS Code Copilot, or any AI chat. The AI interviews the user about what they want to build, then generates a complete AIMEAT package ZIP that can be uploaded and installed on any AIMEAT node.

## Context

AIMEAT uses a prompt-driven workflow: the application generates ready-made prompts, the user copies them to their chosen AI, and brings the results back. This package builder prompt follows the same pattern.

The digital signage seed package is the reference implementation: CSM schema, memory seed data, cortex (client-side libs), 2 HTML apps (admin panel + kiosk display), and translations.

## Non-goals

- No Foundry/Generator references (broken, not user-facing)
- No interactive wizard UI -- pure prompt-driven workflow
- No per-component scaffold prompts (those exist separately for cortex/extension)
- No downloadable template ZIP -- the prompt IS the template, the AI generates everything

---

## Prompt Structure

The prompt is ~2500-3500 words, self-contained, with dynamic variables (`{{node_url}}`, `{{owner_name}}`). Seven sections:

### Section 1: Role & Context (~200 words)

Sets the AI's role as an AIMEAT Package Builder. Explains:
- What AIMEAT is (one sentence)
- What packages are (bundled components that install as a service)
- The node URL and owner name (injected dynamically)
- That the output is a ZIP file the user uploads, or can be uploaded directly via MCP

### Section 2: Interview (~300 words)

User-centric, not technical. If the user hasn't described what they want:
1. "What are you trying to achieve? Describe your vision."
2. "Who uses this and how?" (admin panel? public display? dashboard? mobile?)
3. "Does it need data from external services?" (weather, APIs, feeds)
4. "What languages should it support?"

If the user already described their idea, skip the interview and design immediately. The AI decides which components are necessary based on the use case -- the user never has to think about component types.

Decision logic the AI follows:
- Every package gets at least one app (HTML)
- If the app manages structured data -> add CSM schema + memory seed data
- If the app needs reusable client-side logic -> add cortex with lib components
- If the app needs external API access (weather, company data, etc.) -> add server extension
- If multi-language -> add translation component
- Cortex triggers (cron, memory-change) are for background processing needs

### Section 3: Component Reference (~800 words)

Self-contained table of the 7 component types. For each:

| Type | What it does | When to use | Content format | File extension in ZIP |
|------|-------------|-------------|----------------|----------------------|
| `csm` | Data schema -- defines fields, types, permissions | App manages structured records | YAML | `.yaml` |
| `extension` | Server-side sandboxed JS -- calls external APIs | Need external data (weather, APIs) | JSON: `{ manifest, scripts }` | `.yaml` |
| `cortex` | Client-side JS libraries + triggers | Reusable UI logic, scheduled tasks | JSON: `{ manifest, libs }` | `.yaml` |
| `app` | Single-file HTML application | Every package needs at least one | HTML with inline CSS+JS | `.html` |
| `memory` | Seed data / initial configuration | Default settings, sample data | JSON: `{ entries: [{key, value}] }` | `.json` |
| `translation` | i18n strings | Multi-language support | JSON: `{ en: {...}, fi: {...} }` | `.json` |
| `msm` | Machine Service Manifest | External API integration definition | YAML | `.yaml` |

Compact example for each type drawn from the digital signage package. The examples must be real, working snippets -- not pseudocode.

### Section 4: ZIP Format Spec (~400 words)

Exact structure:
```
manifest.yaml
components/
  schema.yaml           (CSM, if needed)
  seed-data.json        (Memory, if needed)
  admin.html            (App -- admin panel)
  display.html          (App -- public display, if needed)
  client-lib.yaml       (Cortex, if needed)
  translations.json     (Translation, if needed)
  server-ext.yaml       (Extension, if needed)
```

Complete `manifest.yaml` template:
```yaml
aimeat-package: "1.0"
name: "my-service"
author: "{{owner_name}}"
version: "v1.0.0"
description: "What this service does"
category: "utility"
tags: ["tag1", "tag2"]

components:
  - id: app-main
    type: app
    label: "Main Application"
    file: components/app-main.html
    dependencies: []
```

All required fields documented. Component `id` naming convention. Dependency declaration rules. Category options list.

### Section 5: App HTML Pattern (~500 words)

The critical pattern -- how to build the HTML app correctly. Includes:

**Auth pattern:**
```javascript
// In <head>:
<script src="/v1/libs/aimeat-auth.js"></script>

// In <script>:
var session = null;
function initAuth() {
  if (window.AIMEAT.auth.inSandbox) {
    window.AIMEAT.auth.requestParentAuth().then(function(s) {
      if (s) { session = s; loadData(); }
    });
  } else {
    window.AIMEAT.auth.login().then(function(s) {
      if (s) { session = s; loadData(); }
    });
  }
}
initAuth();
```

**Memory API helpers:**
```javascript
function getHeaders() {
  var h = {'Content-Type': 'application/json'};
  if (session && session.jwt) h['Authorization'] = 'Bearer ' + session.jwt;
  return h;
}
function nodeUrl() {
  return (session && session.nodeUrl) || window.location.origin;
}
function memGet(key) { /* fetch pattern */ }
function memSet(key, value, version) { /* PUT pattern with optimistic locking */ }
```

**Requirements:**
- Single HTML file, all CSS and JS inline
- No external dependencies (except CDN libraries if needed, like Chart.js)
- Works at any screen size (responsive)
- Works in both standalone mode and iframe sandbox mode
- All strings should be translatable if translation component exists
- Uses `var` not `const`/`let` for maximum browser compat in inline scripts

### Section 6: Output Instructions (~300 words)

Three paths based on the AI's environment:

**Path A: File system access (Claude Code, VS Code Copilot)**
1. Create a `package/` directory
2. Write `manifest.yaml` and all component files
3. Run: `cd package && zip -r ../my-service.zip .`
4. Tell the user: "Upload `my-service.zip` in Profile > Packages > Browse > Upload ZIP"

**Path B: Plain AI chat (no file access)**
1. Output each file as a code block with the filename as header
2. Tell the user to save each file in the right structure and zip manually
3. Provide the exact folder structure to create

**Path C: MCP access to the node**
1. Create the files as in Path A
2. Upload via the package import API or MCP tools if available
3. Tell the user: "Package uploaded and available in your Packages tab"

After upload: "Install from Browse Packages or Template Gallery. Your data, apps, and extensions will be registered on the node."

### Section 7: Reference Implementation (~200 words)

"The digital signage package is a complete working example with all component types except server extensions. It manages building announcements, rotated display views, and kiosk settings."

Lists the 6 components with one-line descriptions. Points to:
- `aimeat/src/data/example-packages.ts` -- the full source code
- The live API endpoints where installed components can be inspected
- The admin panel and kiosk apps as working HTML examples

"Study this package's HTML apps for the auth pattern, memory API usage, and UI structure."

---

## Where It Lives

### 1. Packages Tab UI

A section above the nav buttons (after the intro text, before My Instances / Browse / Gallery buttons):

```
[Create Package with AI]  button (copies prompt to clipboard)
"Copy this prompt and paste it into Claude Code, VS Code Copilot, or
any AI chat. Describe what you want to build and the AI will create
an installable package you can upload here -- or install directly
if the AI has access to your node."
```

Styled like the extension tab's "Create with AI" button pattern (`.ext-hero-actions`).

### 2. Prompts API

Stored in the system prompts table via the prompt seeder (`prompt-seeder.ts` / `prompt-defaults.ts`). Served at `GET /v1/prompts/package-builder`.

The prompt text has `{{node_url}}` and `{{owner_name}}` variables that get substituted:
- In the UI: replaced with the current session's node URL and owner name when copied
- In the API: replaced by the prompts route handler (same pattern as existing cortex prompts)

### 3. Prompt Seeder

Added to `src/services/prompt-defaults.ts` alongside existing system prompts (tier1, tier2, etc.). Seeded on server startup. Idempotent -- only creates if not exists.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `aimeat/src/services/prompt-defaults.ts` | Modify | Add `package-builder` prompt definition |
| `aimeat/public/views/profile/packages-tab.js` | Modify | Add "Create Package with AI" button + copy logic |
| `aimeat/locales/en.json` | Modify | Add i18n keys for button text and description |
| `aimeat/locales/fi.json` | Modify | Add Finnish translations |

No new files needed. The prompt text lives in `prompt-defaults.ts` alongside existing prompts.

---

## Dynamic Variables

| Variable | Replaced with | Example |
|----------|---------------|---------|
| `{{node_url}}` | Current node's base URL | `http://localhost:40050` |
| `{{owner_name}}` | Logged-in user's owner name | `happyadmin` |
| `{{node_id}}` | Node identifier | `aimeat-local-001-dev` |

---

## Testing Plan

1. **Copy prompt from UI** -- verify it has the node URL and owner name substituted
2. **Paste into Claude chat** -- describe "I want a todo list app" -- verify it generates a valid ZIP structure
3. **Upload the generated ZIP** -- verify it passes validation and installs
4. **Verify installed components** -- apps work, memory data loaded, cortex active
5. **Paste into Claude Code** -- verify it creates files on disk and zips them
6. **Test with a complex idea** -- "building energy monitor that shows electricity prices from an API" -- verify it correctly decides to include an extension component

---

## Success Criteria

- User can go from "I have an idea" to "working installed service" in under 10 minutes using any AI
- The prompt works in plain AI chat (no codebase access needed)
- The prompt works better with codebase access (Claude Code can read the reference implementation)
- Generated packages pass ZIP validation and install without errors
- Memory/settings data is preserved across package updates
- The digital signage package serves as a discoverable reference the AI can study
