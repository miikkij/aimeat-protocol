# Package Builder Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Create Package with AI" prompt to the packages tab that lets users generate installable AIMEAT packages by pasting the prompt into any AI.

**Architecture:** The prompt text lives in `prompt-defaults.ts` (seeded to DB on startup). The packages tab gets a "Create with AI" button that builds the prompt with dynamic variables and copies to clipboard. Follows the exact pattern from the extensions tab's `buildCortexPrompt()` + copy button.

**Tech Stack:** Preact + HTM frontend, TypeScript backend prompt seeder, i18n locales.

**Note:** Do NOT commit after each task. All changes are committed together at the end.

---

## File Map

| File | Changes |
|------|---------|
| `aimeat/src/services/prompt-defaults.ts` | Add `package-builder` prompt entry to `PROMPT_SEEDS` array |
| `aimeat/public/views/profile/packages-tab.js` | Add `buildPackagePrompt()` function and "Create with AI" button |
| `aimeat/locales/en.json` | Add i18n keys for button text and toast |
| `aimeat/locales/fi.json` | Add Finnish translations |

---

## Task 1: Add the prompt to prompt-defaults.ts

**Files:**
- Modify: `aimeat/src/services/prompt-defaults.ts`

The prompt is added as a new entry in the `PROMPT_SEEDS` array. It follows the `PromptSeedEntry` interface: `{ id, group, name, description, content, variables, usedIn }`.

The content field will be ~200 lines. It does NOT need to be a template literal with interpolation -- variables use `{{var}}` syntax and get substituted at serve time by the prompts route. However, for the packages-tab UI, the prompt is built client-side with JS string interpolation (like `buildCortexPrompt` does), so the `{{var}}` syntax is only for the API path.

- [ ] **Step 1: Add the prompt seed entry**

At the end of the `PROMPT_SEEDS` array in `aimeat/src/services/prompt-defaults.ts`, add:

```typescript
{
  id: 'package-builder',
  group: 'builders',
  name: 'Package Builder',
  description: 'AI prompt for creating complete AIMEAT packages. Interviews the user about their vision, designs the components, and generates an installable ZIP.',
  content: PACKAGE_BUILDER_PROMPT,
  variables: ['node_url', 'owner_name', 'node_id'],
  usedIn: ['/v1/prompts/package-builder'],
},
```

Then define the `PACKAGE_BUILDER_PROMPT` constant above the `PROMPT_SEEDS` array. The full prompt text is specified in Step 2 below.

- [ ] **Step 2: Write the prompt text**

The prompt constant `PACKAGE_BUILDER_PROMPT` should contain the following 7 sections. This is the complete text -- write it as a single template literal or string concatenation.

**Section 1: Role & Context**
- You are an AIMEAT Package Builder
- AIMEAT is an open protocol for AI agent infrastructure with persistent memory, identity, and federated nodes
- A package bundles components (schemas, apps, extensions, seed data) into an installable unit
- The target node is at `{{node_url}}`, the user is `{{owner_name}}`
- Output is a ZIP file the user uploads, or direct upload if MCP access available

**Section 2: Interview**
- If the user already described what they want, skip to designing
- Otherwise ask 3-4 questions about their vision:
  - What are you trying to achieve? What problem does this solve?
  - Who uses this and how? (admin panel, public display, dashboard, mobile view?)
  - Does it need data from external services? (APIs, feeds, sensors?)
  - What languages should it support? (if not obvious from context)
- Based on answers, YOU decide which components are needed -- the user never has to think about component types

**Section 3: Component Types Reference**
Table of the 7 types with decision criteria:

| Type | Purpose | When to use | Format | ZIP extension |
|------|---------|-------------|--------|---------------|
| `app` | HTML application (UI) | Every package needs at least one | Single HTML file, all CSS+JS inline | `.html` |
| `csm` | Data schema | App manages structured records with defined fields | YAML with schemas + permissions | `.yaml` |
| `memory` | Seed data / config | Default settings, sample records | JSON: `{ entries: [{key, value, visibility}] }` | `.json` |
| `cortex` | Client-side JS libs | Reusable logic shared across apps, scheduled processing | JSON: `{ manifest: "YAML", libs: {"file.js": "code"} }` | `.yaml` |
| `extension` | Server-side sandboxed JS | Need external API access (weather, company data, etc.) | JSON: `{ manifest: "YAML", scripts: {"name": "code"} }` | `.yaml` |
| `translation` | i18n strings | Multi-language support | JSON: `{ en: {...}, fi: {...} }` | `.json` |
| `msm` | Machine service manifest | Define external API integration | YAML | `.yaml` |

Decision guide:
- Local data management -> app + csm + memory
- Needs reusable client logic or scheduled tasks -> add cortex
- Needs external APIs -> add extension
- Multi-language -> add translation
- Most packages need: 1-2 apps + memory + optionally csm/cortex

**Section 4: ZIP Format**
```
manifest.yaml              <- required, describes the package
components/
  my-app.html              <- app components
  my-admin.html
  my-schema.yaml           <- CSM schema
  my-data.json             <- memory seed data
  my-cortex.yaml           <- cortex (manifest+libs as JSON inside YAML)
  my-translations.json     <- translation strings
```

Complete manifest.yaml template:
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

  - id: seed-data
    type: memory
    label: "Initial Data"
    file: components/seed-data.json
    dependencies: []
```

Categories: utility, iot, social, productivity, communication, marketplace, other.
Component IDs must be unique within the package. Use kebab-case.
Dependencies reference other component IDs within the same package.

**Section 5: App HTML Pattern**
The critical pattern for building HTML apps. Include the complete auth + memory API boilerplate:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>App Title</title>
<script src="/v1/libs/aimeat-auth.js"></` + `script>
<style>
/* All CSS inline */
</style>
</head>
<body>
<div id="app">Loading...</div>
<div id="login-mount"></div>
<script>
var session=null;

function getHeaders(){
  var h={'Content-Type':'application/json'};
  if(session&&session.jwt)h['Authorization']='Bearer '+session.jwt;
  return h;
}
function nodeUrl(){return(session&&session.nodeUrl)||window.location.origin}

function memGet(key){
  return fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(key),{headers:getHeaders()})
    .then(function(r){return r.json()})
    .then(function(j){
      if(!j.ok)return null;
      var d=j.data;
      return{value:typeof d.value==='string'?JSON.parse(d.value):d.value,version:d.version};
    });
}
function memSet(key,val,ver){
  return fetch(nodeUrl()+'/v1/memory/'+encodeURIComponent(key),{
    method:'PUT',headers:getHeaders(),
    body:JSON.stringify({value:val,version:ver})
  });
}

function loadData(){ /* fetch and render */ }

function initAuth(){
  try{
    if(!window.AIMEAT||!window.AIMEAT.auth){return}
    if(window.AIMEAT.auth.inSandbox){
      window.AIMEAT.auth.requestParentAuth().then(function(s){
        if(s){session=s;loadData()}
      });
    }else{
      window.AIMEAT.auth.login().then(function(s){
        if(s){session=s;loadData()}
        else{
          window.AIMEAT.auth.mountLoginButton('#login-mount',{
            onLogin:function(){session=window.AIMEAT.auth.getSession();loadData()}
          });
        }
      });
    }
  }catch(e){}
}
initAuth();
</` + `script>
</body>
</html>
```

Rules:
- Single HTML file, all CSS and JS inline
- No external dependencies unless from CDN (e.g., Chart.js)
- Use `var` not `const`/`let` for inline scripts (maximum compat)
- Responsive -- works at any screen size
- Works in standalone mode AND iframe sandbox mode
- Use `memGet`/`memSet` for all data storage
- Use optimistic locking: read version from memGet, pass it to memSet
- Escape user content before inserting into HTML (XSS prevention)

**Section 6: Output Instructions**
Three paths:

If you have file system access (Claude Code, VS Code Copilot):
1. Create a `package/` directory
2. Write `manifest.yaml` and all component files under `package/components/`
3. Run: `cd package && zip -r ../my-service.zip . && cd ..`
4. Tell the user: "Upload my-service.zip in Profile > Packages > Browse Packages > Upload ZIP"

If in a plain AI chat:
1. Output each file as a code block with the filename
2. Tell the user to create the folder structure and zip manually

If MCP access to the node is available:
1. Create and zip the files as above
2. Upload via the package import endpoint or MCP tools

**Section 7: Reference**
"The digital signage package is a complete working example. It has 6 components:
- CSM schema (resident, announcement, rotatedView data types)
- Memory seed data (default config, sample announcement, demo view)
- Cortex (content rotation + scheduling helper libraries)
- Admin Panel app (manage announcements, rotated views, settings)
- Kiosk Display app (full-screen display with layout modes, themes, auto-rotation)
- Translations (English + Finnish)

Source code: `aimeat/src/data/example-packages.ts`
Study its HTML apps for the auth pattern, memory API usage, and UI structure."

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 2: Add "Create with AI" button to packages-tab.js

**Files:**
- Modify: `aimeat/public/views/profile/packages-tab.js`

- [ ] **Step 1: Add imports**

The file already imports `escHtml` from `/js/utils.js`. Add `copyToClipboard` to that import:

Before:
```javascript
import { escHtml } from '/js/utils.js';
```

After:
```javascript
import { escHtml, copyToClipboard } from '/js/utils.js';
```

Also need access to the session's node URL. Check if `getNodeUrl` or similar is available. The extensions-tab uses a `getNodeUrl()` and `getSession()` from the SPA's auth context. The packages-tab receives `session` as a prop. The node URL can be derived from `window.location.origin` or `session.nodeUrl`.

- [ ] **Step 2: Add buildPackagePrompt function**

Add this function inside the component, before the return statement. It builds the prompt text with the session's node URL and owner name substituted. The function is similar to `buildCortexPrompt(sess)` in extensions-tab.js.

```javascript
function buildPackagePrompt(sess) {
  const url = (sess?.nodeUrl) || window.location.origin;
  const owner = sess?.owner || 'user';
  return `You are an AIMEAT Package Builder...`; // The full prompt text
}
```

The prompt text is the same content as in prompt-defaults.ts but with `${url}` and `${owner}` interpolated directly instead of `{{node_url}}` and `{{owner_name}}`.

**IMPORTANT:** Since this is a large string (~3000 words) and it duplicates the prompt-defaults.ts content, consider an alternative: fetch the prompt from the API (`GET /v1/prompts/package-builder`) at copy time, which auto-substitutes variables. This avoids duplication.

Recommended approach: fetch from API. The `buildCortexPrompt` pattern hardcodes the prompt in the frontend, but that was before the prompts API existed. The package-builder prompt should use the API since it's already seeded there.

```javascript
async function copyPackagePrompt() {
  try {
    const res = await fetch('/v1/prompts/package-builder', {
      headers: session?.jwt ? { 'Authorization': 'Bearer ' + session.jwt } : {}
    });
    const json = await res.json();
    if (json.ok && json.data?.content) {
      copyToClipboard(json.data.content);
      showToast(t('packages.promptCopied') || 'Prompt copied! Paste it into AI Chat.');
    } else {
      showToast('Failed to load prompt', true);
    }
  } catch (e) {
    showToast('Failed to load prompt', true);
  }
}
```

Wait -- the prompts API substitutes `{{node_url}}` etc. automatically. Let me verify this by checking the prompts route handler. From the earlier exploration, `GET /v1/cortex/:name/prompts/:promptName` does variable substitution. But the system prompts at `GET /v1/prompts/:name` may work differently.

Fallback approach if the API doesn't substitute: build the prompt client-side. But this means duplicating the text. The cleanest approach: use the API, and if it doesn't substitute, fix the route to do so.

For the plan, use the API approach. If the prompts route doesn't substitute variables, that's a separate fix (check `src/routes/prompts.ts`).

- [ ] **Step 3: Add the UI section**

In the render, between the `section-desc` and `pkg-nav` divs, add:

```javascript
<div class="pkg-hero-actions" style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.25rem">
  <button class="btn-primary" onClick=${copyPackagePrompt}>
    ${'\u{1F916}'} ${t('packages.createWithAi') || 'Create Package with AI'}
  </button>
</div>
```

The current structure (after our earlier changes) is:
```html
<div class="pkg-tab">
  <div class="section-title">${t('packages.title')}</div>
  <div class="section-desc">${t('packages.desc')}</div>
  <div class="pkg-nav">
```

Insert the button section between `section-desc` and `pkg-nav`.

---

## Task 3: Add i18n keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add English keys**

Inside the `"packages"` object, add:

```json
"createWithAi": "Create Package with AI",
"promptCopied": "Prompt copied! Paste it into Claude Code, VS Code Copilot, or any AI chat.",
"createWithAiDesc": "Copy this prompt and paste it into any AI. Describe what you want to build and the AI will create an installable package.",
```

- [ ] **Step 2: Add Finnish keys**

```json
"createWithAi": "Luo paketti tekoalylla",
"promptCopied": "Prompt kopioitu! Liita se Claude Codeen, VS Code Copilotiin tai mihin tahansa AI-chattiin.",
"createWithAiDesc": "Kopioi tama prompt ja liita se mihin tahansa tekoalyyn. Kuvaile mita haluat rakentaa ja tekoaly luo asennettavan paketin.",
```

---

## Task 4: Verify the prompts route handles package-builder

**Files:**
- Check: `aimeat/src/routes/prompts.ts`

- [ ] **Step 1: Verify GET /v1/prompts/:name substitutes variables**

Read `src/routes/prompts.ts` to confirm the `GET /v1/prompts/:name` endpoint substitutes `{{node_url}}`, `{{owner_name}}`, `{{node_id}}` in the prompt content before returning it. If it does, the client-side fetch approach works. If not, either:
a) Add substitution to the route (preferred), or
b) Fall back to building the prompt client-side

The cortex prompts route (`GET /v1/cortex/:name/prompts/:promptName`) does variable substitution. The system prompts route likely does too but needs verification.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck` and `pnpm lint`
Expected: 0 errors on both.

- [ ] **Step 3: Manual test**

1. Restart dev server (`pnpm dev`)
2. Open Profile > Packages
3. Verify "Create Package with AI" button appears above the nav tabs
4. Click the button -- verify prompt is copied to clipboard
5. Paste into a text editor -- verify it has the node URL and owner name substituted, not `{{node_url}}`
6. Paste into Claude chat with "I want a simple todo list" -- verify the AI generates a valid package structure

---

## Scope excluded

- The prompt text quality will be iterated on after initial implementation based on testing with real AIs
- No Playwright automated tests for the prompt copy -- manual verification is sufficient
- No changes to the prompts route if it already substitutes variables
