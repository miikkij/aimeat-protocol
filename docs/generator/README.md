# Generator Docs — Building AIMEAT Apps via the Prompt-Driven Workflow

> **Audience:** an AI agent (or advanced human dev) that builds a complete, working
> AIMEAT application **autonomously**, by following the generator's **prompt-driven
> workflow** (the human copy-paste path) instead of the incomplete LLM-autopilot path.
>
> **What this set covers:** the full journey from *profile → Generator → "+ New
> Project"* to a finished, browser-tested app — every step, every prompt in order,
> the exact format of every artifact (CSM, MSM, Memory, Translation, Extension,
> Cortex, App), how each is registered and activated, and how to verify the result
> by driving a real browser.

---

## Why the prompt-driven path

AIMEAT's generator has two paths:

- **Prompt-driven workflow (human path) — USE THIS.** The generator composes a
  prompt, a human (or an agent acting as one) runs it in any AI chat, and pastes
  the result back. The system validates, registers, activates, and tests each piece.
  This path is proven and is what this documentation teaches.
- **LLM autopilot — do NOT rely on this.** The fully-automatic mode is incomplete
  and not the path to use.

An agent can run the *entire* prompt-driven path by itself: it plays **both** the
interviewer and the interviewee to produce the spec from a one-line idea, then drives
the pipeline component-by-component. The "copy-paste to a chat" step becomes "run the
prompt against myself, capture the output, submit it."

The core pattern is AIMEAT's **promptipohjainen työnkulku**: the app composes prompts,
shows them for running, accepts and validates responses, and threads relevant parts of
earlier responses into later prompts. The work lives in the *prompt text*, not in UI
buttons or backend logic.

---

## The pipeline at a glance

```
+ New Project
   └─ Interview prompt ........... run it → structured JSON spec
        └─ Spec-quality gate ..... automated checks (URLs verified, sampleEntry, ≥2 use cases…)
             └─ Blueprint prompt .. run it → components + phases + dataModel($ref) + testScenarios
                  └─ Settings ..... enter service/user setting values
                       └─ PER-COMPONENT LOOP (in phase order):
                            CSM → Memory → Translation(s) → [MSM] → Extension
                                 → Data cortex → Component cortexes → App-domain cortex → App
                            each: prompt → (spec) → code → submit/validate → register
                                  → activate (ext/cortex) → probe → test → next
                                 └─ Final browser test (drive the app, walk every use case)
                                      └─ Complete
```

Layered architecture the blueprint produces (data flows **up**, control flows **down**):

```
App (HTML/CSS/JS)              calls cortex public methods only
  └─ App-domain cortex         composes views, owns auth + i18n + nav + business logic
       └─ Component cortexes    reusable UI pieces: render(container, props) → {el,destroy,update}
            └─ Data cortex      wraps extension actions + AIMEAT.data into clean async methods
                 └─ Extension   server-side sandbox: external fetch, schedules, owns ext:{name}
                      └─ Node storage (memory + files), agents (GAII)
```

---

## Read in this order

| # | Doc | What it gives you |
|---|-----|-------------------|
| 0 | [Agent Playbook](./00-agent-playbook.md) | The mental model + the end-to-end idea→app checklist. **Start here.** |
| 1 | [The Prompt-Driven Workflow](./01-prompt-driven-workflow.md) | Every pipeline step mapped to the real generator REST endpoints, success criteria, and the full failure matrix. |
| 2 | [Every Prompt in Pipeline Order](./02-prompts-in-order.md) | The firing order of every prompt, where each is sourced, and the full interview + blueprint prompt skeletons. |
| 3 | [Define + Seed Artifacts](./03-spec-define-seed.md) | Formats for CSM, MSM, Memory, Translation (the declarative artifacts). |
| 4 | [Extension](./04-spec-extension.md) | Manifest + action scripts + the real `ctx` API + activate/probe. The deepest artifact. |
| 5 | [Cortex + App](./05-spec-cortex-app.md) | Cortex (data / component / app-domain) and the app: formats, examples, install/activate. |
| 6 | [Registration & Activation Reference](./06-activation-registration-reference.md) | Grep-friendly table of every register/activate endpoint + MCP tool, with gotchas. |
| 7 | [Browser Testing](./07-browser-testing.md) | Verifying the finished app by driving a real browser via Playwright MCP. |

---

## Artifact glossary

| Artifact | What it is | Activates? | Format doc |
|----------|-----------|-----------|-----------|
| **CSM** | Community Service Manifest — data schema + consent + identity (YAML) | No (declarative) | [03](./03-spec-define-seed.md) |
| **MSM** | Micro Service Manifest — external API integration (auth, endpoints) (YAML) | No (declarative) | [03](./03-spec-define-seed.md) |
| **Memory** | Seed data — settings/config defaults + static datasets (one key per dataset) | No | [03](./03-spec-define-seed.md) |
| **Translation** | Per-locale i18n, flat dot-keys, locales mirror each other 1:1 | No | [03](./03-spec-define-seed.md) |
| **Extension** | Server-side sandbox: external fetch + schedules; owns `ext:{name}` | **Yes** (separate step) | [04](./04-spec-extension.md) |
| **Cortex (data)** | Client-side lib wrapping extension + `AIMEAT.data` into clean methods | **Yes** (auto on register) | [05](./05-spec-cortex-app.md) |
| **Cortex (component)** | Reusable UI piece — `render(container, props)` | **Yes** | [05](./05-spec-cortex-app.md) |
| **Cortex (app-domain)** | Composition layer — views + auth + i18n + nav | **Yes** | [05](./05-spec-cortex-app.md) |
| **App** | Thin HTML/CSS/JS shell; calls cortex public methods only | No (publish) | [05](./05-spec-cortex-app.md) |

---

## Source-of-truth notes (verified against code while writing these docs)

These caught real discrepancies between older guides and the running code. Trust the code.

- **Per-component prompt text lives in the database**, seeded from
  `aimeat/src/services/generator-prompt-seeds.ts` (variables use `{{name}}` syntax),
  fetched at `GET /v1/generator/:projectId/prompts/:componentId`. The **interview** and
  **blueprint** prompts still come from `aimeat/public/js/services/generator-prompts-build.js`
  (which is marked DEPRECATED for the per-component prompts). See [02](./02-prompts-in-order.md).
- **Agent path ≠ browser path.** The generator `/submit` + `/register` endpoints are
  the server-side **agent** path; the browser UI validates client-side and registers via
  the catalogue APIs directly. The agent path is the canonical one documented here. See [01](./01-prompt-driven-workflow.md).
- **Cortex auto-activates inside `/register`; extensions do not** — an extension needs a
  separate activate call. See [01](./01-prompt-driven-workflow.md) / [06](./06-activation-registration-reference.md).
- **Re-activating an active cortex silently skips init** — deactivate→activate (or
  delete→install→activate) to redeploy new code. See [05](./05-spec-cortex-app.md) / [06](./06-activation-registration-reference.md).
- **The real extension runtime has no `ctx.api` and no `ctx.task`**, and the REST install
  body is JSON `{ manifest, scripts }` (not a multipart ZIP). The older
  `docs/guides/building-extension-cortex-app-stack.md` is out of date on these points;
  [04](./04-spec-extension.md) documents the actual `ctx` surface.

---

## Related reading outside this folder

- [`docs/generator-guide.md`](../generator-guide.md) — the original generator design doc
  (partly aspirational; these docs supersede it where the code disagrees).
- [`docs/guides/building-extension-cortex-app-stack.md`](../guides/building-extension-cortex-app-stack.md)
  — narrative four-layer build guide (see the extension caveats above).
- [`docs/app-developer-ai-guide.md`](../app-developer-ai-guide.md) — using
  `AIMEAT.ai.complete()` from apps and cortex libs.
- [`docs/coding-guidelines/extension-memory-architecture.md`](../coding-guidelines/extension-memory-architecture.md)
  — the namespace trust boundaries with code references.
