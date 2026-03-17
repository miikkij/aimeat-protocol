# AIMEAT Profile Views — Style Consistency Analysis

**Date:** 2026-03-17
**Scope:** All profile tab views (`public/views/profile/*-tab.js`), CSS files, and shared components
**Purpose:** Identify the canonical AIMEAT style, document inconsistencies across views, and establish a baseline for unification

---

## 1. Canonical AIMEAT Style (Source of Truth)

### 1.1 Design Tokens (`public/css/theme.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#E8564A` (coral) | Brand color, section titles, active tabs, links, focus rings |
| `--text` | `#1A1A2E` | Primary text |
| `--text-dim` | `#6B7280` | Secondary text, descriptions, labels |
| `--text-muted` | `#9CA3AF` | Tertiary text, timestamps |
| `--bg` | `#FAFAF8` | Page background |
| `--bg-card` | `#FFFFFF` | Card backgrounds |
| `--border` | `#E5E7EB` | Card borders, dividers |
| `--success` | `#10B981` | Positive states |
| `--warn` / `--warning` | `#F59E0B` | Warning states |
| `--danger` | `#EF4444` | Error/destructive states |
| `--radius` | `16px` | Large containers |
| `--radius-sm` | `10px` | Buttons, inputs |
| `--radius-xs` | `6px` | Badges, small elements |
| `--shadow-heart` | `0 4px 14px rgba(232,86,74,0.3)` | Primary button glow |
| `--font` | `'DM Sans'` | UI text |
| `--font-mono` | `'JetBrains Mono'` | Code, IDs, technical data |

### 1.2 Button System (`theme.css`)

| Class | Appearance | When to Use |
|-------|-----------|-------------|
| `.btn-primary` | Coral gradient (`#E8564A` → `#FF6B6B`), white text, shadow | Primary CTA |
| `.btn-outline` | Transparent, gray border, dim text | Secondary action |
| `.btn-ghost` | Transparent, subtle border | Tertiary / Cancel |
| `.btn-danger` | Light red bg `#FEE2E2`, red text `#EF4444` | Destructive action |
| `.btn-sm` | Smaller padding (0.35rem 0.75rem), 0.8rem font | Compact contexts |

**Missing from theme.css (used via inline styles):**
- `.btn-success` — green background, white text (used for "Activate All")
- `.btn-info` — blue background, white text (used for "Package")
- `.btn-danger-solid` — solid red background, white text (used for "Remove Selected")

### 1.3 Card Pattern (`profile.css`)

```css
.pf .card {
  background: #FFFFFF;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem;
  margin-bottom: 0.75rem;
  transition: border-color 0.2s;
}
.pf .card:hover { border-color: var(--accent); }
```

### 1.4 Section Header Pattern

```css
.pf .section-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--accent, #E8564A);  /* ALWAYS coral */
}
.pf .section-desc {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin-bottom: 1.25rem;
}
```

### 1.5 Badge System (`profile.css`)

```css
.pf .badge { padding: 0.15rem 0.5rem; border-radius: 6px; font-size: 0.7rem; font-weight: 700; }
.pf .badge-success { background: rgba(34,197,94,.15); color: #22c55e; }
.pf .badge-warn    { background: rgba(245,158,11,.15); color: #f59e0b; }
.pf .badge-info    { background: rgba(232,86,74,.15);  color: #E8564A; }
.pf .badge-danger  { background: rgba(239,68,68,.15);  color: #ef4444; }
```

### 1.6 Form Pattern (`theme.css`)

```css
.input-field { padding: 11px 14px; border: 1.5px solid var(--border); border-radius: 10px; }
.input-field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(232,86,74,0.1); }
.create-form { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; }
.form-row label { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-dim); }
```

### 1.7 Back Button Pattern

The standard back button across AIMEAT views uses `.btn-outline .btn-sm`:

```html
<button class="btn btn-outline btn-sm" onClick=${onBack}>${t('...')}</button>
```

This renders as a bordered pill button, consistent with the profile tab system.

---

## 2. View-by-View Consistency Audit

### Rating: ✅ = Consistent | ⚠️ = Minor issues | ❌ = Significant deviation

| Tab | Rating | Inline Styles | Uses section-title/desc | Uses .card | Uses .badge | Notes |
|-----|--------|---------------|------------------------|-----------|------------|-------|
| `agents-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Clean, uses `.pf .agent-*` classes |
| `wallet-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Clean, uses `.pf .wallet-*` and `.tx-*` classes |
| `memory-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Uses `.mem-*` classes properly |
| `boards-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard card pattern |
| `chat-sessions-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard pattern |
| `federation-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard pattern |
| `organisms-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard pattern |
| `services-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard pattern |
| `node-stats-tab.js` | ✅ | Minimal | Yes | Yes | Yes | Standard pattern |
| `knowledge-tab.js` | ⚠️ | Some | Yes | Yes | Yes | A few inline spacing styles |
| `extensions-tab.js` | ⚠️ | Some | Yes | Yes | Yes | A few inline styles |
| `apps-tab.js` | ⚠️ | **Many** | Yes | Yes | Yes | Cards use inline styles for h3 color, font-size, margins; see §3.2 |
| `notifications-tab.js` | ⚠️ | Some | Yes | Partial | - | Some inline styles |
| `packages-tab.js` | ⚠️ | Some | Yes | Yes | Yes | Minor inline styles |
| **`generator-tab.js`** | **❌** | **Excessive** | **No** (uses `<h3>` directly) | **Partial** | **Partial** | Major deviation; see §3.1 |

---

## 3. Detailed Inconsistency Report

### 3.1 Generator Tab (`generator-tab.js`) — Major Issues

**A. Section headers don't use `.section-title` / `.section-desc`**

The generator tab uses raw `<h3>` and `<p>` tags with inline styles instead of the canonical section header classes:
```javascript
// ❌ Generator tab
<h3 style="...">${project.name}</h3>

// ✅ Every other tab
<div class="section-title">${t('profile.xyz.title')}</div>
<div class="section-desc">${t('profile.xyz.desc')}</div>
```

**B. Button colors via inline styles instead of classes**

The generator uses inline `style="background:var(--success,#22c55e);color:#fff"` for green, blue, and red buttons — at least 6 instances:

| Line | Inline Style | Should Be |
|------|-------------|-----------|
| 726 | `style="background:var(--success,#22c55e);color:#fff"` | `.btn-success` class |
| 755 | `style="background:var(--primary,#3b82f6);color:#fff"` | `.btn-info` class |
| 862 | `style="background:var(--error,#ef4444);color:#fff"` | `.btn-danger-solid` class |

**C. Metadata text via inline styles instead of classes**

```javascript
// ❌ Lines 707, 712, 774
<p style="margin:0 0 8px;font-size:0.85em;color:var(--text-muted,#888)">

// ✅ Should use a class like:
.pf-gen-meta { margin: 0 0 8px; font-size: 0.85em; color: var(--text-muted, #888); }
```

**D. Change diff colors via inline styles**

```javascript
// ❌ Lines 804-816
<li style="color:var(--success,#22c55e)">Added: ...</li>
<li style="color:var(--warning,#f59e0b)">Modified: ...</li>
<li style="color:var(--error,#ef4444)">Removed: ...</li>

// ✅ Should use classes:
.pf-gen-change-added    { color: var(--success); }
.pf-gen-change-modified { color: var(--warning); }
.pf-gen-change-removed  { color: var(--danger); }
```

**E. Layout via inline `display:flex;gap:...` instead of classes**

```javascript
// ❌ Lines 827, 857
<div style="display:flex;gap:8px;margin-top:12px">

// ✅ Should use .form-actions or a dedicated class
```

**F. Hardcoded "Back" string instead of i18n**

Line 907 has a hardcoded English "Back" text instead of using `t()`.

**G. Back button inconsistency**

The generator uses `.btn btn-outline btn-sm` for the main back button (line 691) but `.btn btn-ghost btn-sm` for other back buttons (lines 907, 938) — inconsistent within the same view.

### 3.2 Apps Tab (`apps-tab.js`) — Moderate Issues

The apps tab follows the section-title/section-desc pattern but has significant inline styling within cards:

```javascript
// ❌ Lines 87-97 — inline styles on every card element
<h3 style="color:var(--accent,#E8564A);font-size:1rem;margin-bottom:.5rem">
<p style="font-size:.85rem;color:var(--text-dim,#6B7280);margin-bottom:.75rem">
<p style="font-size:.8rem;color:var(--text-dim,#6B7280)">
<div style="font-size:.8rem;color:var(--text-dim,#6B7280);margin-bottom:.35rem">
<div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">
```

These patterns repeat across the app launcher card, create guide card, app list cards, and gallery cards. All should be CSS classes.

### 3.3 Common Pattern: Inline `margin-top` on `.section-title`

Multiple tabs add inline `style="margin-top:1.5rem"` to section titles when they need spacing from previous content. This should be a modifier class like `.section-title-spaced` or a sibling selector rule.

---

## 4. Pattern Summary: What Makes the "AIMEAT Style"

### Visual Identity
1. **Coral accent** (`#E8564A`) — used for all section headings, active states, hover borders, primary buttons
2. **Coral gradient** (`#E8564A → #FF6B6B`) — primary CTA buttons with heart shadow
3. **White cards** with 12px radius, 1px gray border, coral hover border
4. **Pill-shaped elements** — tabs, badges (border-radius: 999px / 9999px)
5. **DM Sans** for UI text, **JetBrains Mono** for technical data
6. **Soft shadows** — subtle 1px elevation, expanding on hover with translateY(-2px)
7. **Off-white background** (`#FAFAF8`) — not pure white, warmer feel
8. **Heart motif** (💝) — appears in morsels, CTA buttons, animations

### Interaction Patterns
1. Cards lift on hover (shadow + translateY)
2. Cards highlight coral border on hover
3. Focus rings are coral-tinted (`rgba(232,86,74,0.1)`)
4. Buttons have subtle translateY(-1px) on hover
5. Primary buttons have coral glow shadow
6. Expandable sections use chevron toggle
7. Delete/destructive actions use light-red background, not solid red

### Layout Patterns
1. Max width: 1000px centered
2. Tab content starts with `.section-title` + `.section-desc`
3. Items in `.card` containers with consistent padding
4. `.sub-tabs` for in-tab navigation (Entries/Files, etc.)
5. `.action-bar` for search + create above lists
6. Grid layouts for stats/overview cards
7. Forms in `.create-form` containers

---

## 5. Missing CSS Classes (Need to Add)

These button variants are used across views but only via inline styles:

```css
/* Solid success button (green) */
.btn-success {
  background: var(--success, #22c55e);
  color: #fff;
  border: none;
}
.btn-success:hover { opacity: 0.9; }

/* Solid info button (blue) */
.btn-info {
  background: #3B82F6;
  color: #fff;
  border: none;
}
.btn-info:hover { opacity: 0.9; }

/* Solid danger button (red, for destructive confirmations) */
.btn-danger-solid {
  background: var(--danger, #ef4444);
  color: #fff;
  border: none;
}
.btn-danger-solid:hover { opacity: 0.9; }
```

---

## 6. Existing Design Documentation

| File | Purpose | Status |
|------|---------|--------|
| `public/css/theme.css` | Global CSS variables, base components | Active, authoritative |
| `public/css/views/profile.css` | All profile tab CSS (`.pf-*` prefix) | Active, includes `.pf-gen-*` |
| `docs/frontend-development-guide.md` | Frontend architecture, component library, CSS conventions | Active |
| `assets/aimeat-design-mockups.html` | Visual design system mockups | Reference |
| `docs/superpowers/specs/2026-03-16-aimeat-ui-cortex-library-design.md` | UI cortex component library spec (34 components) | Draft/spec |
| `docs/aimeat-portal-redesign-instructions.md` | Portal UX redesign plan | Active |

---

## 7. Severity Classification

### Critical (Must Fix)
- Generator tab button colors via inline styles (6 instances)
- Generator tab missing section-title pattern
- Generator tab hardcoded English "Back" text
- Missing `.btn-success`, `.btn-info`, `.btn-danger-solid` classes in theme.css

### Moderate (Should Fix)
- Apps tab excessive inline styles (~15 instances)
- Generator metadata text via inline styles (~5 instances)
- Generator change diff colors via inline styles (4 instances)
- Generator flex layout via inline styles (3 instances)
- Inconsistent back button styling within generator

### Low (Polish)
- Various tabs adding `style="margin-top:1.5rem"` to section-title
- Minor inline spacing in knowledge, extensions, packages tabs
- Some inline `display:flex;gap:...` in card footers across multiple tabs

---

## 8. Recommendations

1. **Add missing button classes** to `theme.css` (`.btn-success`, `.btn-info`, `.btn-danger-solid`)
2. **Refactor generator-tab.js** — replace all inline styles with CSS classes (most already exist in profile.css, just unused)
3. **Refactor apps-tab.js** — move card content styles to profile.css
4. **Add `.section-title-spaced`** modifier for sections needing top margin
5. **Create a style guide document** codifying which class to use for each pattern
6. **Audit remaining tabs** and move inline styles to CSS where they repeat
