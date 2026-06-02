# Testing the Finished App Automatically in the Browser

> **Audience:** an AI coding agent (and advanced human devs) that has just generated, registered and activated every component of an AIMEAT app via the prompt-driven workflow, and now must prove the finished app actually works.
> **This doc covers:** why driving a real browser (Playwright MCP) is the mandatory verification path; the Playwright MCP tool set and snapshot-driven interaction; a concrete end-to-end verification procedure mapped to interview use cases; the generator's own in-pipeline testing machinery (smoke test, probes, probe reconciliation, the browser test-page route) so you know what already ran before this final step; and the reporting rule (evidence before assertions).
> **Read first:** [Agent playbook](./00-agent-playbook.md), [Activation & registration reference](./06-activation-registration-reference.md). The app/cortex formats and their activation are in [Cortex & App formats](./05-spec-cortex-app.md).

---

## 1. Why browser-driving is the verification path

CLAUDE.md **Rule 1b** is explicit and overrides any default behaviour:

> Frontend changes must be verified by **driving a real browser through the Playwright MCP server** — open the page, log in, click through the actual feature, and observe that it works.
> **Do NOT write or run the `.spec.ts` Playwright suite** (`pnpm test:playwright:*`). That suite is unreliable and is not the verification path for frontend work.

A generated AIMEAT app is pure frontend (an `app.html` plus its cortex libraries). So the finished-app check is a frontend change in Rule 1b's sense and must be verified the same way: the agent opens Chrome through the Playwright MCP tools, reaches the authenticated state, performs the real user interactions each use case implies, and confirms the expected result actually happens — not just that the page loaded.

**The running target is the dev server:** `pnpm dev` on **port 40050**. Confirm it is up before driving the browser (poll `http://localhost:40050/v1/portal` until it returns 200). If you started/regenerated cortex or app JS, restart `pnpm dev` first — public JS is cache-busted by `BUILD_ID`, which only changes on server restart, so the browser would otherwise reuse stale modules.

> Note the distinction: Sections 4 below describes the generator's **in-pipeline** tests (smoke, probe, per-component `POST /test/...`), which DO use Playwright internally on the server. That is fine — it is the generator's machinery. What Rule 1b forbids is *you* running the `.spec.ts` suite as your verification. Your verification is driving the browser yourself via the Playwright **MCP** tools.

---

## 2. The Playwright MCP tool set

The Playwright MCP server is configured in `.mcp.json`. You drive a real Chrome instance through these tools (one-line purposes):

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open a URL (e.g. the app's inline URL or `/v1/profile`). |
| `browser_snapshot` | Capture the **accessibility tree** of the current page — the primary way to "see" the page and obtain element **refs** for interaction. |
| `browser_click` | Click an element identified by its snapshot ref. |
| `browser_type` | Type text into a focused/identified input (supports submit). |
| `browser_fill_form` | Fill several form fields at once (login forms, settings). |
| `browser_select_option` | Choose an option in a `<select>`. |
| `browser_press_key` | Press a key (Enter to submit a search, Escape to close a dialog). |
| `browser_hover` | Hover an element (reveal menus/tooltips). |
| `browser_wait_for` | Wait for text to appear/disappear or a timeout — use after async data loads. |
| `browser_take_screenshot` | Save a PNG as evidence of a verified state. |
| `browser_evaluate` | Run JS in the page (inspect `window.AIMEAT`, read DOM text, check `localStorage`). |
| `browser_console_messages` | Read console output — used to assert **no errors** were logged. |
| `browser_network_requests` | List network calls — confirm the app hit `/v1/cortex/...`, `/v1/ext/...`, `/v1/memory/...` and got 2xx. |
| `browser_resize` | Resize the viewport to verify responsive layout (mobile vs desktop). |
| `browser_navigate_back`, `browser_tabs`, `browser_handle_dialog`, `browser_file_upload`, `browser_drag`/`browser_drop` | Back navigation, tab management, native dialogs, uploads, drag-and-drop, when a use case needs them. |

### Snapshot-driven interaction (the core loop)

You do **not** guess CSS selectors. The loop is:

1. `browser_snapshot` → returns the accessibility tree with a `ref` for each interactive element (e.g. `button "Search" [ref=e12]`).
2. Use that `ref` in `browser_click` / `browser_type` / `browser_hover`.
3. After an action that triggers async work, `browser_wait_for` the expected text, then `browser_snapshot` again to observe the new state.

Take a fresh snapshot after every navigation or state change — refs are only valid for the snapshot they came from.

---

## 3. Concrete procedure to verify a generated app

### 3.1 Reach the app

A generated app is published as an `app.html` owned by the user. The download/inline route is:

```
GET /v1/apps/:owner/:filename            → download (raw HTML)
GET /v1/apps/:owner/:filename?mode=inline → served with a relaxed CSP so the app can run its scripts and call /v1/ APIs
```

(verified in `aimeat/src/routes/apps.ts` — `:owner` is the owner **name**, e.g. `happyadmin`, and `:filename` is the published filename, e.g. `my-app.html`. The publish/upload response returns both `download_url` and `inline_url` directly — see `aimeat/src/routes/upload.ts`.)

For interactive verification, open the **inline** URL so scripts and API calls work:

```
http://localhost:40050/v1/apps/<owner>/<filename>?mode=inline
```

You can also reach it through the profile (`/v1/profile` → Apps tab → Open) if you want to confirm the listing surface too.

### 3.2 Reach the authenticated state

Most apps call `init()` which initialises `AIMEAT.auth` and reads owner memory — so you need a logged-in session.

- Log in with the **dev owner account**. Those credentials live in the agent's saved memory (`dev-login-credentials`) — **do not hardcode them in this doc or in any committed file**. Use `browser_fill_form` / `browser_type` on the login form, then submit.
- After login, navigate (or re-navigate) to the inline app URL. Confirm via `browser_evaluate` that `window.AIMEAT` and the app-domain cortex (`window.AIMEAT.<libName>`) exist, and that `init()` returned a session.

### 3.3 Exercise every use case

For **each** `useCase` in the interview spec (the same list the integration test in §4 is built from), do a real interaction and assert a real outcome:

1. Snapshot the page, find the relevant control (nav item, search box, button) by ref.
2. Perform the interaction (`browser_click`, `browser_type` + Enter, `browser_fill_form`).
3. `browser_wait_for` the expected result text/element (data loads are async — give them time).
4. Snapshot again and **assert the expected outcome**:
   - Real content appears (search returns actual results from the extension, not mock data).
   - **No raw i18n keys** are visible in the DOM (no literal `app.title`, `tab.search`, etc. — those mean a translation key wasn't resolved).
   - **No `[object Object]`** rendered (means an object was stringified instead of formatted).
   - Persisted actions persist: add → navigate away → return → it's still there.
5. After interactions, call `browser_console_messages` and assert **no errors**, and `browser_network_requests` to confirm the API calls succeeded (2xx, not 4xx/5xx).
6. `browser_take_screenshot` of the verified state as evidence.

### 3.4 Responsiveness

If the interview spec's `style.displayContext` requires mobile + desktop, use `browser_resize` to a narrow viewport (e.g. 390×844) and a wide one (e.g. 1280×800), snapshot/screenshot each, and confirm the layout adapts (nav collapses, content reflows) without overflow or hidden controls.

---

## 4. The generator's OWN in-pipeline testing machinery

Before the final browser verification, the generator already runs several checks per component. Knowing what they did tells you what is *already* proven and what the browser test still needs to cover. (Sources: `aimeat/public/js/services/generator-smoke.js`, `generator-testing.js`, `generator-probe-reconcile.js`, `generator-spec-tests.js`, and the handlers in `aimeat/src/routes/generator.ts`.)

### 4.1 Smoke test — "does it load at all?"

`smokeTest(type, registeredAs, session)` (`generator-smoke.js`) is a quick load/parse check that catches most failures in seconds:

- **Extension:** `POST /v1/extensions/<name>/activate` — passes if it activates without an error envelope.
- **Cortex:** `GET /v1/cortex/<name>/libs/<name>.js`, then `new Function(code)` — passes if the JS is reachable and parses without a syntax error.
- **App:** `GET /v1/apps/<owner>/<filename>` — passes if the HTML is reachable (HTTP 2xx).
- CSM / memory / translation types need no smoke test (returns passed).

### 4.2 Mandatory probes — capturing golden samples

After an extension is registered, the pipeline **probes** every action with test inputs and captures the **real JSON responses** ("golden samples") so they can be injected into the cortex/app prompts that follow. The endpoint:

```
POST /v1/generator/:projectId/probe-extension
body: { extensionName, scenarios: [{ action, input }, ...] }
```

It calls `POST /v1/ext/<extensionName>/<action>` for each scenario and returns `{ extensionName, results: [{ action, input, status, response }] }`, where `response` is the **unwrapped** envelope `data` (verified in `generator.ts` — it returns `body.data ?? body`). Client helper: `probeExtension(projectId, extensionName, scenarios)` in `generator-testing.js`.

> callExt path reminder: actions are invoked at `/v1/ext/{name}/{action}` — not `/v1/extensions/.../actions/...`.

### 4.3 Probe reconciliation — has the API drifted?

`reconcileProbe(goldenSample, sampleEntry)` (`generator-probe-reconcile.js`) compares the probe's actual top-level field names and value types against the interview's `dataSources[].sampleEntry`. It returns `{ matches, diffs }`, flagging fields that are missing, newly appeared, or changed type — a cheap early warning that the external API changed or the sample data is stale, before that bad shape propagates into cortex/app code.

### 4.4 Per-component tests (spec-driven) and the browser test-page

Tests are **generated from the spec**, not from the code — "spec is king; if a test fails, the code is wrong, not the spec" (`generator-spec-tests.js`):

- `buildExtensionTestFromSpec(spec, extensionName)` → **server**-side test code (uses `callExt` / `readExtMemory`, returns `{ passed, errors, details }`).
- `buildDataCortexTestFromSpec(spec)` → **browser** test code (uses `window.AIMEAT.<libName>`, sets `window.__testResults`).
- `buildIntegrationTest(appDomainSpec, useCases)` → **browser** end-to-end test that loads the full app, calls `init()` then `render()`, and walks **each use case** — checking for real content (no raw translation keys), real extension results (not mock data), and that add/remove operations persist.

Execution endpoint (one component at a time):

```
POST /v1/generator/:projectId/test/:componentId
body: { testCode, environment }   // environment: 'server' (HTTP) | 'browser' (Playwright)
```

(verified in `generator.ts`.) If `environment` is omitted it defaults to `'browser'` for `cortex`/`app` components and `'server'` otherwise. The handler **saves `testCode` onto the component record first**, then for browser tests points Playwright at the self-contained test page:

```
GET /v1/generator/test-page/:projectId/:componentId
```

This route (owner-auth, relaxed CSP) builds an HTML page that loads the platform UI cortexes, the project's cortexes in dependency order (data → component → app-domain), the component under test, and the saved `testCode`; Playwright then navigates there and reads `window.__testResults`. Screenshots captured during the run are written to disk and served by:

```
GET /v1/generator/:projectId/screenshots/:filename   // PNG, no auth (so <img src> works)
```

Client helper: `screenshotUrl(projectId, filename)` in `generator-testing.js`. There is also a legacy bulk endpoint `POST /v1/generator/:projectId/test` (level `none`/`basic`/`comprehensive`) that just lists components — the real work is the per-component endpoint above.

> If Playwright is not available on the server, browser per-component tests return `status: 'skipped'` (`errors: ['Playwright not available']`). That is a *skip*, not a pass — and it is exactly why your own Rule 1b browser-MCP verification is still required.

---

## 5. Reporting rule — evidence before assertions

Mirror CLAUDE.md Rule 1b in your report:

- **Report what you actually observed.** List the interactions you performed (navigated to X, logged in, clicked "Search", typed "test", waited for results) and the observed outcomes (N result cards appeared, watchlist persisted across navigation, console clean, all `/v1/...` calls 2xx). Attach screenshots as evidence.
- **Never claim it works without having driven it.** If you could not drive the browser — MCP server unavailable, dev server down, or no usable credentials — **say so explicitly** and report the app as *unverified*, rather than asserting success from the in-pipeline smoke/probe results alone (those prove "loads/parses", not "the use cases work").
- If a use case fails, report the failing step, the console/network evidence, and which component is the likely culprit (so it can be regenerated) — the spec stays; the code is what's wrong.

---

## 6. Ready-to-run checklist (use case → browser actions → pass criteria)

Run this once the dev server is up (`pnpm dev`, port 40050) and the app is published.

**Setup**

- [ ] `pnpm dev` up — `browser_navigate` to `http://localhost:40050/v1/portal` returns a page (poll until 200).
- [ ] Restarted `pnpm dev` after the last cortex/app JS regeneration (BUILD_ID refresh).

**Auth + load**

- [ ] `browser_navigate` to the login page; `browser_fill_form` with the dev owner creds (from memory, not hardcoded); submit; confirm logged-in state.
- [ ] `browser_navigate` to `http://localhost:40050/v1/apps/<owner>/<filename>?mode=inline`.
- [ ] `browser_evaluate`: `window.AIMEAT` and `window.AIMEAT.<appDomainLibName>` exist; `init()` returned a session.
- [ ] `browser_snapshot`: app shell + nav rendered; **no raw i18n keys**, **no `[object Object]`**.

**Per use case (repeat for EVERY `useCase` in the interview spec)**

| Step | Browser actions | Pass criteria |
|------|-----------------|---------------|
| Navigate to the view for this use case | `browser_snapshot` → `browser_click` the nav ref | The view changes; correct header/title text shown |
| Perform the primary interaction | `browser_type` + Enter / `browser_click` / `browser_fill_form` | Action is accepted (no error toast/dialog) |
| Wait for async result | `browser_wait_for` expected text | Real content appears — actual extension data, not mock |
| Assert outcome | `browser_snapshot` | No raw translation keys; no `[object Object]`; data shaped as expected |
| Assert persistence (if the use case writes) | navigate away, return, `browser_snapshot` | The added/edited item is still present |
| Assert clean run | `browser_console_messages`, `browser_network_requests` | No console errors; all `/v1/...` calls 2xx |
| Capture evidence | `browser_take_screenshot` | PNG of the verified state |

**Responsiveness (if `style.displayContext` requires it)**

- [ ] `browser_resize` to mobile (e.g. 390×844) → snapshot/screenshot → layout adapts, no overflow.
- [ ] `browser_resize` to desktop (e.g. 1280×800) → snapshot/screenshot → multi-column/wide layout intact.

**Report**

- [ ] Wrote the report from observed evidence (interactions + outcomes + screenshots), or explicitly stated the app is **unverified** because the browser could not be driven.

---

## See also

- [Agent playbook](./00-agent-playbook.md) — how an agent uses this whole material end-to-end.
- [Prompt-driven workflow](./01-prompt-driven-workflow.md) — the pipeline and generator API endpoints that lead up to this final test.
- [Activation & registration reference](./06-activation-registration-reference.md) — register/activate every component (the prerequisite to having an app to test).
- [Cortex & App formats](./05-spec-cortex-app.md) — app/cortex structure, the `init()`/`render()` contract, and inline-app activation.
- [Extension spec](./04-spec-extension.md) — the extension probe and `ctx` API behind the golden samples.
