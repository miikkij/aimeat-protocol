# Cortex Extensions v2 — UI Overhaul + Real Extensions

## Goal

Transform the bare Extensions tab into a rich, user-friendly experience with:
1. A welcoming hero section that explains what extensions do for the user
2. A scaffolding prompt that lets users create extensions via AI Chat
3. Two real, functional extensions (Charts + Drawing Canvas) as built-in examples
4. Visibility (private/public) support in the backend

## Design Decisions

- **"+ Lisää"** not "+ Asenna" — adding an extension is like putting a dish on a shelf, not installing software
- **User-facing language** — no technical jargon (no "schema", "ontology", "CSM vs MSM"). Talk about what the user gets done
- **Scaffolding prompt can be large** — this is PoC, no premature optimization. The prompt can be hundreds of lines if that makes the AI output better
- **Real extensions** — the example cards are actual installable extensions, not mockups
- **Visibility** — private by default, publish flow lives in app-catalog (future iteration)

---

## 1. Extensions Tab Redesign

### Empty State (no extensions installed)

```
┌─────────────────────────────────────────────────────┐
│  🧩 Cortex-laajennukset                             │
│                                                      │
│  Laajennuksilla saat enemmän aikaiseksi vähemmällä.  │
│  AI Chat pystyy suoriutumaan isommista sovelluksista │
│  kun annat sille valmiita rakennuspalikoita.          │
│  Voit käyttää samaa laajennetta useassa              │
│  sovelluksessasi — teet luomisen helpommaksi          │
│  itsellesi ja tekoälykaveerillesi.                   │
│                                                      │
│  [🤖 Luo AI:lla]  [+ Lisää]                        │
├─────────────────────────────────────────────────────┤
│  Valmiita laajennuksia:                              │
│  ┌──────────────┐ ┌──────────────┐                  │
│  │📊 Charts     │ │🎨 Canvas     │                  │
│  │              │ │              │                  │
│  │Nätit kaaviot │ │Piirtopinta   │                  │
│  │datallesi —   │ │jolla piirrät │                  │
│  │pylväs, viiva,│ │ja tallennat  │                  │
│  │piirakka ja   │ │suoraan       │                  │
│  │muut. Touch + │ │storageen.    │                  │
│  │hiiri.        │ │Undo, export, │                  │
│  │              │ │kynä & muodot.│                  │
│  │ [Lisää tämä] │ │ [Lisää tämä] │                  │
│  └──────────────┘ └──────────────┘                  │
└─────────────────────────────────────────────────────┘
```

### With Extensions Installed

```
┌─────────────────────────────────────────────────────┐
│  🧩 Cortex-laajennukset                             │
│  (short desc) [🤖 Luo AI:lla]  [+ Lisää]           │
├─────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │ ext 1   │ │ ext 2   │ │ ext 3   │              │
│  │ 🔒/🌐   │ │ 🔒/🌐   │ │ 🔒/🌐   │              │
│  └─────────┘ └─────────┘ └─────────┘              │
│                                                      │
│  Valmiita laajennuksia:                              │
│  (charts + canvas cards, only if not already added) │
└─────────────────────────────────────────────────────┘
```

### Extension Card Changes

Each card shows a visibility badge:
- 🔒 Private (default)
- 🌐 Public

Detail view gets a "Julkaise" / "Tee yksityiseksi" toggle button.

---

## 2. Scaffolding Prompt

The "🤖 Luo AI:lla" button copies a comprehensive prompt to clipboard. The prompt:

- Explains what Cortex extensions are (for the AI)
- Shows the full YAML manifest structure with all 7 component types
- Includes complete examples for each component type
- Provides the user's node URL (auto-filled from `NODE_URL`)
- Instructs the AI to ask what the user wants to build, giving short examples
- Instructs the AI to produce a complete YAML manifest + JS library if needed
- Tells the AI how the user can add the result (paste YAML + paste JS in profile → Extensions → + Lisää)

The prompt is NOT shown to the user — copied directly to clipboard with a toast "Prompt kopioitu! Liitä se AI Chatiin."

Size: as large as needed (PoC, no premature optimization). Can be hundreds of lines.

---

## 3. aimeat-charts Extension

### Manifest: `aimeat-charts.yaml`

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: aimeat-charts
  namespace: aimeat
  description: "Beautiful interactive charts for your apps. Supports bar, line, pie, doughnut, radar, scatter, and bubble charts with touch, hover tooltips, and responsive layout."
  author: AIMEAT
  tags: [charts, visualization, data, ui]
  labels:
    domain: visualization
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: schema (chart:* key pattern, validates chart data structure)
    - type: prompt (chart-assistant — AI knows how to produce chart data)
    - type: lib (aimeat-charts.js — Chart.js wrapper)
    - type: seed-data (2-3 example charts)
```

### Library: `aimeat-charts.js`

Chart.js wrapper providing:
- `AIMEAT.charts.ChartPanel({elementId, chartKey, nodeUrl, token?})` — reads chart data from storage, renders
- `AIMEAT.charts.ChartBuilder({elementId, data, type, options})` — renders from inline data
- `AIMEAT.charts.TYPES` — list of supported chart types
- Supported types: bar, line, pie, doughnut, radar, scatter, bubble
- AIMEAT color palette (matches the UI theme)
- Auto-responsive (ResizeObserver)
- Touch tooltips work on mobile
- Requires Chart.js loaded via CDN: `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`

### API Surface (for AI Chat context)

```
AIMEAT.charts.ChartPanel({elementId, chartKey, nodeUrl, token?})
  - Reads chart:* key from AIMEAT storage, renders Chart.js chart
  - Auto-refreshes on data change

AIMEAT.charts.ChartBuilder({elementId, data, type, options?})
  - data: {labels:[], datasets:[{label,data:[],backgroundColor?,borderColor?}]}
  - type: 'bar'|'line'|'pie'|'doughnut'|'radar'|'scatter'|'bubble'
  - options: Chart.js options object (optional)

AIMEAT.charts.TYPES = ['bar','line','pie','doughnut','radar','scatter','bubble']

Requires: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script> before this lib
```

### Schema: `chart:*`

```json
{
  "type": "object",
  "required": ["type", "data"],
  "properties": {
    "type": {"type": "string", "enum": ["bar","line","pie","doughnut","radar","scatter","bubble"]},
    "title": {"type": "string"},
    "data": {
      "type": "object",
      "required": ["labels", "datasets"],
      "properties": {
        "labels": {"type": "array", "items": {"type": "string"}},
        "datasets": {"type": "array", "items": {
          "type": "object",
          "required": ["label", "data"],
          "properties": {
            "label": {"type": "string"},
            "data": {"type": "array", "items": {"type": "number"}}
          }
        }}
      }
    },
    "options": {"type": "object"}
  }
}
```

### Seed Data

2-3 example charts:
- `chart:sales-2024` — bar chart with quarterly sales data
- `chart:temperature` — line chart with monthly temperatures
- `chart:categories` — doughnut chart with category distribution

---

## 4. aimeat-canvas Extension

### Manifest: `aimeat-canvas.yaml`

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: aimeat-canvas
  namespace: aimeat
  description: "A full-featured drawing canvas for your apps. Draw with pen, shapes, and text. Auto-saves to AIMEAT storage. Touch, mouse, and mobile support with undo/redo and PNG/SVG export."
  author: AIMEAT
  tags: [drawing, canvas, art, ui]
  labels:
    domain: creative
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: schema (drawing:* key pattern, validates drawing data)
    - type: prompt (canvas-assistant — AI knows how to create apps with drawing)
    - type: lib (aimeat-canvas.js — full drawing canvas)
    - type: seed-data (1 example drawing)
```

### Library: `aimeat-canvas.js`

Full drawing canvas providing:
- `AIMEAT.canvas.DrawingCanvas({elementId, storageKey, nodeUrl, token?, options?})`

**Tools:** pen, line, rectangle, circle, eraser, text
**Color picker** + line width + opacity
**Undo/redo:** Ctrl+Z / Ctrl+Y, three-finger touch
**Touch:** draw with finger, pinch zoom, two-finger pan
**Mouse:** draw, scroll zoom, middle-button pan
**Mobile:** toolbar at bottom, smaller, full-screen friendly
**Auto-save:** debounced save to AIMEAT storage at the specified key
**Export:** PNG and SVG buttons

**No external dependencies** — pure Canvas API.

### API Surface

```
AIMEAT.canvas.DrawingCanvas({elementId, storageKey, nodeUrl, token?, options?})
  - elementId: DOM element to mount canvas in
  - storageKey: AIMEAT memory key (e.g. 'drawing:sketch-1')
  - nodeUrl: AIMEAT node URL for auto-save
  - token: optional auth token
  - options: {
      width: 800,        // canvas width (default: container width)
      height: 600,       // canvas height (default: 600)
      tools: ['pen','line','rect','circle','eraser','text'],  // which tools to show
      backgroundColor: '#ffffff',  // canvas background
      autoSave: true,     // auto-save to storage (default: true)
      autoSaveDelay: 2000 // debounce ms (default: 2000)
    }

Returns: {
  canvas: HTMLCanvasElement,
  export(format): string,     // 'png' or 'svg' → data URL
  clear(): void,
  undo(): void,
  redo(): void,
  setTool(name): void,
  setColor(hex): void,
  setLineWidth(px): void,
  loadFromStorage(): Promise<void>,
  saveToStorage(): Promise<void>
}
```

### Schema: `drawing:*`

```json
{
  "type": "object",
  "required": ["strokes", "canvasSize"],
  "properties": {
    "title": {"type": "string"},
    "canvasSize": {
      "type": "object",
      "required": ["width", "height"],
      "properties": {
        "width": {"type": "number"},
        "height": {"type": "number"}
      }
    },
    "backgroundColor": {"type": "string"},
    "strokes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["tool", "points"],
        "properties": {
          "tool": {"type": "string"},
          "color": {"type": "string"},
          "lineWidth": {"type": "number"},
          "opacity": {"type": "number"},
          "points": {"type": "array"},
          "text": {"type": "string"},
          "fontSize": {"type": "number"}
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "createdAt": {"type": "string"},
        "updatedAt": {"type": "string"}
      }
    }
  }
}
```

---

## 5. Visibility Backend Support

### Storage Changes

`CortexExtensionRecord` gets:
```typescript
visibility: 'private' | 'public';  // default: 'private'
```

### Manifest Parser Changes

Accept optional `metadata.visibility: public|private` in YAML.

### API Changes

- `POST /v1/cortex` — stores visibility from manifest (default: private)
- `POST /v1/cortex/:name/visibility` — toggle visibility `{ visibility: 'public'|'private' }`
- `GET /v1/cortex` — adds `?visibility=public` filter to list public extensions from all users
- `GET /v1/cortex/:name` — returns visibility in response

### UI Changes

- Card: visibility badge (🔒 Private / 🌐 Public)
- Detail view: "Julkaise" / "Tee yksityiseksi" toggle button

---

## 6. i18n Changes

Update translation keys:
- `profile.extensions.install` → `profile.extensions.add` ("+ Lisää" / "+ Lisää")
- Add: `profile.extensions.createWithAi` ("🤖 Luo AI:lla")
- Add: `profile.extensions.promptCopied` ("Prompt kopioitu! Liitä se AI Chatiin.")
- Add: `profile.extensions.readyExtensions` ("Valmiita laajennuksia:")
- Add: `profile.extensions.addThis` ("Lisää tämä")
- Add: `profile.extensions.visibility.private` / `.public`
- Add: `profile.extensions.publish` / `.unpublish`
- Add: `profile.extensions.installModal.title` → rename to "Lisää Cortex-laajennus"

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `aimeat/public/views/profile.js` | Redesign renderExtensions() |
| `aimeat/public/css/views/profile.css` | Add hero, example card styles |
| `aimeat/locales/en.json` | Update extension keys |
| `aimeat/locales/fi.json` | Update extension keys |
| `aimeat/src/storage/interface.ts` | Add visibility to CortexExtensionRecord |
| `aimeat/src/storage/memory.ts` | Add visibility support |
| `aimeat/src/storage/mongodb.ts` | Add visibility support |
| `aimeat/src/services/cortex-manifest.ts` | Parse visibility from manifest |
| `aimeat/src/routes/cortex.ts` | Add visibility endpoint + filter |
| `test/fixtures/cortex/aimeat-charts.yaml` | New: Charts manifest |
| `test/fixtures/cortex/aimeat-charts.js` | New: Charts library |
| `test/fixtures/cortex/aimeat-canvas.yaml` | New: Canvas manifest |
| `test/fixtures/cortex/aimeat-canvas.js` | New: Canvas library |
| `aimeat/src/routes/cortex.ts` | Serve bundled extensions |

---

## Out of Scope (future)

- App catalog publish flow (Cortex → public app catalog listing)
- Extension marketplace / discovery
- Extension versioning / updates
- Extension dependency management
