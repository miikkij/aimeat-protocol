# Source File Header Standard

## The Rule

Every source file (`.ts`, `.js`, `.mjs`, `.css`) has a header comment that says what the file is for. Keep the header current when you change the file, and add a line to its version history.

**Warning:** Headers can fall behind the code. They tell you *at minimum* what the file is for and how to use it, but details may lag behind the implementation.

### What lint enforces, and what is policy

- **Enforced:** the ESLint rule `aimeat/file-header` (`aimeat/eslint-rules/file-header.js`) is an error, so it blocks the commit. It requires a block comment that starts within the first five lines and contains `@file` and `@description`. It runs on what `pnpm lint` lints: `aimeat/src/` and `aimeat/public/`, without the vendored and generated folders listed under `ignores` in `aimeat/eslint.config.js` (among them `public/lib/`, `public/cortex-bundled/`, `src/generated/`, and `src/static/` apart from `src/static/sdk-libs/`). It is off for `aimeat/test/`.
- **Policy, not checked by any tool:** `@author`, the SPDX line, `@structure`, `@usage` and `@version-history`, every header on a `.css` file (ESLint does not read CSS), and headers on `.mjs` scripts outside `src/` and `public/`. Existing files carry them; keep doing so.

---

## Header Format: TypeScript / JavaScript

This is the shape the tracked source files carry:

```typescript
/**
 * @file src/services/my-thing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description <What this file does and its role in the system. As many lines as the reason
 *   needs, indented by two spaces after the first.>
 *
 * @structure
 *   - <Key export or section 1>: <what it does>
 *   - <Key export or section 2>: <what it does>
 *
 * @usage
 *   import { thing } from './my-thing.js';
 *
 * @dependencies
 *   - <key dependency>: <why it's needed>
 *
 * @version-history
 *   v1.1.0 - 2026-10-11 - Added X (reason).
 *   v1.0.0 - 2026-10-01 - Initial implementation.
 */
```

`@file` is the path from `aimeat/` (`src/services/my-thing.ts`); older files give only the file name, and both pass the lint rule. Copy the `@author` and `SPDX-License-Identifier: MIT` lines as existing files carry them.

### Minimal Header (for simple utility files)

```typescript
/**
 * @file src/utils/gaii.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GAII (Global AI Identifier) parsing and formatting utilities.
 * @usage import { parseGAII, buildGAII } from '../utils/gaii.js';
 * @version-history
 *   v1.0.0 - 2026-03-13 - Initial implementation.
 */
```

---

## Header Format: CSS

```css
/**
 * @file public/css/views/agents-detail.css
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Styles for the agent detail view. All classes use the `agd-` prefix to avoid
 *   collisions with other views.
 *
 * @structure
 *   - Layout: header, tabs, panels
 *   - Components: cards, badges, buttons, tables
 *
 * @usage
 *   Linked from spa.html with <link rel="stylesheet">.
 *
 * @version-history
 *   v1.0.0 - 2026-03-13 - Initial implementation.
 */
```

---

## Header Format: E2E Test Files

```typescript
/**
 * @file test/e2e-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Security-focused E2E tests: SSRF protection, header injection, auth bypass,
 *   path traversal, XSS prevention, and CORS enforcement.
 *
 *   THE REFUSALS, and why each one is here: <one line per refusal the suite proves>.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=security
 * @version-history
 *   v1.0.0 - 2026-03-13 - Initial security test suite.
 */
```

`@usage` names the runner command, not a port. The runner starts its own server, and the port comes from the `.env.test.*` files that `pnpm test:env:init` writes for each worktree. How to run and write suites: [testing-requirements.md](./testing-requirements.md).

---

## Rules

### When to Add a Header

- **New files**: Always add a header when creating a new file.
- **Existing files without headers**: Add a header when you modify the file for any reason.

### When to Update the Version History

- **Feature addition**: Bump minor version (v1.1.0 to v1.2.0), describe what was added and why.
- **Bug fix**: Bump patch version (v1.1.0 to v1.1.1), describe what was fixed.
- **Structural change**: Bump minor or major version depending on scope, update `@structure`.
- **Breaking change**: Bump major version (v1.0.0 to v2.0.0).

### What to Include

| Section | Required? | Description |
|---------|-----------|-------------|
| `@file` | **Yes (lint)** | Path from `aimeat/`, or the file name |
| `@description` | **Yes (lint)** | What it does, its role, and why it exists |
| `@author`, `SPDX-License-Identifier` | Yes (policy) | Copied as existing files carry them |
| `@version-history` | Yes (policy) | Dated changelog with the reason for each change |
| `@structure` | Recommended | Key exports, sections, or classes |
| `@usage` | Recommended | Import example, the command that runs it, or how it is consumed |
| `@dependencies` | Optional | Non-obvious dependencies and why |

### What NOT to Include

- **Implementation details** that change often: the code itself is the source of truth.
- **Auto-generated documentation**: headers are hand-written summaries.
- **Redundant information**: don't repeat what's obvious from the filename or directory.

### Version History Format

```
v{major}.{minor}.{patch} - {YYYY-MM-DD} - {Brief description of change (reason)}
```

Put the newest entry first. A long entry continues on the next line, indented two more spaces. Existing files separate the three parts with a hyphen, a double hyphen or an em-dash; nothing parses the line, so match the file you are editing.

Examples:
```
v2.0.0 - 2026-03-10 - Rewrote storage interface for repository pattern (multi-backend support)
v1.1.1 - 2026-03-07 - Fixed token refresh race condition
v1.1.0 - 2026-03-05 - Added TOTP 2FA support (Phase 2 requirement)
v1.0.0 - 2026-03-01 - Initial implementation
```

**Do not shorten the history.** It is how the next reader learns why the file is the way it is. In particular, never shave comments or version history to bring a file under the line limit.

### The 800-Line Limit

No file over 800 lines. The ESLint rule `aimeat/max-file-lines` is an error in `src/` and `public/`, so it blocks the commit (it is off for `test/`). When a file grows past the limit, split it by **pure extraction**: move a coherent group to a sibling file and change nothing else, so the diff is a move and the existing tests still prove it. Give the new file its own header and note the move in both histories. The rule is `.claude/rules/code-files.md`.

---

## Applying to Existing Files

Add headers to files as you touch them. Don't create a bulk "add headers to everything" task: that creates noisy diffs. Instead, leave every file you touch with a proper header.

For the initial version history entry on an existing file, use:
```
v1.0.0 - {today's date} - Header added; file pre-dates header standard
```

This says that the version history starts from when the header was added, not from the file's original creation.
