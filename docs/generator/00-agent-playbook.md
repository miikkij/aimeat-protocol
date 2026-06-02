# Agent Playbook — Building an AIMEAT App via the Prompt-Driven Workflow

> **Audience:** an AI coding agent (and advanced human devs) building a complete, working AIMEAT application end-to-end by following the GENERATOR's prompt-driven workflow.
> **What this doc covers:** the big-picture mental model, the agent's dual role (interviewer *and* pipeline driver), a numbered idea→app checklist, the decision points (skip extension? need an MSM? one app or two?), the artifact glossary, a short failure-handling summary, and the golden rules.
> **Read next:** [The prompt-driven workflow & generator API](./01-prompt-driven-workflow.md), then [Every prompt in order](./02-prompts-in-order.md). The format/activation deep-dives live in [03](./03-spec-define-seed.md)–[06](./06-activation-registration-reference.md); browser testing in [07](./07-browser-testing.md).

This is the top-level hub. Depth lives in docs 01–07; this doc gives you the map and the procedure.

---

## 0. Which path you are on

There are two ways to drive the generator:

- **Prompt-driven (manual copy-paste) path — THIS IS THE SUPPORTED ONE.** A human (or an agent acting as one) copies each prompt the generator produces into an AI chat, gets a result, pastes it back, validates, registers, activates, tests. You — the agent — can play *both* sides of that copy-paste loop yourself: you generate the prompt, you answer it (you *are* the AI chat), and you submit the result.
- **Autopilot / LLM path — DO NOT USE.** An in-app autopilot that tries to run the whole pipeline with an LLM in one shot. It is incomplete (e.g. component/app-domain cortex tests fall through to the wrong prompt; the app is never tested — see `docs/superpowers/plans/2026-04-02-phase3-cortex-checklist.md`). Mention it only as "not the path to use."

Everything below describes the supported prompt-driven path.

---

## 1. The big picture

You start in the user's profile: **Generator tab → "+ New Project"**. You type a one-line idea, then walk a fixed pipeline:

```
+ New Project
   │  (one-line idea)
   ▼
INTERVIEW  ── interview prompt → you answer it → structured JSON spec
   ▼
SPEC QUALITY GATE  (automated, no AI: verified URLs? sampleEntry? ≥2 use cases? locale?)
   ▼
BLUEPRINT  ── blueprint prompt → JSON blueprint (components, phases, structures, memoryKeys, actions, testScenarios)
   ▼
SETTINGS   (enter initial values for service/user settings from the interview)
   ▼
PER-COMPONENT LOOP  (in blueprint phase order):
   generate → validate → (contract-verify) → register → activate → probe → test → next
   ▼
FINAL BROWSER TEST  (launch the app, walk every use case)  → see doc 07
```

### Layered architecture & data flow

The blueprint always lays the service out in layers. Each layer only ever talks to the one directly below it:

```
┌───────────────────────────────────────────────────────────────┐
│  APP  (HTML/CSS/JS, runs in browser)                          │
│  Thin shell: navigation, layout, responsive, user journey.    │
│  Calls ONLY cortex public methods (AIMEAT.{name}.method()).   │
└───────────────┬───────────────────────────────────────────────┘
                │ JS method calls (in-page)
                ▼
┌───────────────────────────────────────────────────────────────┐
│  APP-DOMAIN CORTEX  (browser IIFE, subtype: "app-domain")     │
│  Composes components + auth (AIMEAT.auth) + i18n + settings.   │
│  Single entry point: init() / render(). ALWAYS last cortex.   │
└───────────────┬───────────────────────────────────────────────┘
                │ composes
                ▼
┌───────────────────────────────────────────────────────────────┐
│  COMPONENT CORTEXES  (browser IIFE, subtype: "component")     │
│  Reusable UI pieces: card, badge, timeline, search-input.     │
│  Each renders ONE thing; uses platform UI libs (aimeat-ui-*). │
└───────────────┬───────────────────────────────────────────────┘
                │ data method calls
                ▼
┌───────────────────────────────────────────────────────────────┐
│  DATA CORTEX  (browser IIFE, subtype: "data")  — no UI        │
│  The ONLY gateway to data. Wraps extension actions +          │
│  AIMEAT.data / .storage / .social / .wallet into clean async  │
│  methods. Components never call the extension directly.        │
└───────────────┬───────────────────────────────────────────────┘
                │ callExt → POST /v1/ext/{name}/{action}   (auth)
                │ readExtMemory → GET /v1/memory/ext:{name}/{key} (public)
                ▼
┌───────────────────────────────────────────────────────────────┐
│  EXTENSION  (QuickJS/WASM, server-side)  — OPTIONAL           │
│  The ONLY layer that may: call external APIs (ctx.fetch),     │
│  run scheduled jobs (cron / @activate), do server-side work.  │
│  Owns the ext:{name} memory namespace.                        │
└───────────────┬───────────────────────────────────────────────┘
                │ persists / reads
                ▼
      AIMEAT NODE STORAGE  (memory: SQLite or MongoDB; file storage)
                ▲
                │ same /v1/ HTTP API, different identity (GAII JWT)
            AGENTS  (read/write the same memory keys, pick up tasks)
```

**Data flows up; control flows down.** An extension fetches external data and writes it into `ext:{name}` memory. The data cortex reads that (and owner memory) and exposes clean methods. Component cortexes render those methods' output. The app-domain cortex composes the components and adds auth/i18n. The app paints the result. Agents are *just another HTTP client* hitting the same memory keys with their own GAII — anything the app reads, an agent can read; anything an agent writes to owner memory, the app sees on next read.

> Backends are **SQLite and MongoDB only** (the in-memory backend is deprecated). This affects the node you run against, not what you build.

---

## 2. Your dual role

When you (an agent) run this workflow, you wear two hats:

1. **Interviewer + interviewee (produce the spec).** The generator hands you an *interview prompt* (a requirements-analyst persona with a strict question budget and a target JSON shape). On the human path a person would paste it into a chat and answer the questions. You run that same prompt **against yourself**: adopt the interviewer persona, answer its questions from the user's one-line idea (and any clarification the user gave you), and emit the structured JSON spec it asks for. You are the AI chat. The one thing you must not fabricate is **external data**: the interview's URL-validation protocol is mandatory — for every external URL you actually fetch it (or have the user fetch it) and paste a *real* `sampleEntry` + `responseEnvelope`. If you can't verify a URL, mark it `verified: false` with a `fallback` of `"demo"`, `"defer"`, or `"skip"`. Never invent an API response shape.

2. **Pipeline driver (build the app).** With the spec in hand you import it, get the blueprint prompt, produce the blueprint, save settings, and then walk the per-component loop — generating each artifact, validating, registering, activating, probing, and testing it before moving to the next. You play the AI chat at every "copy prompt → paste result" step.

Mechanically, the per-component prompt text is fetched from the node (`GET /v1/generator/:projectId/prompts/:componentId`), you answer it, and you submit the result back (`.../components/:componentId/submit` then `.../register`). The generator's HTTP routes accept an agent JWT with the `generator:write` scope, so you can drive the whole thing programmatically — see [doc 01](./01-prompt-driven-workflow.md) for the exact endpoints and ordering.

---

## 3. From idea to working app — the checklist

Follow these in order. Each step links to the doc with the real formats/endpoints.

1. **Create the project.** `POST /v1/generator/projects` with the one-line description (or click "+ New Project"). → [01](./01-prompt-driven-workflow.md)
2. **Get the interview prompt and answer it.** Adopt the interviewer persona, honour the URL-validation protocol, emit the spec JSON. Then import the spec. → prompt source in [02](./02-prompts-in-order.md); interview discipline in [01](./01-prompt-driven-workflow.md)
3. **Pass the spec quality gate.** Automated, no AI: every data source needs a verified URL + `sampleEntry`; ≥2 use cases; a `locale`; views reference real entities. Fix the spec if it fails. → [01](./01-prompt-driven-workflow.md)
4. **Generate the blueprint.** Get the blueprint prompt, produce the JSON blueprint (`structures` built from real `sampleEntry` data, `memoryKeys` + `actions` all using `$ref`), submit via `.../steps/blueprint`. → [02](./02-prompts-in-order.md); blueprint format in [03](./03-spec-define-seed.md)
5. **Save settings.** Enter initial values for any service/user settings the interview surfaced. → [01](./01-prompt-driven-workflow.md)
6. **Per component, in phase order — generate → validate → register → activate → probe → test:**
   - **DEFINE:** CSM (always), MSM (only if an external API needs auth). → [03](./03-spec-define-seed.md)
   - **SEED:** Memory (defaults + static data), Translation per locale (fi *and* en, identical keys). → [03](./03-spec-define-seed.md)
   - **CAPABILITY:** Extension (only if external API or scheduled work) — register, activate (`@activate` init runs), then **probe every action** to capture golden samples. → [04](./04-spec-extension.md)
   - **CORTEX (ordered):** data cortex first → component cortexes → app-domain cortex last. Register + activate + probe each. → [05](./05-spec-cortex-app.md)
   - **APP:** generate, register/publish, smoke-test. → [05](./05-spec-cortex-app.md)
   - Register/activate endpoints + MCP tool names for every type: [06](./06-activation-registration-reference.md)
7. **Final browser test.** Launch the app, log in, walk every use case from the interview, verify translations render (no raw keys), data loads, responsive layout works, console is clean. → [07](./07-browser-testing.md)

---

## 4. Decision points

Resolve these from the spec **before** you build — they change which components exist.

- **Do you need an extension at all?** An extension must do something a browser *cannot*: call an external API behind CORS/auth, run a scheduled cron job, or do trusted server-side work that must happen with no browser open. If none of those apply (a notes app on `AIMEAT.data`, a board app on `AIMEAT.social`, a file gallery on `AIMEAT.storage`, a dashboard reading memory + `AIMEAT.charts`), there is **no extension — skip the whole CAPABILITY phase**. The data cortex uses AIMEAT platform libraries directly instead of wrapping extension actions.
- **Do you need an MSM?** Only when the external API requires **authentication, API keys, or complex endpoint configuration**. Public URLs (open data, RSS feeds, open APIs) need **no MSM** — the extension fetches them directly with `ctx.fetch()`.
- **One app or an admin app too?** Default to a **single app**. Recommend a separate admin app *only* when the service is shared and has sensitive shared settings that warrant operator-only tooling (`adminAppRecommended: true` in the spec). Don't add an admin app without clear justification.
- **Monolithic vs. decomposed cortex?** Always decompose. Don't build one cortex per view; build a **data cortex + small reusable component cortexes + one app-domain cortex**. Ask "would this UI piece be useful in a different view?" — if yes, it's a component.

---

## 5. Artifact glossary

| Artifact | One line | Format doc |
|----------|----------|-----------|
| **CSM** (Community Service Manifest) | Data schema for a namespace + the service's identity; validates writes. | [03](./03-spec-define-seed.md) |
| **MSM** (Micro Service Manifest) | External API integration contract: auth, endpoints, rate limits. Only when API needs auth. | [03](./03-spec-define-seed.md) |
| **Memory** | Seed data: default settings + static lookup tables written before anything runs. | [03](./03-spec-define-seed.md) |
| **Translation** | User-visible text for one locale; flat dot-namespaced keys; fi & en must match 1:1. | [03](./03-spec-define-seed.md) |
| **Extension** | Server-side QuickJS/WASM code; the only layer that can call external APIs or run schedules; owns `ext:{name}`. | [04](./04-spec-extension.md) |
| **Cortex — data** | Browser IIFE, no UI; the sole data gateway wrapping extension actions + AIMEAT platform libs. | [05](./05-spec-cortex-app.md) |
| **Cortex — component** | Browser IIFE; one reusable UI piece (card, badge, timeline), uses `aimeat-ui-*` libs. | [05](./05-spec-cortex-app.md) |
| **Cortex — app-domain** | Browser IIFE; composes components + auth + i18n + settings; entry point for the app. | [05](./05-spec-cortex-app.md) |
| **App** | Thin HTML/CSS/JS shell; navigation + layout; calls only cortex public methods. | [05](./05-spec-cortex-app.md) |

---

## 6. Failure handling (summary)

The happy path is generate → validate → register → activate → probe → test → next. Every step can fail. Short version (full matrix in [01](./01-prompt-driven-workflow.md)):

- **Validate → fix.** On validation or contract-verification failure, re-prompt with the errors appended (the fix prompt). **Max 3 fix rounds**, then do a fresh generation from a clean slate with a "known pitfalls" list. Nothing downstream is affected — nothing was registered yet.
- **Reflection before fix.** When a *test* fails (not just validation), first run the **reflection prompt** to diagnose the root cause *without coding*, then feed that diagnosis into the fix prompt. Explain-then-fix repairs better than blind fixing.
- **Re-probe after any upstream fix.** Probe golden samples become stale the moment you change a component. After re-registering a fixed component, **re-probe it** so downstream prompts get the real shapes.
- **Cascade rule.** A fix can ripple **downstream only**, in this fixed order:
  `Extension → Data Cortex → Component Cortex → App-Domain Cortex → App`.
  Fix at the extension level → re-probe → check each downstream layer still references the right shapes → regenerate downstream in order if not. A fix at the app level affects only the app.
- **Test-bug vs. component-bug.** If the probe returned valid data but the test fails, the *test* is wrong (regenerate the test). If the probe also returned the wrong shape, the *component* is wrong (fix the component).

This whole machinery is why `structures` + `$ref` + mandatory probes exist: shared structure definitions and verified shapes catch drift at the layer it occurs, not at the app.

---

## 7. Golden rules

> - **Prompts define goals, not procedures.** Give the AI scope + frame + goal; let it choose the implementation. Over-specifying produces worse code than a clear goal.
> - **The spec is king.** Use cases, views, style, data sources all trace to the interview. When something is wrong, regenerate the *code*, not the spec — the spec is the source of truth.
> - **`structures` + `$ref` prevent drift.** Define each type once from real `sampleEntry` data; every component (`ext` stores it, cortex passes it, app renders it) `$ref`s the same definition. If `businessId` is `{value: "…"}`, every layer knows it's an object.
> - **Verify external data — never invent it.** Every external URL is fetched and given a real `sampleEntry` + `responseEnvelope`, or marked `verified:false` with a fallback. Never generate a parser from an assumed shape.
> - **Extension = server-only work.** External API, scheduled cron, server-to-server. If a browser can do it, it is **not** an extension. No "export", "settings", "filter", or "compute" extensions.
> - **Cortex is the brains; the app is a thin shell.** All data + logic + UI-piece rendering live in cortex. The app does layout, navigation, responsiveness — and calls only cortex public methods.
> - **Each layer talks only to the one below it.** App → app-domain cortex → components → data cortex → extension. The app never calls `callExt`, `/v1/ext/`, or raw memory routes.
> - **Reuse platform libs; never reinvent.** `AIMEAT.data/.storage/.social/.wallet`, `aimeat-ui-*`, `aimeat-charts`, `aimeat-canvas` already exist. If `DataTable` or `ChartPanel` does it, use it.
> - **Test immediately.** Each component is tested right after registration; the pipeline does not advance until it passes. Tests come from the blueprint contract + golden samples, **not** from the implementation code.
> - **Extension sandbox top-level rule.** The ONLY top-level statement in an action script is `export default async function(ctx, input){…}`. No top-level `const`/`let`/`function`/`class` — helpers go *inside*. Read owner data via `ctx.memory.getPublic(ctx.caller.gaii, key)`.
> - **`callExt` path is `/v1/ext/{name}/{action}`; `session.fetch` returns already-parsed JSON** — use `resp.data`, never call `.json()`. Re-activating an already-active cortex/extension is a silent no-op: deactivate then activate to deploy new code.

---

## See also

- [01 — The prompt-driven workflow & generator API](./01-prompt-driven-workflow.md)
- [02 — Every prompt in order, and where each is sourced](./02-prompts-in-order.md)
- [03 — Spec formats: CSM, MSM, Memory, Translation + activation](./03-spec-define-seed.md)
- [04 — Extension: manifest, scripts, `ctx` API, activation, probe](./04-spec-extension.md)
- [05 — Cortex (data/component/app-domain) + App formats + activation](./05-spec-cortex-app.md)
- [06 — Activation/registration reference: every endpoint + MCP tool](./06-activation-registration-reference.md)
- [07 — Browser-testing the finished app](./07-browser-testing.md)
- [README — overview + index](./README.md)
