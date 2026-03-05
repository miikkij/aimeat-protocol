# Frontend Sprint Gap Analysis

**Date:** 2026-03-05
**Source plan:** `docs/plans/2026-03-05-frontend-improvement-sprint.md`
**Source analysis:** `docs/proposalsforimprovements/frontend-analysis-and-proposal.md`
**Purpose:** Identify items from the analysis that were not captured in the sprint plan

---

## Summary

The sprint plan covers 7 phases with 33 discrete tasks, addressing code quality, component reuse, CSS extraction, i18n, E2E testing, limited security, and developer documentation. Cross-referencing against the 13-section frontend analysis reveals **14 items omitted** from the sprint, ranging from security gaps to accessibility compliance and performance quick wins. Wildcard CORS is intentionally excluded — it is a core design requirement of the open AIMEAT protocol.

---

## What the Sprint Covers Well

| Area | Sprint Coverage |
|------|----------------|
| Shared component library | 7 components + barrel export (Phase 1) |
| Inline CSS extraction | All 9 views + theme.css additions (Phase 2) |
| Deduplication | copyToClipboard, spinner CSS (Phase 3) |
| i18n centralization | portal-classic.js translations (Phase 4) |
| E2E test infrastructure | Playwright, 13 test cases (Phase 5) |
| Auth retry limiting | Cap at 3 retries with backoff (Phase 6.1) |
| Input sanitization | sanitizeHtml() for boards/memory (Phase 6.2) |
| Three.js self-host | Local fallback for CDN (Phase 6.3) |
| Developer documentation | 2 guides (Phase 7) |

Note: CSP headers and Preact/HTM self-hosting are already done (mentioned in sprint background), so those analysis items are resolved.

---

## Gaps — Items in Analysis Not in Sprint

### Gap 1: JWT and Private Key Storage Migration (Security — HIGH)

**Analysis reference:** SEC-3
**Severity:** High

`aimeat-auth.js` stores the full JWT, Ed25519 private key, and session data in `localStorage`. Any successful XSS attack reads all credentials permanently.

The sprint adds input sanitization (Gap 6.2) and CSP is already in place, which reduces XSS risk — but the blast radius of any remaining XSS is still maximal as long as credentials live in localStorage.

**Recommended action:**
1. Move JWT to a module-scoped variable (memory only, lost on page reload)
2. Move Ed25519 private key to IndexedDB using the Web Crypto API's non-extractable `CryptoKey` format
3. On page reload, re-authenticate automatically using the stored non-extractable key (sign a fresh challenge)

Estimated effort: 1 day.

---

### Gap 2: `dangerouslySetInnerHTML` Audit (Security — MEDIUM)

**Analysis reference:** SEC-4
**Severity:** Medium

`profile.js` and `portal-dev.js` use `dangerouslySetInnerHTML`. The sprint adds `sanitizeHtml()` to utils.js (Phase 6.2) but does not explicitly task the audit or replacement of `dangerouslySetInnerHTML` call sites.

**Recommended action:** Search all view files for `dangerouslySetInnerHTML`, evaluate each use site, and replace with either safe Preact rendering or `sanitizeHtml()` output. Estimated effort: 2 hours.

---

### Gap 3: Accessibility — Entirely Absent from Sprint (Compliance — HIGH)

**Analysis reference:** Section 8
**Severity:** High (European Accessibility Act compliance since June 2025)

The analysis documents zero accessibility implementation and maps 11 failing WCAG 2.2 AA criteria. The sprint plan does not address accessibility at all.

Minimum viable accessibility work not captured:

| Item | WCAG Criterion | Effort |
|------|---------------|--------|
| Add `<main>`, `<nav>`, `<section>` landmarks to views | 1.3.1 | 2 hours |
| Add skip-to-content link in shell header | 2.4.1 | 30 min |
| Focus management on route change (focus `#main-content`) | 2.4.3 | 1 hour |
| `aria-live` region for dynamic content updates | 4.1.2 | 1 hour |
| `role="alert"` on error messages | 3.3.1 | 30 min |
| `<label>` elements on all form inputs | 3.3.2 | 2 hours |
| `prefers-reduced-motion` media query in theme.css | 1.4 | 30 min |
| Alt text on platform logos | 1.1.1 | 30 min |

Total estimated effort: 1–2 days for minimum viable implementation.

---

### Gap 4: Legacy HTML File Removal (Code Quality — MEDIUM)

**Analysis reference:** ISSUE-2, Proposal 6
**Severity:** Medium

13,650 lines of dead HTML files remain in `public/` (human.html, profile.html, human-classic.html, hobbies.html, marketplace.html, guides.html, aimeat-os.html, openclaw.html, plus wizard.html which may still be active). They are redirected via 301 but not removed. The sprint does not include this cleanup.

**Recommended action:** Verify wizard.html status (active or superseded by `/v1/setup`). Move the 8 confirmed-dead files to `public/_legacy/` with a README, or delete them outright. Estimated effort: 30 minutes.

---

### Gap 5: gzip/Brotli Compression (Performance — HIGH value, LOW effort)

**Analysis reference:** Section 9.2
**Severity:** Medium (quick win)

Express serves all static assets and API responses uncompressed. Adding the `compression` middleware is a single line of code that delivers 60–80% size reduction on JS, CSS, HTML, and JSON responses.

**Recommended action:** `pnpm add compression @types/compression` + one `app.use(compression())` call in server.ts. Estimated effort: 15 minutes.

---

### Gap 6: Empty `public/locales/` Directory (Architecture — MEDIUM)

**Analysis reference:** ISSUE-4
**Severity:** Medium

`public/locales/` exists but is empty. `i18n.js` fetches from `/locales/{lang}.json`. Translations are currently served from the backend `locales/` directory via Express static middleware. This is misleading — the frontend locales directory implies translations live there but they do not.

The sprint covers extracting portal-classic.js translations into `locales/en.json` and `locales/fi.json` (backend), but does not resolve whether `public/locales/` should be populated or removed.

**Recommended action:** Either remove `public/locales/` and document that the backend `locales/` directory is the canonical source, or populate it with frontend-specific keys distinct from backend i18n. Either choice should be made explicit.

---

### Gap 7: Inconsistent Error Handling / `useApiCall` Hook (Code Quality — MEDIUM)

**Analysis reference:** ISSUE-5
**Severity:** Medium

The analysis notes that error handling ranges from `Promise.allSettled()` with full fallback (profile.js) to silent `.catch(() => {})` (portal.js, portal-dev.js). The sprint adds shared components including Alert and Toast but does not introduce a shared `useApiCall()` hook to standardize the fetch-load-error pattern.

**Recommended action:** Add `useApiCall(endpoint, options)` to `public/js/utils.js` or a new `public/js/hooks.js` that returns `{ data, error, loading }` and handles errors consistently. Estimated effort: 2 hours.

---

### Gap 8: Large Monolithic View Splitting (Architecture — LOW-MEDIUM)

**Analysis reference:** ISSUE-6
**Severity:** Low-medium

`profile.js` (1,629 lines, 12 tabs) and `portal.js` (1,568 lines including a full game engine) are large enough to warrant splitting into sub-components. The sprint does not address this.

**Recommended action:** Not urgent, but as components are extracted in Phase 1 and CSS is extracted in Phase 2, the views will naturally shrink. A follow-up sprint could split `views/profile/` into tab-level modules. Defer to next sprint.

---

### Gap 9: Router Extraction to `router.js` (Architecture — LOW)

**Analysis reference:** Section 4.2
**Severity:** Low

The routing logic is hardcoded in `spa.html`. Adding a new view requires editing the HTML shell. A standalone `public/js/router.js` would be more maintainable and testable.

**Recommended action:** Low priority — current pattern works and is simple. Consider when the view count grows beyond 12–15. Defer.

---

### Gap 10: View Template File for Scaffolding (DX — LOW)

**Analysis reference:** Section 5.2
**Severity:** Low

No `views/_template.js` exists to accelerate new view creation. The frontend development guide (Phase 7.2) will include the pattern, but a working template file in the repo would be more immediately useful.

**Recommended action:** Create `public/views/_template.js` as a copy-paste starting point. 5-minute task, could be added to Phase 7.

---

### Gap 11: Preact Signals for Cross-View State (Architecture — NICE TO HAVE)

**Analysis reference:** Section 10.1
**Severity:** Low

There is no shared state layer between views. Wallet balance, agent list, and user preferences are re-fetched by each view independently. `@preact/signals` (1.2KB) would solve this without adding heavy state management.

**Recommended action:** Nice-to-have. Evaluate after component library and CSS extraction are complete.

---

### Gap 12: View Transitions API (Polish — NICE TO HAVE)

**Analysis reference:** Section 10.1
**Severity:** Low

SPA route changes have no transition animation. The View Transitions API is supported in Chrome and Safari and provides smooth cross-view animations without manual CSS transitions.

**Recommended action:** 2-hour enhancement. Low priority.

---

### Gap 13: JSDoc Type Annotations (Code Quality — NICE TO HAVE)

**Analysis reference:** Section 3.3, 10.2
**Severity:** Low

No type safety exists in any frontend JS file. Minimum useful improvement would be JSDoc `@param` and `@returns` annotations on public functions in `api.js`, `utils.js`, `i18n.js`, and shared components.

**Recommended action:** Add to component library creation (Phase 1) as each component is written — costs nothing extra if done at authoring time.

---

### Gap 14: Optional Build Pipeline (Performance — NICE TO HAVE)

**Analysis reference:** Proposal 9
**Severity:** Low

No minification, fingerprinting, or source maps exist. An optional Vite config targeting `public/` would enable production builds without disrupting the zero-build dev experience.

**Recommended action:** Defer until after core quality work is complete. This adds complexity with modest benefit given gzip compression (Gap 6) addresses most of the size concern.

---

## Priority Summary

### Add to Current Sprint (HIGH value, LOW effort)

| Gap | Area | Effort | Rationale |
|-----|------|--------|-----------|
| Gap 2 — dangerouslySetInnerHTML audit | Security | 2 hours | Low effort, sprint already covers sanitization |
| Gap 5 — gzip/brotli compression | Performance | 15 min | Trivial implementation, significant impact |
| Gap 4 — Legacy HTML removal | Code quality | 30 min | Eliminates 13,650 lines of confusion |
| Gap 10 — View template file | DX | 30 min | Complements Phase 7 developer guide |

### Recommend as Sprint Follow-up (HIGH value, MEDIUM-HIGH effort)

| Gap | Area | Effort | Rationale |
|-----|------|--------|-----------|
| Gap 3 — Accessibility (minimum viable) | Compliance | 1–2 days | EAA legal requirement since June 2025 |
| Gap 1 — JWT/key storage migration | Security | 1 day | Highest security impact item in the analysis |
| Gap 7 — useApiCall hook | Code quality | 2 hours | Natural complement to shared component library |

### Defer to Future Sprint

| Gap | Rationale |
|-----|-----------|
| Gap 6 — Empty locales dir | Decision needed (remove or populate), low urgency |
| Gap 8 — View splitting | Will improve naturally as Phase 1/2 land |
| Gap 9 — Router extraction | Defer until view count grows |
| Gap 11 — Preact Signals | Evaluate post-component-library |
| Gap 12 — View Transitions | Polish, not urgent |
| Gap 13 — JSDoc annotations | Add incrementally as components are authored |
| Gap 14 — Build pipeline | Defer; gzip covers most of the benefit |

---

## Sprint Plan vs Analysis Coverage

| Analysis Section | Sprint Coverage |
|-----------------|----------------|
| 3. Code Quality (ISSUE-1: inline CSS) | Phase 2 — full coverage |
| 3. Code Quality (ISSUE-2: legacy HTML) | **Missing — Gap 4** |
| 3. Code Quality (ISSUE-3: embedded i18n) | Phase 4 — full coverage |
| 3. Code Quality (ISSUE-4: empty locales dir) | **Missing — Gap 6** |
| 3. Code Quality (ISSUE-5: error handling) | **Partial — Gap 7** |
| 3. Code Quality (ISSUE-6: large views) | **Missing — Gap 8** |
| 3. Code Quality (ISSUE-7: Three.js CDN) | Phase 6.3 — covered |
| 4. Architecture (missing components) | Phase 1 — full coverage |
| 4. Architecture (router in shell) | **Missing — Gap 9** |
| 5. DX (view template) | **Missing — Gap 10** |
| 6. Portal documentation | Phase 7.1 — covered |
| 7. Security (CSP) | Already done (pre-sprint) |
| 7. Security (CORS wildcard) | Not applicable — open protocol by design |
| 7. Security (JWT localStorage) | **Missing — Gap 1** |
| 7. Security (dangerouslySetInnerHTML) | **Partial — Gap 2** |
| 7. Security (CDN supply chain) | Already done (pre-sprint) |
| 7. Security (auth retry) | Phase 6.1 — covered |
| 7. Security (rich text sanitization) | Phase 6.2 — covered |
| 8. Accessibility | **Entirely missing — Gap 3** |
| 9. Performance (gzip) | **Missing — Gap 5** |
| 9. Performance (Three.js lazy load) | Phase 6.3 — partial |
| 9. Performance (build pipeline) | **Missing — Gap 14** |
| 10. Modern patterns (Signals) | **Missing — Gap 11** |
| 10. Modern patterns (View Transitions) | **Missing — Gap 12** |
| 10. Modern patterns (JSDoc) | **Missing — Gap 13** |
