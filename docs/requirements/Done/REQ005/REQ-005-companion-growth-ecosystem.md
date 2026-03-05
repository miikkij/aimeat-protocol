# REQ-005 Companion: Growth Ecosystem & Progressive User Journey

**Status:** Draft  
**Priority:** High — Defines how Cortex-Core becomes a platform, not just a feature  
**Type:** Strategy / UX / Architecture  
**Created:** 2026-03-04  
**Companion to:** REQ-005 (Cortex-Core — Dynamic Extension & Plugin System)

---

## 1. Overview

REQ-005 defines *what* Cortex-Core is technically. This document defines *how users grow into it* — the journey from a first HTML app built in AI Chat to publishing ontologies and libraries that thousands of others use.

The core thesis: **hunger grows by eating.** Each successful step must naturally reveal the next one. Users should never feel a hard threshold between "consumer" and "creator." The transition happens invisibly, driven by their own curiosity and output.

This document covers:

- The complete 5-level progressive journey (Levels 0–4)
- The Remix concept and its role in lowering the starting barrier
- App ↔ Cortex dependency declarations
- "Prompt as Product" and the Ontology component
- Lib validation via AI Chat (replacing server-side gatekeeping)
- The dual-mode learning system (Producer vs. Learner)

---

## 2. The Progressive Journey — All Five Levels

### Level 0 — First App (already exists)

**Entry point:** AI Chat with a starting prompt. No account required.

**What happens:**
- User describes what they want
- AI generates a single-file HTML app using AIMEAT libs
- User gets a download link or can save directly to AIMEAT apps catalogue

**Natural trigger to Level 1:**
> *"This app works, but it forgets everything when you close the tab. Want it to remember your data across sessions and devices?"*

**What the user never has to think about:** authentication, APIs, storage, deployment.

---

### Level 1 — AIMEAT Account + Apps Catalogue (already exists)

**Entry point:** Saving an app or wanting persistent data.

**What happens:**
- User registers (GUI, no terminal required — GHII registration via profile page)
- App is stored in AIMEAT — accessible from any device
- Memory API is now available to the app for persistent storage
- Profile page shows wallet, installed apps, registered agents

**Natural trigger to Level 2:**
> *"You've saved this app a few times with changes. It's starting to have real structure. Want to package it so others can install it in one click?"*

Or, when the user shares an app link and someone else says "I want one for my use case":
> *"Instead of rebuilding from scratch, you can Remix this — fork it and adapt it to your needs."*

---

### Level 2 — Cortex Extension Author (to be built)

**Entry point:** User wants to share, remix, or formalize an app's structure.

**What happens:**
- AI Chat generates a `cortex.yaml` from the user's existing app + memory schema + prompt history
- User reviews and approves — they don't write YAML manually
- Extension is published to the node's Cortex registry
- Others can discover it via `GET /v1/cortex/available` and install with one API call

**What Cortex-Core adds at this level:**
- Schema validation on memory writes (data integrity across apps)
- Reusable prompt templates accessible to any AI via MCP
- Pre-configured board templates for community sharing
- Action definitions registered in the catalogue

**Natural trigger to Level 3:**
> *"This UI component you built doesn't exist in AIMEAT's library. Want to turn it into a lib so others can use it? Attach the file here and we'll review it together."*

---

### Level 3 — Library Author (to be built)

**Entry point:** User hits a capability wall that existing libs can't solve, or wants to contribute a UI component they built.

**What happens:**
- User attaches a JavaScript lib file directly in AI Chat
- AI reviews it interactively (see Section 5 on lib validation)
- If approved by the user, it is published to `/v1/libs/`
- Other apps can now reference it via `<script src="https://aimeat.io/v1/libs/{name}.js">`
- Lib appears in apps catalogue with author attribution

**What the user learns:**
- What the lib does and why
- What security considerations matter (and why)
- How other apps will depend on it

**Natural trigger to Level 4:**
> *"What you're trying to build now goes beyond what AI Chat handles well. Claude Code or Codex can do this — want setup instructions?"*

---

### Level 4 — Local Development Environment (gateway, not destination)

**Entry point:** User wants local execution, multi-service integration, or production-grade tooling.

**What happens:**
- AIMEAT provides a clear handoff prompt: here's how to install Claude Code / Codex, here's the AIMEAT CLI, here's the Personal Node setup
- The work the user did in Levels 0–3 is fully portable — their apps, extensions, and libs are already in AIMEAT
- Local tools connect to AIMEAT via MCP connector or JWT auth, same as any agent

**This is a gateway, not a wall.** Most users will stay at Levels 1–3. Level 4 is for those who actively choose it.

---

## 3. The Remix Concept

### Problem it solves

Most users don't want to start from a blank prompt. They want to see something that almost fits and adjust it. The current flow forces them to describe everything from scratch, which is slow and produces worse results than starting from a concrete example.

### How Remix works

Every app in the AIMEAT apps catalogue has a Remix button. Clicking it:

1. Opens AI Chat with the app's source code pre-loaded (via Storage API reference, not pasted inline — keeps context small)
2. AI presents a brief summary: *"This is a recipe collection app. It has a schema for recipes, a prompt for the recipe assistant, and a board for community sharing. What would you like to change?"*
3. User describes their variation: *"Make it for cocktail recipes and add a difficulty rating"*
4. AI produces the modified version — schema updated, prompt adapted, app ready
5. Saved as a new app with a `remixed_from` attribution link

### Context management in Remix

The source app is never pasted into the AI Chat context directly. Instead:
- AI Chat receives a structured summary (schema fields, prompt intent, action list) — typically under 200 tokens
- Full source is fetched from Storage API only when a specific section needs editing
- This keeps the context window clean even for complex apps

### Attribution

```yaml
# app metadata
remixed_from: "@original-author/recipe-collection@1.2"
remix_chain:
  - "@original-author/recipe-collection@1.2"
  - "@second-author/cocktail-collection@1.0"
```

Remix chains are preserved. Credit flows back through the chain. If the morsel economy extends to apps, attribution enables royalty-style flows.

---

## 4. App ↔ Cortex Dependency Declarations

### Problem it solves

Without explicit dependency declarations, an app installed from the catalogue may silently fail because its required Cortex extension is not active on the user's node. The user sees broken behavior with no explanation.

### Proposed app manifest addition

Every app stored in AIMEAT apps catalogue carries a lightweight manifest:

```yaml
name: "@jouni/cocktail-collection"
version: "1.1.0"
description: "Cocktail recipe manager with difficulty ratings"
author: "jouni"
remixed_from: "@jouni/recipe-collection@1.2"

requires_cortex:
  - "@jouni/recipe-collection@>=1.0"

requires_libs:
  - "aimeat-core@>=2.0"
  - "aimeat-ui-components@>=1.5"

requires_aimeat: ">=1.5"
```

### Install-time behavior

When a user installs an app that has `requires_cortex` entries:

1. AIMEAT checks which dependencies are already active on the node
2. For missing ones: *"This app needs the Recipe Collection extension. Install it now?"*
3. One-click install of the dependency, then the app
4. If a dependency is unavailable (not on this node, not in federation): clear error with instructions

This makes dependency resolution visible without being technical. The user understands *what* they're getting and *why*.

---

## 5. Lib Validation via AI Chat

### Philosophy

Server-side automated scanning creates a false sense of security and removes learning from the process. A lib that passes a linter may still do something harmful in context; a lib that triggers a warning may be perfectly legitimate.

The better model: **the author is the first and primary reviewer.** AI Chat facilitates this, making it educational rather than bureaucratic.

### The flow

1. User attaches their `.js` lib file directly in AI Chat
2. AI reads the file and produces a structured review:

```
Review of: aimeat-calendar-picker.js (342 lines)

What it does:
  - Renders a date picker component
  - Reads/writes to AIMEAT memory under the key pattern "calendar/*"
  - Exports: AIMEAT.register('calendar-picker', CalendarPicker)

Potential concerns:
  ⚠️  Line 87: fetch() call to api.example.com — is this intentional?
      If yes, document it. Other users' data will leave their browser.
  ✓   No eval() or Function() usage
  ✓   No access to document.cookie or localStorage
  ✓   AIMEAT token is not logged or transmitted externally

Questions for you:
  1. The fetch on line 87 — what is it for?
  2. Should this lib work offline (no external calls)?
```

3. User answers, AI updates the review or asks for a code change
4. When the user is satisfied: *"This looks good to me and I understand what it does. Publish it."*
5. Server runs a minimal static check (presence of `eval`, `Function()`, obvious token exfiltration patterns) — this is a safety net, not a gate
6. Lib is published with a "reviewed by author in AI Chat" flag

### What users learn in this process

- What their own code actually does (often surprising)
- Which patterns are risky and why
- What documentation other users will need
- How to write better libs the next time

### Server-side static check (lightweight, not a gate)

The server checks for a short list of high-confidence danger signals:

- `eval(` or `new Function(`
- `document.cookie`
- `fetch(` to domains not in AIMEAT's approved list (unless author explicitly declared external calls)
- `XMLHttpRequest` to external domains

If triggered, the user sees a warning — not a block. They can acknowledge and publish anyway. The decision and the responsibility stay with the author.

---

## 6. Prompt as Product + Ontology Component

### Prompt as Product

The insight: domain expertise is valuable and transferable, even without code. A restaurant professional who writes the definitive prompt for menu planning is contributing something with real worth to the ecosystem — agents using that prompt perform better than agents without it.

The flow:

1. User opens AI Chat: *"I want to share what I know about [domain] as a prompt that others can use"*
2. AI interviews the user — asks about concepts, workflows, edge cases, terminology
3. AI produces a `cortex.yaml` with a `prompt` component capturing the domain knowledge
4. User reviews, adjusts, publishes

The prompt lives in AIMEAT memory under `__cortex__/{ext_name}/prompts/{name}` and is discoverable via MCP tool `aimeat_get_prompts`. Any agent on any node with the extension installed can use it.

### The Ontology Component

When a domain expert shares their knowledge, the prompt alone is not the most powerful artifact. An ontology — a structured map of the domain's concepts and their relationships — makes that knowledge *machine-readable*.

**What an ontology enables:**

- Agents can reason about domain relationships without being told explicitly
- Multiple domain ontologies can combine: `recipe` + `shopping-list` + `dietary-restriction` → an agent that can plan meals without being instructed about the connections
- AI Chat performs better and faster when it has an ontology available — fewer clarification loops
- Future agents trained or fine-tuned on AIMEAT data benefit from structured domain signal

**Proposed `ontology` component type for `cortex.yaml`:**

```yaml
- type: ontology
  namespace: "restaurant"
  version: "1.0"
  description: "Core concepts in restaurant operations and menu management"
  triples:
    - [menu-item, is-a, product]
    - [menu-item, has, ingredient]
    - [menu-item, has, allergen-tag]
    - [menu-item, belongs-to, menu-section]
    - [menu-section, part-of, menu]
    - [menu, has-property, season]
    - [allergen-tag, instance-of, [gluten, dairy, nuts, shellfish]]
    - [recipe, produces, menu-item]
    - [prep-time, unit-of, minutes]
```

**Ontology generation in AI Chat:**

> *"Tell me the key concepts in your field and how they relate to each other. We'll turn this into a structured ontology that helps AI assistants understand your domain faster."*

User describes their domain in plain language. AI extracts concepts, proposes relationships, user corrects. The resulting ontology is attached to the prompt extension. Non-technical users can produce this — it requires domain knowledge, not programming knowledge.

**Ontology as differentiator for AIMEAT:**

Most memory protocols store facts. AIMEAT with ontologies stores *understanding*. An agent operating in a node with a rich ontology library performs categorically better than one without. This creates a compounding advantage — the more ontologies in the ecosystem, the more valuable the platform becomes for every user.

---

## 7. Dual-Mode Learning System

### The problem with a single mode

Some users want to produce. Interrupting them with explanations is friction, not value. Other users want to understand what they're building. Giving them only output, with no explanation, leaves them dependent on AI forever.

Both needs are valid. The system should serve both without forcing a choice upfront.

### Two modes

**Producer Mode (default)**

- AI returns the artifact. No explanation unless asked.
- Fast, output-focused, respects the user's time.
- Appropriate for experienced users and for tasks the user already understands.

**Learner Mode (opt-in)**

- AI returns the artifact AND a short explanation of what was built and why.
- Each significant decision is surfaced: *"I used a schema lock here because..."*
- A single optional follow-up question: *"Want to understand how the prompt component works?"*
- Explanation depth scales with the user's engagement — one follow-up answer goes deeper.

### How the mode is set

- Explicitly: a toggle in profile settings, visible on the AI Chat interface.
- Default: **Producer Mode.** The majority of users want results.
- Implicitly: if a user asks "why" or "how does this work" in AI Chat, the system detects it and offers: *"It looks like you want to understand what's happening. Want to switch to Learner Mode for this session?"*

### Why "Learner Mode" and not "Tutorial Mode"

"Tutorial" implies a fixed curriculum. "Learner Mode" is responsive — it adapts to what the user is actually building, right now, in this session. The learning is always directly relevant because it's always attached to real output the user cares about.

---

## 8. Context Management Strategy for Complex Apps in AI Chat

Keeping AI Chat usable as app complexity grows requires a deliberate strategy. Complex apps cannot and should not live entirely in the context window.

### The thin-shell pattern

Every app built in AI Chat has two layers:

**Shell (always in context):** Configuration, routing, business logic specific to this app. Typically under 100 lines. This is what the AI edits.

**Substance (referenced, not pasted):** AIMEAT libs, cortex prompts, schema definitions. Loaded at runtime by the browser. The AI knows they exist and what they do, but never sees their full source.

```html
<!-- Shell — AI manages this -->
<script src="https://aimeat.io/v1/libs/aimeat-core.js"></script>
<script src="https://aimeat.io/v1/libs/aimeat-ui.js"></script>
<script>
  AIMEAT.app({
    cortex: "@jouni/recipe-collection",
    views: ["list", "detail", "add"],
    theme: "dark",
    onLoad: async () => {
      const recipes = await AIMEAT.memory.list("recipes/*");
      AIMEAT.ui.render("list", recipes);
    }
  });
</script>
```

The AI only needs to know the lib's API surface — documented in a compact reference that fits in the system prompt. It never needs to see the lib's 800 lines of implementation.

### Mid-session save and context reset

When a session grows long and the context is becoming crowded:

1. Current app state is saved to AIMEAT Storage API with a version timestamp
2. AI Chat offers: *"The context is getting full. I've saved your progress. Want to continue in a fresh session? I'll start with a summary of where we are."*
3. New session starts with a compact state summary (under 300 tokens) rather than full history
4. User continues without losing work

### Versioning

Every save to AIMEAT apps catalogue creates a timestamped snapshot. The default is save-and-overwrite with a recoverable history (last N versions retained). Users who want explicit version control can use save-as-new-version naming: `cocktail-collection-v2`.

No work is silently lost.

---

## 9. Success Criteria for This Document

The growth ecosystem described here succeeds when:

1. A user who came to make one app has, six months later, published a Cortex extension that others are using — without ever feeling like they crossed a threshold into "developer" territory.
2. A domain expert with no programming background has shared a prompt + ontology that measurably improves agent performance for others in their field.
3. A lib authored entirely in AI Chat is running in production in apps by other users.
4. Remix chains exist with 3+ generations of derivation, with attribution preserved throughout.
5. Learner Mode users graduate to Producer Mode on topics they've learned, while staying in Learner Mode on new domains — the system adapts to their growing knowledge.

---

## 10. Open Questions

- [ ] Ontology format: RDF-like triples (as shown) vs. simpler key-value relationship map? Triples are more expressive but harder to author. Consider a simplified AIMEAT-native format that compiles to RDF internally.
- [ ] Ontology merging: when two extensions both define `recipe`, how are conflicts resolved? Namespace priority? Union? User choice?
- [ ] Remix attribution and morsel economy: if the morsel micro-economy extends to apps and libs, how does value flow back through remix chains?
- [ ] Learner Mode memory: does the system remember that a user has already learned a concept and stop explaining it in future sessions?
- [ ] Lib expiry and maintenance: what happens to a lib when its author is inactive and a security issue is found? Community fork? Deprecation notice?
- [ ] Ontology discovery for agents: should MCP expose a `aimeat_query_ontology` tool so agents can query domain relationships directly?

---

*Document created: 2026-03-04*  
*Authors: Jouni Miikki (concept), Claude Sonnet 4.6 (drafting)*  
*Companion to: REQ-005-cortex-core-extension-system.md*
