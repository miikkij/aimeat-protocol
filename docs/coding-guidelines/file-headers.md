# Source File Header Standard

## MANDATORY RULE (HIGH PRIORITY)

Every source code file (`.ts`, `.js`, `.css`) must have a header comment explaining what the file is about. Headers must be maintained whenever the file is modified, with a version history tracking changes.

**Warning:** Headers may become outdated over time. They reliably tell you *at minimum* what the file is for and how to use it, but details may lag behind the actual implementation.

---

## Header Format — TypeScript / JavaScript

```typescript
/**
 * @file <filename.ts>
 * @description <1-2 sentence description of what this file does and its role in the system>
 *
 * @structure
 *   - <Key export or section 1>: <what it does>
 *   - <Key export or section 2>: <what it does>
 *   - ...
 *
 * @usage
 *   import { thing } from './<filename>.js';
 *   // Brief usage example or reference to where it's used
 *
 * @dependencies
 *   - <key dependency>: <why it's needed>
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 *   v1.1.0 — 2026-03-15 — Added X feature (reason)
 *   v1.1.1 — 2026-03-16 — Fixed Y bug in Z function
 */
```

### Minimal Header (for simple utility files)

```typescript
/**
 * @file utils/gaii.ts
 * @description GAII (Global AI Identifier) parsing and formatting utilities.
 *
 * @usage
 *   import { parseGaii, formatGaii } from '../utils/gaii.js';
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 */
```

---

## Header Format — CSS

```css
/**
 * @file admin.css
 * @description Admin dashboard styles. All classes use `adm-*` prefix to avoid collisions.
 *
 * @structure
 *   - Layout: sidebar, content area, grid system
 *   - Components: cards, badges, buttons, tables
 *   - States: hover, active, disabled
 *
 * @usage
 *   Loaded by admin.js via useViewCSS('/css/views/admin.css')
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 */
```

---

## Header Format — E2E Test Files

```typescript
/**
 * @file e2e-security.ts
 * @description Security-focused E2E tests: SSRF protection, header injection, auth bypass,
 *   path traversal, XSS prevention, and CORS enforcement.
 *
 * @run cd aimeat && pnpm exec tsx test/e2e-security.ts
 * @requires Server running on port 40251
 *
 * @structure
 *   - Setup: registers test owners/agents
 *   - Tests: grouped by security concern
 *   - Cleanup: cascade delete at end
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial security test suite
 */
```

---

## Rules

### When to Add a Header

- **New files**: Always add a header when creating a new file.
- **Existing files without headers**: Add a header when you modify the file for any reason.

### When to Update the Version History

- **Feature addition**: Bump minor version (v1.1.0 → v1.2.0), describe what was added and why.
- **Bug fix**: Bump patch version (v1.1.0 → v1.1.1), describe what was fixed.
- **Structural change**: Bump minor or major version depending on scope, update `@structure`.
- **Breaking change**: Bump major version (v1.0.0 → v2.0.0).

### What to Include

| Section | Required? | Description |
|---------|-----------|-------------|
| `@file` | **Yes** | Filename (relative path if helpful) |
| `@description` | **Yes** | 1-2 sentences: what it does, its role |
| `@structure` | Recommended | Key exports, sections, or classes |
| `@usage` | Recommended | Import example or how it's consumed |
| `@dependencies` | Optional | Non-obvious dependencies and why |
| `@version-history` | **Yes** | Dated changelog with reason for each change |

### What NOT to Include

- **Implementation details** that change frequently — the code itself is the source of truth.
- **Auto-generated documentation** — headers are hand-written summaries.
- **Redundant information** — don't repeat what's obvious from the filename or directory.

### Version History Format

```
v{major}.{minor}.{patch} — {YYYY-MM-DD} — {Brief description of change (reason)}
```

Examples:
```
v1.0.0 — 2026-03-01 — Initial implementation
v1.1.0 — 2026-03-05 — Added TOTP 2FA support (Phase 2 requirement)
v1.1.1 — 2026-03-07 — Fixed token refresh race condition
v2.0.0 — 2026-03-10 — Rewrote storage interface for repository pattern (multi-backend support)
```

Keep the history concise. If a file has been heavily modified, keep the last 10-15 entries and note "earlier history omitted" at the top of the list.

---

## Applying to Existing Files

When working on this codebase, add headers to files as you touch them. Don't create a bulk "add headers to everything" task — that creates noisy diffs. Instead, follow the **campsite rule**: leave every file you touch with a proper header.

For the initial version history entry on existing files, use:
```
v1.0.0 — {today's date} — Header added; file pre-dates header standard
```

This honestly communicates that the version history starts from when headers were adopted, not from the file's original creation.
