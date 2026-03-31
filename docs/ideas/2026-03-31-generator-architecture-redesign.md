# Generator Architecture Redesign — Research & Analysis Brief

## Purpose

This document is a brief for a dedicated Claude session to research and design a new generator architecture for AIMEAT. The current generator/foundry/calibrator system has fundamental design flaws that limit output quality regardless of prompt calibration.

**Do NOT start implementing anything.** This is research and analysis only. The output should be a design document with options, trade-offs, and a recommended approach.

---

## Background: What Exists Today

The AIMEAT platform has three tools for generating services:

1. **Generator** (`public/views/profile/generator-tab.js`, `public/js/services/generator-prompts-*.js`) — Single-shot: one mega-prompt (~55K chars) → one blueprint JSON → generates all components sequentially. The prompt tries to design everything at once: extensions, cortexes, apps, data models, test scenarios.

2. **Foundry** (`public/views/profile/foundry-tab.js`) — Multi-pass: skeleton first, then fills each component. Was supposed to improve on generator with test-before-code passes. Has never produced a fully working app. Passes lose context about what previous passes decided.

3. **Calibrator** (`public/views/profile/calibrator-tab.js`, `src/routes/calibrator.ts`) — Iterative prompt improvement: runs a prompt against multiple candidate models, compares outputs structurally, gathers proposals from judge + self-reflection, synthesizes A/B/C option sets, applies selected proposals to create improved prompt versions. Works well as a tool but is currently calibrating a flawed mega-prompt.

## The Core Problem

The current system treats everything as one monolithic project:
- Extensions are designed FOR a specific app instead of as standalone platform capabilities
- One prompt tries to design server-side logic, client-side components, UI, data models, and tests simultaneously
- The 55K prompt is too large for most models to follow reliably
- Calibration improves adherence to a flawed pattern rather than fixing the pattern itself

## The Architectural Insight

AIMEAT has a clear layered architecture that the generator should respect:

```
APP (look & feel, navigation, user interaction)
  ↓ uses
CORTEXES (domain components — data, features, app-domain)
  ↓ uses
EXTENSIONS + AIMEAT BASE (memory, storage, boards, wallet, consent...)
  + SHARED CORTEXES (charts, forms, nav, dialogs, viewers...)
```

**Each layer has its OWN perspective — this is critical for the redesign:**

**Extensions** — Perspective: PLATFORM EXPANSION. "I am bringing a new capability to the AIMEAT platform." An extension knows NOTHING about any specific app or cortex that might use it. It only knows: what external data source or service am I connecting? What actions do I expose? What data do I store in memory? How do I schedule background work? A PRH company data extension is a platform capability — useful for ANY app, not designed for one.

**Cortexes** — Perspective: REUSABLE COMPONENT. "I am a domain component that wraps extensions + AIMEAT base capabilities into something easy to use." A cortex knows what extensions are available (their contracts/APIs) and what AIMEAT platform features exist (memory, storage, boards, etc). It provides clean methods and optionally UI. It can use other cortexes (charts, forms, viewers). It does NOT know what app will consume it.

**Apps** — Perspective: USER EXPERIENCE. "I compose cortexes into a working application with look, feel, and navigation." An app knows what cortexes are available and their APIs. It does NOT know about extensions directly — it only talks through cortexes. It handles layout, styling, routing, and user interaction.

**Business/domain logic** — WHERE DOES IT LIVE? The current generator has no clear home for domain rules (validation, computed values, workflows, constraints like "a company can only be on the watchlist once"). This logic gets scattered across extensions, cortexes, and apps randomly. The answer is the **app-domain cortex** — NOT the data cortex (which is just a data access layer that fetches/stores/transforms). The app-domain cortex owns use cases, orchestrates workflows, enforces business rules, and composes features. The data cortex stays dumb. The research session should validate this and ensure the generation architecture makes the app-domain cortex the explicit home for all business logic.

**The generation system MUST maintain these separate perspectives.** The moment an extension prompt mentions "the app needs..." or a cortex prompt references extension internals, the separation is broken.

## What This Research Session Must Do

### Phase 1: Source Code Analysis

Read and analyze the current implementation comprehensively:

**Generator prompts** — Read ALL prompt files in `public/js/services/generator-prompts-*.js`. Assess:
- How are extensions currently described in the prompt? Are they treated as platform capabilities or as subordinate components?
- How does the prompt handle the relationship between extensions, cortexes, and apps?
- What does the blueprint JSON structure look like? What are its limitations?
- How are data flows defined? Are they correct?

**Foundry** — Read the foundry implementation. Assess:
- Why did multi-pass generation fail to produce working apps?
- How were contracts/interfaces passed between passes?
- What was lost between passes? Where did drift happen?
- What lessons can we learn from the foundry's failure?

**Calibrator** — Read the calibrator implementation. Assess:
- How effective is the calibration loop at improving output quality?
- What are the analysis/reflection/synthesis prompts doing well vs poorly?
- Can the calibrator be reused for focused per-layer prompts?
- What scoring improvements would matter for smaller, focused prompts?

**Extension system** — Read `src/services/extension-*.ts`, `src/routes/extensions.ts`, extension manifests. Understand:
- What does a well-designed extension look like from the platform perspective?
- What is the extension's contract (manifest, actions, memory keys, schedules)?
- How do extensions interact with the platform (ctx object, sandbox API)?

**Cortex system** — Read `src/routes/cortex.ts`, existing cortex bundles. Understand:
- What does a cortex component actually provide?
- How do cortexes compose with each other?
- What is a cortex's public API?

### Phase 2: Web Research

Search for how other people/systems have solved similar problems. Focus on:

**Multi-agent code generation systems:**
- What architectures work for generating layered applications?
- How do systems handle contract handoff between generation steps?
- What fails when you try to generate everything in one pass vs multiple passes?

**Prompt decomposition strategies:**
- How do people split large generation tasks into smaller focused prompts?
- What are the pitfalls of prompt chaining (context loss, drift, hallucination)?
- What techniques prevent drift between chained prompts?

**Extension/plugin systems generation:**
- Are there systems that generate plugins/extensions separately from the apps that use them?
- How do they maintain the contract between plugin and consumer?

**What has NOT worked well (prioritize failures over successes):**
- What are common failure modes in multi-step code generation?
- Why do generated components fail to integrate?
- What causes "works in isolation, breaks when composed"?
- What are the limits of LLM-based code generation for complex architectures?

### Phase 3: Design Options

Based on Phase 1 + Phase 2 findings, propose 2-3 architectural options:

**For each option, specify:**
- How extensions are designed and generated (separately? same system? different system entirely?)
- How cortexes are designed and generated
- How apps are designed and generated
- How the master plan/blueprint works
- How contracts between layers are maintained
- How testing works at each layer
- How the calibrator fits in
- What prompts are needed (count, approximate size, purpose)
- What the user workflow looks like (how many steps for the user?)
- Known risks and failure modes
- Complexity estimate

**Key questions each option must answer:**
1. Can an extension be designed WITHOUT knowing what app will use it?
2. Can a cortex be designed knowing ONLY the extension's contract (not its internals)?
3. Can an app be designed knowing ONLY the cortex's API (not extension details)?
4. How do we verify contracts between layers WITHOUT running an LLM?
5. How do we prevent drift between generation steps?
6. Where does the calibrator add the most value?

### Phase 4: Recommendation

Pick the best option and explain why. Be honest about trade-offs. If none of the options are clearly superior, say so and explain what additional information/prototyping is needed to decide.

## Important Constraints

- **Budget**: We use cheap OpenRouter models ($0.08-$0.30/M tokens). Solutions must work with these, not require GPT-5 Pro or Claude Opus.
- **Prompt-driven workflow**: AIMEAT's core pattern is: app generates prompts, user copies to their AI chat, brings results back. The system should support both automated (via OpenRouter) and manual (copy-paste) workflows.
- **Existing calibrator**: The Calibrator V2 works well. Any new system should leverage it for prompt improvement, not replace it.
- **Incremental migration**: We can't rewrite everything at once. The design should allow incremental migration from the current generator.
- **Extensions are first-class**: Extensions expand the AIMEAT platform. They are NOT subordinate to any specific app. This is non-negotiable.

## Output Format

Write the findings as a markdown document: `docs/analysis/2026-03-31-generator-architecture-analysis.md`

Structure it as:
1. Current System Analysis (findings from Phase 1)
2. External Research (findings from Phase 2)
3. Design Options (2-3 options from Phase 3)
4. Recommendation (from Phase 4)
5. Next Steps (what to build first to validate the approach)
