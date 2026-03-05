# Design: Scope Management UI

**Date:** 2026-03-05
**Status:** Approved
**Depends on:** REQ-006 (Scoped Agent Capabilities — backend implemented)
**Scope:** Frontend UI for managing agent scopes across all user types

## Problem

The scoped agent capabilities backend (REQ-006) is fully implemented — JWTs carry scopes, `requireScope()` enforces per-endpoint access, and `PATCH /v1/agents/:name/scopes` allows scope updates. However, there is **zero UI visibility**: no way for operators, owners, or end users to view or manage agent scopes through the interface. Users must use raw API calls.

## Solution

Add scope management UI inside the existing **Agents tab** of the Profile view. Uses the **Summary + Modal** pattern: agent cards show scope status at a glance, clicking opens a full modal for editing.

## Approach: Summary + Modal

### Agent Card Enhancement

Each agent card gets a scope summary row below the existing stats:

```
┌─────────────────────────────────────────────┐
│ TranslationBot              [translation-1] │
│ agent@owner@node.aimeat                     │
│ Trust: 85 │ Balance: 120 │ Last seen: 2h ago│
│ capabilities: translate, summarize          │
│                                             │
│ Standard • 6 scopes                [Manage] │  ← NEW
└─────────────────────────────────────────────┘
```

Shows: lock icon + template name + scope count + "Manage" button (for owners/operators only).

### Template Recognition

Client-side matching of scope arrays to named profiles:

| Template | Scopes |
|----------|--------|
| Read-only | `memory:read`, `catalogue:read`, `social:read` |
| Standard | `memory:read`, `memory:write`, `catalogue:read`, `social:read`, `work:request`, `work:read` |
| Full access | `*` |
| Custom | Anything else |

### Scope Management Modal

Clicking "Manage" opens a modal with two sections:

**1. Template Selector** — Three buttons (Read-only / Standard / Full access) that pre-fill scope checkboxes.

**2. Advanced Scope Editor** — Expandable section (collapsed by default unless "Custom" profile). Grouped by domain, each row shows:
- Checkbox toggle
- Friendly label (i18n): "Read", "Write", "Delete", etc.
- Technical scope string (muted): `memory:read`, `work:accept`, etc.

Domain groups:

| Domain | Permissions |
|--------|------------|
| Memory | read, write, delete |
| Work | request, read, accept, publish |
| Social | read, write |
| Wallet | read |
| Consent | manage |
| Tunnel | connect |
| Agent | register |
| Catalogue | read (always on, Tier 0) |

**Behaviors:**
- Selecting a template pre-fills checkboxes; modifying any checkbox switches to "Custom"
- Clicking domain header toggles all permissions (domain wildcard)
- `catalogue:read` is always checked (Tier 0 public, shown with lock icon)

### Tiered Visibility

| User type | Sees | Edits | Constraints |
|-----------|------|-------|-------------|
| Operator | All agents on node | All scopes, all agents | None |
| Owner | Own agents | Own agents' scopes | Limited by `maxAgentScopes` — exceeding scopes greyed out with tooltip |
| Agent (self) | Own scopes | None (read-only) | Inline scope list on card, no modal |

For agents viewing themselves: scope list displayed as read-only badges inline on the agent card (no modal needed).

### Component Structure

All defined inside `profile.js` (following existing inline component pattern):

1. **Scope summary row** — Inline on agent card (template badge + count + manage button)
2. **ScopesModal** — Modal with template selector + advanced editor
3. **ScopeDomainGroup** — Reusable domain checkbox group (used inside modal)

### API Integration

No new endpoints. Uses existing:
- `GET /v1/agents` → `agent.defaultScopes` for reading current scopes
- `PATCH /v1/agents/:name/scopes` → `{ scopes: [...] }` for updating

### i18n

New keys under `profile.agents.scopes.*` in `en.json` and `fi.json`:
- Template names: Read-only, Standard, Full access, Custom
- Domain labels: Memory, Work, Social, Wallet, Consent, Tunnel, Agent, Catalogue
- Permission labels: Read, Write, Delete, Manage, Connect, Request, Accept, Publish, Register
- UI strings: "Manage scopes", "Advanced scope editor", "Scope profile", "scopes", "Save", "Not available on this node"

### CSS Styling

Follows existing profile CSS patterns (`.pf` scoping):
- Scope summary row uses `.badge` pattern for template name
- Modal uses existing `.modal-overlay` + `.modal` pattern
- Domain groups use `.card`-like containers with glassmorphic background
- Checkboxes use custom styling matching the dark theme + pink/magenta accent
- Advanced toggle uses existing `.expand-btn` pattern

### Scope UX: Templates + Override

The modal defaults to template mode (three large buttons). Users select a template to quickly set common configurations. The "Advanced scope editor" toggle reveals granular checkboxes for fine-tuning. Modifying any individual scope auto-switches to "Custom" template.

## Files Changed

| File | Change |
|------|--------|
| `public/views/profile.js` | Add scope summary to agent cards, ScopesModal component, ScopeDomainGroup component |
| `public/css/views/profile.css` | Add scope-related styles (summary row, modal sections, domain groups, checkboxes) |
| `locales/en.json` | Add scope UI translation keys |
| `locales/fi.json` | Add scope UI translation keys (Finnish) |

## Backward Compatibility

- Agents without `defaultScopes` show "Full access" (matches `['*']` default)
- No backend changes required
- Existing agent cards retain all current information; scope row is additive
