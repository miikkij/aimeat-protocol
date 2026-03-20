# Generator Design Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional design intelligence to the generator pipeline — curated color palettes, typography pairings, style guidance, and anti-patterns matched by product type — so LLMs produce professional, domain-appropriate UIs instead of generic blue pages.

**Architecture:** The design intelligence is an optional step in the prompt-driven workflow. The interview prompt asks the user if they want it. If yes, the interviewSpec gains a `designSystem` object. The blueprint prompt sees it and includes a `design-1` component. A new design component prompt is built with matched CSV data (colors, fonts, style variables). The completed design output is injected into app prompts, replacing the generic CSS design system section.

**Tech Stack:** Vanilla JS (ESM), CSV data converted to static JS objects, existing generator prompt/validate infrastructure.

**Source data:** CSV files from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/main/src/ui-ux-pro-max/data — curated design datasets with 161 color palettes, 57 font pairings, ~50 AIMEAT-compatible styles, 161 product type mappings, and 25 chart type recommendations.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `aimeat/public/js/services/design-data.js` | **Create** | Static JS module with curated CSV data as objects + `matchDesignSystem()` function |
| `aimeat/public/js/services/generator-prompts.js` | **Modify** | Add design questions to interview prompt, add `design` component template, modify app template to inject completed design system |
| `aimeat/public/js/services/generator-validate.js` | **Modify** | Add `design` to allowed blueprint types, add `design` validator |
| `aimeat/src/services/generator-validate.ts` | **Modify** | Add `design` to `ComponentType`, add `validateDesign()`, add to `validateComponent()` switch |
| `aimeat/src/routes/generator.ts` | **Modify** | Add `design` to registration switch (no-catalogue, like memory/translation) |
| `aimeat/public/spa.html` | **Modify** | Add importmap entry for `/js/services/design-data.js` |
| `aimeat/public/views/profile/generator-tab.js` | **Modify** | Import `design-data.js` in `buildComponentPrompt` flow (only if needed — check if prompts.js handles it) |

---

## Context: How the Generator Prompt Chain Works

AIMEAT uses a **prompt-driven workflow**. The app generates prompts, the user copies them to their AI chat (Claude, ChatGPT, Gemini — any), and brings the results back. Previous results feed into subsequent prompts.

The generator pipeline steps:
1. **Interview prompt** → user copies to AI chat → AI interviews user → user pastes JSON spec back
2. **Blueprint prompt** (built with interviewSpec context) → user copies → AI produces component list JSON → user pastes back
3. **Component prompts** (one per blueprint component, built with blueprint + completed components context) → user copies each → AI produces CSM/extension/app/etc → user pastes back

All "intelligence" lives in the prompt text. The app's job is composing prompts and threading prior results into them.

---

## Context: What Data We're Using

### colors.csv (161 palettes) — 100% compatible
Pure hex values mapped by product type. Columns: Product Type, Primary, On Primary, Secondary, On Secondary, Accent, On Accent, Background, Foreground, Card, Card Foreground, Muted, Muted Foreground, Border, Destructive, On Destructive, Ring, Notes.

Maps directly to CSS custom properties in the app prompt's `:root` block.

### typography.csv (57 pairings) — 100% compatible
Google Fonts with standard `@import` CSS. Columns: Font Pairing Name, Category, Heading Font, Body Font, Mood/Style Keywords, Best For, CSS Import, Notes.

No framework dependencies. Standard `@import url(...)` + `font-family` declarations.

### products.csv (161 types) — 100% compatible
Product type → style recommendation + color palette focus + layout pattern. Columns: Product Type, Keywords, Primary Style Recommendation, Secondary Styles, Landing Page Pattern, Dashboard Style, Color Palette Focus, Key Considerations.

No code, no framework references. Pure design guidance.

### styles.csv (~50 compatible out of 67) — filtered
Style definitions with CSS variables, effects, checklists. Columns used: Style Category, Keywords, Primary Colors, Secondary Colors, Effects & Animation, Best For, Do Not Use For, AI Prompt Keywords, Design System Variables, Implementation Checklist.

**Excluded styles** (require WebGL/GSAP/React Native/heavy libs):
3D & Hyperrealism, Liquid Glass, Motion-Driven, Micro-interactions, Kinetic Typography, Parallax Storytelling, HUD/Sci-Fi FUI, Interactive Cursor, Voice-First Multimodal, 3D Product Preview, Gradient Mesh/Aurora Evolved, Bauhaus (Mobile), Minimalist Monochrome (Mobile), Modern Dark Cinema (Mobile), Skeuomorphism.

**Included styles** (~50): Minimalism, Neumorphism, Glassmorphism, Brutalism, Flat Design, Dark Mode OLED, Claymorphism, Soft UI Evolution, Vibrant & Block, Bento Box Grid, Neubrutalism, E-Ink/Paper, Swiss Modernism, Organic Biophilic, Memphis Design, Accessible & Ethical, Retro-Futurism, Aurora UI, Cyberpunk UI, Vaporwave, Y2K Aesthetic, Dimensional Layering, Pixel Art, all Dashboard styles (Chart.js compatible), etc.

### charts.csv (25 types) — compatible via Chart.js
Chart type recommendations by data type. AIMEAT already supports Chart.js via CDN. Columns: Data Type, Best Chart Type, When to Use, When NOT to Use, Color Guidance, Accessibility Notes.

### ui-reasoning.csv (161 types) — use text only
Decision rules and anti-patterns per product type. Columns used: UI_Category, Recommended_Pattern, Decision_Rules, Anti_Patterns, Severity. Code example columns skipped (contain Tailwind).

---

## Task 1: Create design-data.js — Static Design Dataset Module

**Files:**
- Create: `aimeat/public/js/services/design-data.js`
- Modify: `aimeat/public/spa.html` (add importmap entry)

This is the data foundation. All CSV data converted to JS objects with a matching function.

**NOTE:** Steps 2-7 each convert a CSV dataset (100-161 rows) to JS objects. Use WebFetch to retrieve the raw CSV and convert programmatically — do NOT hand-transcribe individual entries.

- [ ] **Step 1: Create the data file with file header**

Create `aimeat/public/js/services/design-data.js` with:
- Standard file header (`@file`, `@description`, `@structure`, `@version-history`)
- Description: "Curated design intelligence data for the generator pipeline. Contains color palettes, typography pairings, style definitions, and product type mappings extracted from UI/UX Pro Max datasets, filtered for AIMEAT compatibility (vanilla HTML/CSS/JS, no build step)."

- [ ] **Step 2: Add PRODUCTS data**

Export `const PRODUCTS` — array of objects from products.csv (161 entries). Each object:
```javascript
{
  id: 1,
  type: 'SaaS (General)',
  keywords: ['app', 'b2b', 'cloud', 'general', 'saas', 'software', 'subscription'],
  primaryStyle: 'Glassmorphism + Flat Design',
  secondaryStyles: ['Soft UI Evolution', 'Minimalism'],
  landingPattern: 'Hero + Features + CTA',
  dashboardStyle: 'Data-Dense + Real-Time Monitoring',
  colorFocus: 'Trust blue + accent contrast',
  considerations: 'Balance modern feel with clarity. Focus on CTAs.'
}
```

Fetch the complete CSV from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/products.csv` and convert all 161 rows.

- [ ] **Step 3: Add COLORS data**

Export `const COLORS` — array of objects from colors.csv (161 entries). Each object:
```javascript
{
  id: 1,
  productType: 'SaaS (General)',
  primary: '#2563EB', onPrimary: '#FFFFFF',
  secondary: '#3B82F6', onSecondary: '#FFFFFF',
  accent: '#EA580C', onAccent: '#FFFFFF',
  background: '#F8FAFC', foreground: '#1E293B',
  card: '#FFFFFF', cardForeground: '#1E293B',
  muted: '#E9EFF8', mutedForeground: '#64748B',
  border: '#E2E8F0',
  destructive: '#DC2626', onDestructive: '#FFFFFF',
  ring: '#2563EB',
  notes: 'Trust blue + orange CTA contrast'
}
```

Fetch the complete CSV from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/colors.csv` and convert all 161 rows.

- [ ] **Step 4: Add TYPOGRAPHY data**

Export `const TYPOGRAPHY` — array of objects from typography.csv (57 entries). Each object:
```javascript
{
  id: 1,
  name: 'Classic Elegant',
  category: 'Serif + Sans',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
  mood: ['elegant', 'luxury', 'sophisticated', 'timeless', 'premium'],
  bestFor: 'Luxury brands, fashion, spa, beauty, editorial',
  cssImport: "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap');",
  notes: 'High contrast between elegant heading and clean body.'
}
```

Fetch the complete CSV from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/typography.csv` and convert all 57 rows.

- [ ] **Step 5: Add STYLES data (filtered)**

Export `const STYLES` — array of objects from styles.csv, **excluding** these styles that require heavy external libraries:
- 3D & Hyperrealism, Liquid Glass, Motion-Driven, Micro-interactions, Kinetic Typography, Parallax Storytelling, HUD/Sci-Fi FUI, Interactive Cursor, Voice-First Multimodal, 3D Product Preview, Gradient Mesh/Aurora Evolved, Bauhaus (Mobile), Minimalist Monochrome (Mobile), Modern Dark Cinema (Mobile), Skeuomorphism

Each object:
```javascript
{
  id: 1,
  name: 'Minimalism & Swiss Style',
  keywords: ['clean', 'simple', 'spacious', 'functional', 'white space'],
  primaryColors: 'Monochromatic, Black #000000, White #FFFFFF',
  secondaryColors: 'Neutral (Beige #F5F1E8, Grey #808080)',
  effects: 'Subtle hover (200-250ms), smooth transitions, sharp shadows if any',
  bestFor: 'Enterprise apps, dashboards, documentation sites',
  doNotUseFor: 'Creative portfolios, entertainment, playful brands',
  aiPromptKeywords: 'Design a minimalist landing page. Use: white space, geometric layouts...',
  designVars: '--spacing: 2rem, --border-radius: 0px, --font-weight: 400-700, --shadow: none',
  checklist: '☐ Grid-based layout, ☐ Typography hierarchy clear, ☐ WCAG AAA contrast verified'
}
```

Fetch the complete CSV from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/styles.csv` and convert, filtering out the excluded styles.

- [ ] **Step 6: Add UI_REASONING data**

Export `const UI_REASONING` — array of objects from ui-reasoning.csv (161 entries). Each object:
```javascript
{
  id: 1,
  category: 'SaaS (General)',
  recommendedPattern: 'Hero + Features + CTA',
  stylePriority: 'Glassmorphism + Flat Design',
  decisionRules: 'if_ux_focused: prioritize-minimalism, if_data_heavy: add-glassmorphism',
  antiPatterns: 'Excessive animation + Dark mode by default',
  severity: 'HIGH'
}
```

Fetch from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/ui-reasoning.csv` and convert all rows. Skip "Code Example Good" and "Code Example Bad" columns (contain Tailwind-specific code).

- [ ] **Step 7: Add CHARTS data**

Export `const CHARTS` — array of objects from charts.csv (25 entries). Each object:
```javascript
{
  id: 1,
  dataType: 'Trend Over Time',
  keywords: ['trend', 'time-series', 'line', 'growth'],
  bestChart: 'Line Chart',
  secondaryOptions: ['Area Chart', 'Smooth Area'],
  whenToUse: 'Data has a time axis; user needs to observe rise/fall trends',
  whenNotToUse: 'Fewer than 4 data points; more than 6 series',
  colorGuidance: 'Primary: #0080FF. Multiple series: distinct colors + line styles',
  accessibilityNotes: 'Differentiate series by line style not color alone',
  library: 'Chart.js'  // normalized — AIMEAT uses Chart.js
}
```

Fetch from `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/src/ui-ux-pro-max/data/charts.csv`.

- [ ] **Step 8: Add matchDesignSystem() function**

```javascript
/**
 * Match a product type to its design system components.
 * @param {string} productType - Product type from interview (e.g., 'saas', 'healthcare')
 * @param {string|null} styleOverride - User's explicit style preference (optional)
 * @param {string|null} moodKeywords - Mood keywords from interview (optional)
 * @returns {{ product, colors, typography, style, reasoning, charts }}
 */
export function matchDesignSystem(productType, styleOverride = null, moodKeywords = null) {
  // 1. Find product match (fuzzy keyword search on productType string)
  const product = findProduct(productType);

  // 2. Get matching color palette (same product type row in COLORS)
  const colors = COLORS.find(c => c.productType === product?.type) || COLORS[0];

  // 3. Get matching style (from product recommendation or override)
  const styleName = styleOverride || product?.primaryStyle?.split('+')[0]?.trim();
  const style = findStyle(styleName);

  // 4. Match typography by mood
  const typography = findTypography(moodKeywords || product?.colorFocus);

  // 5. Get reasoning/anti-patterns
  const reasoning = UI_REASONING.find(r => r.category === product?.type);

  // 6. Get relevant charts (if views include dashboard/chart types)
  const charts = CHARTS; // all available — prompt selects relevant ones

  return { product, colors, typography, style, reasoning, charts };
}
```

Include helper functions `findProduct(query)`, `findStyle(query)`, `findTypography(mood)` that do keyword-based matching.

- [ ] **Step 9: Add importmap entry in spa.html**

Add to the importmap in `public/spa.html`:
```json
"/js/services/design-data.js": "/js/services/design-data.js"
```

- [ ] **Step 10: Commit**

```bash
git add aimeat/public/js/services/design-data.js aimeat/public/spa.html
git commit -m "feat(generator): add design intelligence data module with curated palettes, typography, and styles"
```

---

## Task 2: Modify Interview Prompt — Add Design System Question

**Files:**
- Modify: `aimeat/public/js/services/generator-prompts.js` (lines 387-617, the `buildInterviewPrompt` function)

The interview prompt must ask the user if they want design intelligence, and if yes, gather the parameters needed for matching.

- [ ] **Step 1: Add design system question to the interview prompt**

In `buildInterviewPrompt()`, add a new section between the existing "e) STYLE & LOOK" section (line ~500) and "f) CONSTRAINTS & PREFERENCES" section (line ~507). Modify section e) to include the design system opt-in:

```
   e) STYLE & LOOK — How should it feel? (2-3 questions)

      DESIGN INTELLIGENCE (ask this FIRST in this section):
      Explain to the user: "AIMEAT has a built-in Design Intelligence system with
      161 curated color palettes, 57 font pairings, and 50+ UI styles matched
      to your project type. It picks the right colors, fonts, and design patterns
      for your domain automatically. Would you like to use it? It adds one extra
      step but produces more polished results. You can also add it later."

      If YES:
      - Ask: "What type of product is this closest to?" and suggest 3-5 options
        based on what you've learned (e.g., "SaaS dashboard", "Healthcare app",
        "E-commerce", "Educational platform", "Creative portfolio"). Let them
        pick or describe their own.
      - Ask about style preference ONLY if the user seems opinionated about design.
        Otherwise say: "I'll pick the recommended style for your product type."
      - Ask if they have color preferences or want the automatic palette.

      If NO or SKIP:
      - Note "designSystem: null" and move on. Mention they can add it later.

      Then ask the remaining style questions as before:
      - Mood: clean/minimal, playful, data-dense/professional?
      - Layout preference: tabs, single page, split panels?
      - Any apps or websites whose look they admire?
```

- [ ] **Step 2: Add designSystem field to the JSON output spec**

In the interview prompt's JSON template (around line 594), add `designSystem` field after `style`:

```json
  "style": {
    "mood": "...",
    "colorPalette": "...",
    "typography": "...",
    "layout": "...",
    "animations": "...",
    "displayContext": "...",
    "references": "..."
  },
  "designSystem": {
    "enabled": true,
    "productType": "SaaS (General)",
    "styleOverride": null,
    "colorPreference": null,
    "notes": "User wants automatic palette for SaaS dashboard"
  },
```

Or if the user declined:
```json
  "designSystem": null,
```

- [ ] **Step 3: Update version history**

Add version entry to the file header.

- [ ] **Step 4: Commit**

```bash
git add aimeat/public/js/services/generator-prompts.js
git commit -m "feat(generator): add design intelligence opt-in to interview prompt"
```

---

## Task 3: Modify Blueprint Prompt — Recognize Design Components

**Files:**
- Modify: `aimeat/public/js/services/generator-prompts.js` (lines 172-378, the `buildBlueprintPrompt` function)

The blueprint prompt must know about the `design` component type and include it when `interviewSpec.designSystem.enabled` is true.

- [ ] **Step 1: Add design component type to blueprint prompt**

In `buildBlueprintPrompt()`, after the existing component types list (around line 273), add:

```
- Component types: csm, msm, extension, app, memory, translation, cortex, design
```

And add design-specific rules:

```
- DESIGN: If the interview spec has "designSystem.enabled": true, include EXACTLY ONE design component:
  { "id": "design-1", "type": "design", "label": "Design System", "produces": ["design:system"], "consumes": [] }
  Place it in its own phase BEFORE the "ui" phase:
  { "id": "design", "label": "Design System", "componentIds": ["design-1"] }
  App components MUST consume "design:system": { ..., "consumes": ["api:getData", "design:system"] }
  If "designSystem" is null or missing, do NOT include a design component.
```

- [ ] **Step 2: Add designSystem context injection**

In `buildBlueprintPrompt()`, where `specContext` is built (line 173-180), add the designSystem info so the LLM knows it should include the design component:

```javascript
  // Add design system indication if enabled
  let designNote = '';
  if (interviewSpec?.designSystem?.enabled) {
    designNote = `\n## Design Intelligence: ENABLED\n\nThe user opted into Design Intelligence. You MUST include a "design-1" component (type: "design") in a "Design System" phase before the UI phase. Apps consume "design:system".\n`;
  }
```

And include `${designNote}` in the return template.

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/js/services/generator-prompts.js
git commit -m "feat(generator): add design component type to blueprint prompt"
```

---

## Task 4: Add Design Component Prompt Template

**Files:**
- Modify: `aimeat/public/js/services/generator-prompts.js` (in `COMPONENT_TEMPLATES` object, around line 622)
- Modify: `aimeat/public/js/services/generator-prompts.js` (in `buildComponentPrompt` function, line 1867)

This is the prompt that generates the actual design system output.

- [ ] **Step 1: Add design template to COMPONENT_TEMPLATES**

Add after the `cortex` template in the `COMPONENT_TEMPLATES` object:

```javascript
  design: (label, context) => {
    // All matched design data is already injected into `context` by buildComponentPrompt

    return `You are creating a Design System specification for an AIMEAT app.

${context}

## Your Task

Based on the matched design data below, produce a COMPLETE design system that all app components in this project will use.

## Output Format

Return a single code block with TWO sections separated by a comment line:

1. CSS block — complete :root variables + @import for fonts
2. GUIDELINES block — JSON with design rules, anti-patterns, and checklist

\`\`\`
/* === DESIGN SYSTEM === */

@import url('...google fonts...');

:root {
  /* Color Palette */
  --color-primary: #hex;
  --color-on-primary: #hex;
  --color-secondary: #hex;
  --color-on-secondary: #hex;
  --color-accent: #hex;
  --color-on-accent: #hex;
  --color-background: #hex;
  --color-foreground: #hex;
  --color-card: #hex;
  --color-card-fg: #hex;
  --color-muted: #hex;
  --color-muted-fg: #hex;
  --color-border: #hex;
  --color-destructive: #hex;
  --color-on-destructive: #hex;
  --color-ring: #hex;
  --color-success: #hex;
  --color-warning: #hex;

  /* Typography */
  --font-heading: 'Font Name', serif;
  --font-body: 'Font Name', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Style Variables */
  --radius: Npx;
  --radius-lg: Npx;
  --shadow-sm: ...;
  --shadow-md: ...;
  --shadow-lg: ...;
  --transition: Nms ease;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Style-specific (e.g., glassmorphism blur, neumorphism shadows) */
  ...any additional variables for the chosen style...
}

/* === GUIDELINES === */
/*
{
  "style": "Style Name",
  "productType": "Product Type",
  "effects": "Description of recommended effects and animations",
  "doNotUse": ["anti-pattern 1", "anti-pattern 2"],
  "checklist": ["item 1", "item 2"],
  "layoutPattern": "Recommended layout pattern",
  "chartGuidance": "Color and chart type recommendations if applicable"
}
*/
\`\`\`

## Rules
- Use ONLY the matched color values provided — do not invent colors
- Use ONLY the matched font pairing — do not substitute fonts
- Include ALL CSS variables shown above — apps depend on these exact names
- The GUIDELINES JSON must include anti-patterns specific to this product type
- Add style-specific CSS variables (e.g., --blur-amount for glassmorphism, --shadow-soft for neumorphism)
- Keep CSS variable names consistent with AIMEAT conventions (--color-*, --font-*, --radius, --shadow-*, --spacing-*)
- Do NOT include component-level styles (buttons, cards, forms) — only design tokens`;
  },
```

- [ ] **Step 2: Modify buildComponentPrompt to inject matched design data for design type**

In `buildComponentPrompt()` (line 1867), add design data injection before calling the template.

First, add a static import at the top of `generator-prompts.js` (it is already an ESM module):
```javascript
import { matchDesignSystem } from '/js/services/design-data.js';
```

Then in `buildComponentPrompt()`, before the `return template(...)` call:

```javascript
  // For design components: match design data from CSV datasets and inject into context
  if (type === 'design' && interviewSpec?.designSystem?.enabled) {
    const match = matchDesignSystem(
      interviewSpec.designSystem.productType,
      interviewSpec.designSystem.styleOverride,
      interviewSpec.style?.mood
    );

    context += '\n## Matched Design Data (from curated database — use these values)\n\n';
    if (match.product) {
      context += `### Product Type: ${match.product.type}\n`;
      context += `- Primary Style: ${match.product.primaryStyle}\n`;
      context += `- Landing Pattern: ${match.product.landingPattern}\n`;
      context += `- Considerations: ${match.product.considerations}\n\n`;
    }
    if (match.colors) {
      context += `### Color Palette (use these EXACT hex values)\n`;
      context += `Primary: ${match.colors.primary} | On Primary: ${match.colors.onPrimary}\n`;
      context += `Secondary: ${match.colors.secondary} | On Secondary: ${match.colors.onSecondary}\n`;
      context += `Accent: ${match.colors.accent} | On Accent: ${match.colors.onAccent}\n`;
      context += `Background: ${match.colors.background} | Foreground: ${match.colors.foreground}\n`;
      context += `Card: ${match.colors.card} | Card FG: ${match.colors.cardForeground}\n`;
      context += `Muted: ${match.colors.muted} | Muted FG: ${match.colors.mutedForeground}\n`;
      context += `Border: ${match.colors.border}\n`;
      context += `Destructive: ${match.colors.destructive} | On Destructive: ${match.colors.onDestructive}\n`;
      context += `Ring: ${match.colors.ring}\n`;
      context += `Notes: ${match.colors.notes}\n\n`;
    }
    if (match.typography) {
      context += `### Typography Pairing: ${match.typography.name}\n`;
      context += `- Heading: ${match.typography.headingFont}\n`;
      context += `- Body: ${match.typography.bodyFont}\n`;
      context += `- CSS Import: ${match.typography.cssImport}\n`;
      context += `- Mood: ${match.typography.mood.join(', ')}\n\n`;
    }
    if (match.style) {
      context += `### Style: ${match.style.name}\n`;
      context += `- Effects: ${match.style.effects}\n`;
      context += `- Best For: ${match.style.bestFor}\n`;
      context += `- Do NOT Use For: ${match.style.doNotUseFor}\n`;
      context += `- Design Variables: ${match.style.designVars}\n`;
      context += `- Checklist: ${match.style.checklist}\n`;
      context += `- AI Prompt Keywords: ${match.style.aiPromptKeywords}\n\n`;
    }
    if (match.reasoning) {
      context += `### Anti-Patterns for ${match.reasoning.category}\n`;
      context += `- ${match.reasoning.antiPatterns}\n`;
      context += `- Decision Rules: ${match.reasoning.decisionRules}\n\n`;
    }
  }
```

Note: `buildComponentPrompt` is synchronous. The `matchDesignSystem` import is a static ESM import (no async needed) since `design-data.js` exports constants and pure functions.

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/js/services/generator-prompts.js
git commit -m "feat(generator): add design component prompt template with CSV data injection"
```

---

## Task 5: Modify App Prompt — Inject Completed Design System

**Files:**
- Modify: `aimeat/public/js/services/generator-prompts.js` (in `COMPONENT_TEMPLATES.app`, around line 1262)

When a design component is completed, its output replaces the generic CSS design system in the app prompt.

- [ ] **Step 1: Detect completed design component in app template**

In the `app` template function (line 1052), after the cortex detection block, add design detection:

```javascript
    // Check if design system is in completed components
    const designComponent = (completedComponents || []).find(c => c.type === 'design');
    const hasDesign = designComponent && designComponent.result;
```

- [ ] **Step 2: Replace generic CSS section with design system output**

Find the "## CSS Design System" section (around line 1262-1294). Replace it with conditional output:

```javascript
    // If design system completed, use it. Otherwise use generic defaults.
    let cssDesignSection = '';
    if (hasDesign) {
      // Split design result into CSS and guidelines sections
      const guidelinesMatch = designComponent.result.match(/\/\* === GUIDELINES === \*\/\s*\/\*\s*([\s\S]*?)\s*\*\//);
      const cssOnly = designComponent.result.replace(/\/\* === GUIDELINES === \*\/[\s\S]*$/, '').trim();
      let guidelinesSection = '';
      if (guidelinesMatch) {
        try {
          const guidelines = JSON.parse(guidelinesMatch[1]);
          guidelinesSection = `\n\n## Design Guidelines (follow these rules)\n\n`;
          guidelinesSection += `- **Style:** ${guidelines.style}\n`;
          guidelinesSection += `- **Effects:** ${guidelines.effects}\n`;
          guidelinesSection += `- **Layout:** ${guidelines.layoutPattern}\n`;
          if (guidelines.doNotUse?.length) guidelinesSection += `- **NEVER do:** ${guidelines.doNotUse.join(', ')}\n`;
          if (guidelines.checklist?.length) guidelinesSection += `- **Checklist:** ${guidelines.checklist.join(', ')}\n`;
          if (guidelines.chartGuidance) guidelinesSection += `- **Charts:** ${guidelines.chartGuidance}\n`;
        } catch { /* guidelines parse failed — skip, CSS is enough */ }
      }

      cssDesignSection = `## CSS Design System (from Design Intelligence — use this EXACTLY)

The project has a completed Design System. Use these EXACT colors, fonts, and variables:

\`\`\`css
${cssOnly}
\`\`\`

NEVER override these colors or fonts with your own choices. The design system was curated for this specific product type.
Use var(--color-*) for ALL colors. Use var(--font-heading) and var(--font-body) for typography.
${guidelinesSection}`;
    } else {
      // Keep existing generic CSS section verbatim (lines 1262-1294 in the current file).
      // Starts with "## CSS Design System" heading, includes the :root block with
      // generic --color-primary: #3b82f6 etc., and ends with the line:
      // "Customize the palette based on the project's domain and the style preferences from the spec."
      cssDesignSection = `## CSS Design System
...existing content from lines 1262-1294 moved here unchanged...`;
    }
```

Then use `${cssDesignSection}` in the return template where the CSS section currently is.

- [ ] **Step 3: Update version history**

- [ ] **Step 4: Commit**

```bash
git add aimeat/public/js/services/generator-prompts.js
git commit -m "feat(generator): inject completed design system into app prompt, replacing generic CSS"
```

---

## Task 6: Add Design Validators

**Files:**
- Modify: `aimeat/public/js/services/generator-validate.js` (client-side)
- Modify: `aimeat/src/services/generator-validate.ts` (server-side)

- [ ] **Step 1: Add 'design' to allowed blueprint types (client-side)**

In `generator-validate.js` line 590, add `'design'` to the allowed types array:

```javascript
if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex', 'design'].includes(c.type)) {
```

- [ ] **Step 2: Add design validator (client-side)**

In the `validators` object (line 215), add:

```javascript
  design(result) {
    const errors = [];
    // Design output should contain CSS :root block with color variables
    if (!result.includes(':root')) errors.push('Missing :root CSS block');
    if (!result.includes('--color-primary')) errors.push('Missing --color-primary variable');
    if (!result.includes('--color-background')) errors.push('Missing --color-background variable');
    if (!result.includes('--font-heading')) errors.push('Missing --font-heading variable');
    if (!result.includes('--font-body')) errors.push('Missing --font-body variable');
    // Should have GUIDELINES section
    if (!result.includes('GUIDELINES')) errors.push('Missing GUIDELINES section');

    // Extract the CSS + guidelines block
    const extracted = extractCodeBlock(result, '') || result;
    return { valid: errors.length === 0, errors, extracted };
  },
```

- [ ] **Step 3: Add 'design' to allowed blueprint types (server-side)**

In `generator-validate.ts` line 691, add `'design'`:

```typescript
if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex', 'design'].includes(c.type)) {
```

- [ ] **Step 4: Add design to ComponentType and validateComponent (server-side)**

In `generator-validate.ts`:

Update the type (line 24):
```typescript
export type ComponentType =
  | 'csm' | 'msm' | 'extension' | 'app'
  | 'memory' | 'translation' | 'cortex' | 'design';
```

Add `validateDesign()` function:
```typescript
function validateDesign(content: string): ValidationResult {
  const errors: string[] = [];
  if (!content.includes(':root')) errors.push('Missing :root CSS block');
  if (!content.includes('--color-primary')) errors.push('Missing --color-primary variable');
  if (!content.includes('--color-background')) errors.push('Missing --color-background variable');
  if (!content.includes('--font-heading')) errors.push('Missing --font-heading variable');
  if (!content.includes('--font-body')) errors.push('Missing --font-body variable');
  if (!content.includes('GUIDELINES')) errors.push('Missing GUIDELINES section');

  const extracted = extractCodeBlock(content, '') || content;
  return { valid: errors.length === 0, errors, extracted };
}
```

Add to switch in `validateComponent()` (line 572):
```typescript
    case 'design': return validateDesign(content);
```

- [ ] **Step 5: Add design to registration switch (server-side)**

In `generator.ts` (line 996), add `'design'` to the no-catalogue-registration group:

```typescript
          case 'memory':
          case 'translation':
          case 'cortex':
          case 'design':
            // No catalogue registration needed — stored in generator memory keys only
            break;
```

- [ ] **Step 6: Add 'design' to allowedComponentKeys in blueprint validator**

In both client (`generator-validate.js` line 580) and server blueprint validators, the `allowedComponentKeys` Set should remain as-is — design components use the same standard keys (id, type, label, produces, consumes). No new keys needed.

- [ ] **Step 7: Commit**

```bash
git add aimeat/public/js/services/generator-validate.js aimeat/src/services/generator-validate.ts aimeat/src/routes/generator.ts
git commit -m "feat(generator): add design component type validation and registration"
```

---

## Task 7: Typecheck and Lint

**Files:** None created — verification only.

- [ ] **Step 1: Run typecheck**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: 0 errors. The `ComponentType` change may cause exhaustiveness issues if there are other switch statements — fix any that appear.

- [ ] **Step 2: Run lint**

```bash
cd aimeat && pnpm lint
```

Expected: 0 errors.

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Commit fixes if needed**

---

## Task 8: E2E Tests

**Files:**
- Existing test files should still pass — design is additive, doesn't change existing behavior.

- [ ] **Step 1: Run E2E tests on SQLite**

```bash
cd aimeat && pnpm test:e2e:sqlite
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 2: Run E2E tests on MongoDB**

```bash
cd aimeat && pnpm test:e2e:mongodb
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 3: Fix any regressions**

If tests fail, the most likely cause is the `ComponentType` union change in `generator-validate.ts` causing TypeScript issues in test helpers. Fix and re-run.

---

## Task 9: Manual Smoke Test

Since the design intelligence is a prompt-driven feature (user copies prompts to AI chat), automated E2E tests can verify validation but the full flow requires manual testing.

- [ ] **Step 1: Verify matchDesignSystem returns correct data**

Open browser console on the AIMEAT portal and run:
```javascript
import('/js/services/design-data.js').then(m => {
  console.log(m.matchDesignSystem('healthcare'));
  console.log(m.matchDesignSystem('saas'));
  console.log(m.matchDesignSystem('e-commerce'));
});
```

Verify each returns a complete match object with product, colors, typography, style, reasoning.

- [ ] **Step 2: Test interview prompt includes design question**

Create a new generator project, copy the interview prompt, verify it includes the design intelligence question.

- [ ] **Step 3: Test blueprint with design enabled**

Submit an interviewSpec with `designSystem.enabled: true`, copy the blueprint prompt, verify it mentions the design component type.

- [ ] **Step 4: Test design component prompt**

With a blueprint containing `design-1`, verify the design prompt includes matched CSV data (colors, fonts, style).

- [ ] **Step 5: Test app prompt with completed design**

Submit a design component result, then check the app prompt — verify it uses the design system CSS instead of the generic defaults.

---

## Future Work (not in scope for this plan)

- **Edit flow:** "Add Design System" via the edit/change propagation system for projects that initially skipped it
- **Dark mode palettes:** Generate both light and dark :root blocks from the color data
- **Chart integration:** Use charts.csv data to recommend specific chart types and colors when views include data visualizations
- **Preview:** Show a visual preview of the matched palette/fonts in the generator UI before generating
