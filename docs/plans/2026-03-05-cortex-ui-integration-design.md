# Cortex-Core UI Integration Design

**Date:** 2026-03-05
**Status:** Approved
**Depends on:** Cortex-Core PoC backend (merged to main)

---

## 1. Purpose

Add UI for managing Cortex extensions so the PoC can be tested by real users. Two integration points:

1. **Profile.html** — New "Extensions" tab for lifecycle management (install, activate, deactivate, uninstall, inspect)
2. **App-catalog.html** — "Active Extensions" bar showing what libs/schemas/prompts are available for app building

---

## 2. Profile.html — Extensions Tab

### Tab Button

New `.tab` button after the Apps tab:
```html
<button class="tab" data-tab="extensions" data-t="profile.tabs.extensions">Extensions</button>
```

### Panel Structure

Panel `id="panel-extensions"` with:
- Header row: title + "+ Install Extension" button
- Grid of extension cards (`.ext-card`)
- Detail view (hidden by default, shown on card click)
- Install modal (hidden by default)

### Extension Card (`.ext-card`)

Each card shows:
- Extension name (`@namespace/shortName`)
- Version
- Description (truncated)
- Component type tags: `schema`, `prompt`, `action`, `board`, `ontology`, `seed`, `lib`
- Status indicator: green dot "Active" / grey dot "Inactive"
- Action buttons: Activate/Deactivate toggle + Uninstall

Card click opens detail view.

### Detail View

Replaces the card grid when viewing a single extension:
- "Back" button to return to grid
- **Description prominently at top** — what the extension is and what it's for
- Metadata row: author, license, status, tags
- "What's included" section listing all components with icons
- Expandable sections per component type:
  - **Prompt**: shows content with [Copy prompt] button
  - **Library**: shows exports, API surface, script tag URL with [Copy API] and [Copy URL] buttons
  - **Schema**: shows key pattern and mode
  - **Ontology**: shows concept names and labels
  - **Board**: shows title and visibility
  - **Seed data**: shows entry count
- Deactivate/Uninstall buttons at bottom

### Install Modal

Triggered by "+ Install Extension" button. Supports two input modes for both manifest and libs:

**Manifest input:**
- Radio toggle: "Upload file" / "Paste YAML"
- Upload: `<input type="file" accept=".yaml,.yml">`
- Paste: `<textarea>` for YAML content

**Library input (optional):**
- Radio toggle: "Upload files" / "Paste code"
- Upload: `<input type="file" accept=".js" multiple>`
- Paste: filename text input (required) + `<textarea>` for JS code + "+ Add another lib" button for multiple libs
- Can add multiple libs in paste mode

**Actions:** Cancel / Install

**On install:**
1. Read manifest (from file or textarea)
2. Read libs (from files or paste, base64-encode content)
3. POST to `/v1/cortex` with `{ manifest, libs }`
4. Show success/error message
5. Refresh extension list

### API Calls

```javascript
// List extensions
session.fetch('/v1/cortex')

// Install
session.fetch('/v1/cortex', {
  method: 'POST',
  body: JSON.stringify({ manifest: yamlString, libs: { 'recipe-ui.js': base64Content } })
})

// Activate
session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/activate', { method: 'POST' })

// Deactivate
session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/deactivate', { method: 'POST' })

// Uninstall
session.fetch('/v1/cortex/' + encodeURIComponent(name), { method: 'DELETE' })

// Get prompts
session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/prompts')

// Get prompt content
session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/prompts/' + promptName)

// Get ontology
session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/ontology')
```

---

## 3. App-catalog.html — Active Extensions Bar

### Position

New collapsible section at the top of the app catalog, above the search bar and app grid.

### "Active Extensions" Bar

Horizontal scrollable row of compact extension cards showing:
- Extension name
- Lib count + schema count
- Click to expand popup

### Extension Popup (on click)

Compact overlay showing what's available for apps:
- **Lib script tag** — ready to copy `<script src="/v1/cortex/...">`
- **Schema info** — which key patterns are validated
- **Prompt** — first few lines with [Copy] button
- **API surface** — compact function signatures with [Copy] button

### Data Source

```javascript
// Fetch active extensions (public endpoint, no auth needed for listing)
fetch(aimeatUrl + '/v1/cortex?status=active')
  .then(r => r.json())
  .then(data => renderExtensionsBar(data.data.extensions))
```

Note: `/v1/cortex` list endpoint currently requires auth. For app-catalog integration, either:
- Use anonymous auth token (same pattern as app publishing)
- Or make the list endpoint public for `?status=active` queries

Decision: Use anonymous auth, same pattern as existing app-catalog AIMEAT import.

---

## 4. Styling

Follow existing glass-morphism design from profile.html:
- Cards: `background: rgba(255,255,255,0.06)`, `border: 1px solid rgba(255,255,255,0.1)`, `border-radius: 12px`
- Status colors: active = `#4ade80` (green), inactive = `#9ca3af` (grey)
- Component tags: small pills with `background: rgba(255,255,255,0.1)`, `border-radius: 6px`, `padding: 2px 8px`
- Modals: existing overlay pattern from profile.html
- Buttons: match existing `.btn-primary`, `.btn-danger` patterns

---

## 5. i18n Translation Keys

Add to `locales/en.json` and `locales/fi.json`:

```json
{
  "profile": {
    "tabs": {
      "extensions": "Extensions"
    },
    "extensions": {
      "title": "Cortex Extensions",
      "install": "Install Extension",
      "installModal": {
        "title": "Install Cortex Extension",
        "manifestLabel": "Manifest",
        "uploadFile": "Upload file",
        "pasteYaml": "Paste YAML",
        "libsLabel": "Library files (optional)",
        "uploadFiles": "Upload files",
        "pasteCode": "Paste code",
        "filename": "Filename",
        "addLib": "+ Add another lib",
        "cancel": "Cancel",
        "install": "Install"
      },
      "status": {
        "active": "Active",
        "inactive": "Inactive"
      },
      "actions": {
        "activate": "Activate",
        "deactivate": "Deactivate",
        "uninstall": "Uninstall"
      },
      "detail": {
        "back": "Back",
        "whatsIncluded": "What's included",
        "copyPrompt": "Copy prompt",
        "copyApi": "Copy API",
        "copyUrl": "Copy URL",
        "exports": "Exports",
        "apiSurface": "API Surface"
      },
      "components": {
        "schema": "Schema",
        "prompt": "Prompt",
        "action": "Action",
        "board": "Board",
        "ontology": "Ontology",
        "seed": "Seed data",
        "lib": "Library"
      },
      "empty": "No extensions installed yet.",
      "installSuccess": "Extension installed successfully!",
      "installError": "Installation failed",
      "activateSuccess": "Extension activated",
      "deactivateSuccess": "Extension deactivated",
      "uninstallConfirm": "Are you sure you want to uninstall this extension? Seed data will be removed.",
      "uninstallSuccess": "Extension uninstalled"
    }
  }
}
```

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `aimeat/public/profile.html` | Add Extensions tab button, panel HTML, CSS styles, JavaScript functions |
| `aimeat/src/static/app-catalog.html` | Add Active Extensions bar, popup, fetch logic |
| `aimeat/locales/en.json` | Add extension i18n keys |
| `aimeat/locales/fi.json` | Add extension i18n keys (Finnish) |

No backend changes needed — all endpoints exist from the PoC.

---

*Design approved: 2026-03-05*
