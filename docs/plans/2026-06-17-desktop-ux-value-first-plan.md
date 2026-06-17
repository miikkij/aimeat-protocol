# Desktop UX — value-first redesign + language selection — Plan

**Date:** 2026-06-17
**Status:** Draft for developer approval (no UI work started beyond this document).
**Context:** Apply the same "reward first / do → get" thinking we used on the web landing
(`landing.js`) to the **desktop app** (`aimeat-desktop/src/index.html`), and add language
selection (FI/EN). Same question as the landing: *because you do something, you get something* —
how does that land for a normal person on the desktop?

## Analysis — current desktop UX (infra-first)

The app opens on the **Dashboard**: "Node stopped", a **Start Node** button, and Quick Info
listing `Node ID: aimeat-local-001-dev`, `Port: 40050`, `Role: standalone`, `Storage: SQLite`,
`Data folder: C:\Users\…`. Nav: Dashboard · Connections · AI Setup · Agents · Chat · Settings · Logs.

This is an **operator control panel**, not a value surface. For a non-technical person:

- It answers *"what is this server thing?"* — not *"what do I get?"*.
- **No do → get.** Clicking *Start Node* produces… nothing visible. The reward is invisible.
- **Jargon everywhere:** node, standalone, SQLite, port, data folder, GHII.
- **No language choice**, and the copy is mixed (English with a stray Finnish "Kirjaudu /
  Rekisteröidy") — strings are hardcoded, there is no i18n layer (`<html lang="en">`).
- **Steps don't narrate** what happens or what you gain at each click.

The web landing already solved the equivalent problem (reward-first hero, gallery up top, a real
result before any homework). The desktop needs the same inversion.

## Principles (same as the landing)

1. **Outcome first, infrastructure second.** Lead with what the user gets, not with node status.
2. **Every action narrates what you get.** "Waking your node ✓ — your data lives on your machine."
3. **A first visible win in minutes, shown IN the app** (not "go look in the portal").
4. **Plain language; hide or translate infra.** "Your AIMEAT" not "node:standalone:SQLite:40050".
5. **Playbooks: pick an outcome → the app does the plumbing** (node, account, agent, model, run).

## Workstreams

### 1. Language selection (FI / EN) — concrete
- Add a small **i18n layer** to the desktop HTML: a `STRINGS = { en:{…}, fi:{…} }` dict + a `t(key)`
  helper, applied to elements (`data-i18n`) and to JS-built strings (toasts, button labels, the
  agent Activity log labels).
- **Language switch** in the header (or Settings), **persisted** (localStorage), defaulting to the
  OS locale on first run (Finnish if the OS is `fi`).
- Translate all current strings (kill the hardcoded-English + the stray-Finnish inconsistency).
- Mirror the web's FI tone where it already has equivalents.

### 2. Outcome-first Home (replaces the infra Dashboard as the landing view)
- New first screen: **"What do you want your AI to do for you?"** with 3–4 **starter playbook
  cards**, each in plain language + a one-line *"You'll get: …"*. Map to existing crewaimeat crews:
  - **Daily brief** → `daily_briefing_crew` ("A short morning brief on topics you pick.")
  - **Research a question** → `web_researcher_crew` ("Ask once; get a sourced answer.")
  - **Write the news** → `news_writer_crew` ("A tiny paper, written each evening.")
  - **Make an image** → `image_maker_crew` ("Describe it; your AI draws it.")
- Node status/Quick Info move **below** (or into Settings) — present, but not the headline.

### 3. One-click first win (the do → get flow)
- Clicking a playbook card runs a **single guided flow** with narrated progress, reusing the
  `agent-event` stream from workstream A:
  1. Wake your node ✓ (start_node)
  2. Create/sign in your account (if needed)
  3. Enable local agents ✓ (provision.mjs: clone + uv + providers)
  4. Download your AI's brain — Gemma (~once, show size) ✓ (ollama pull)
  5. Your agent is working… → **show the actual result in the app**
- Ends on: *"Your own AI wrote this, on your machine, for free. Want it every morning?
  [Schedule it]"* — the explicit do → get payoff + the next hook.

### 4. Humanized status + onboarding checklist
- Replace "Node stopped / running" with human states: *"Your AIMEAT is asleep — wake it to use
  your agents"* / *"Awake — your agents can work."*
- A small **onboarding checklist** that ticks as the user progresses (account ✓, local agents ✓,
  first result ✓) — do → get made visible and a little gamified.

### 5. Output surface (where results land)
- An in-app place to see what agents produced (briefs, research answers, images) — so the reward
  is visible without leaving the app. (Reads the same data the portal shows.)

### 6. Polish & platform suggestions (besides translations)
- **Ollama prerequisite UX:** detect Ollama on the Agents/Home flow; if missing, a clear one-step
  "Install Ollama" with a link + re-check, instead of a silent failure in the log.
- **Tray notifications:** "Your brief is ready" → click opens the result. Closes the do → get loop
  even when the window is in the background.
- **Auto-update:** now that CI publishes GitHub Releases, wire the **Tauri updater** so the app
  offers "Update available" → one click. (Needs an update endpoint + signing — see decisions.)
- **Model/RAM guidance:** before pulling Gemma, show the size and a gentle RAM hint; offer a
  smaller model on low-RAM machines.
- **First-run welcome:** a one-screen "what is this, in one sentence" + "pick your language" + "do
  your first thing" — instead of dropping the user on the operator Dashboard.

## Concrete example — the "you got something" moment

The user installs, opens the app, and instead of "Node stopped / Start Node / SQLite" they see:

> **What do you want your AI to do for you?**
> [ Daily brief ] [ Research a question ] [ Write the news ] [ Make an image ]

They click **Daily brief**, type "AI, Finnish startups, space weather", and hit go. A friendly
progress panel narrates:

> Waking your node… ✓ (your data stays on this computer)
> Setting up your local agent… ✓
> Downloading your AI's brain — Gemma, ~3 GB, one time… ✓
> Your agent is reading and writing your brief…

…and then, **in the app**, a real short brief appears:

> **Your morning brief — written by your own AI, on your machine**
> • *AI:* … • *Finnish startups:* … • *Space weather:* …
> Nobody else saw this. **Want one every morning? [Schedule it →]**

One click → a real, private, free result they can see and feel. That is "because you did
something, you got something" on the desktop.

## Open decisions

- **D1 — Default language:** detect OS locale (FI if the OS is Finnish), or default EN with a
  visible switch? Recommendation: detect, with an obvious switch.
- **D2 — Home boldness:** *replace* the Dashboard as the opening view with the outcome-first Home,
  or *add* a "Start here" Home above it and keep the Dashboard for operators? Recommendation:
  outcome-first Home is the opening view; the operator Dashboard stays one click away.
- **D3 — Starter playbooks:** confirm the first 3–4 crews to ship (daily_briefing, web_researcher,
  news_writer, image_maker) — image_maker needs a model that can do images (the crew may call an
  external generator; verify it works keyless/local or mark it cloud).
- **D4 — Auto-update:** wire the Tauri updater now (needs a signed update feed) or defer until code
  signing (the desktop is unsigned today — see the agent-runtime plan, D4)?

## Implementation status — 2026-06-17 (first pass)

Built in `aimeat-desktop/src/index.html` (frontend only — no Rust change). Verified: inline-JS
syntax (`new Function`) clean, exactly one active page (Home). **Not verified:** live runtime in
the Tauri webview (the app's first line needs `window.__TAURI__`, so it can't be previewed in a
plain browser; and the local build is windres-blocked). Ships via CI as `desktop-v0.4.1`.

- **1 — done:** i18n layer (`STRINGS` en/fi, `t()`, `applyI18n`, `data-i18n`), header **language
  selector** (persisted, OS-default), humanized status copy. Coverage = the value-first surfaces
  (nav, status, Home, first-win, welcome) + common buttons; deeper operator strings remain English
  (incremental).
- **2 — done:** outcome-first **Home** is the opening view ("What do you want your AI to do?") with
  3 playbook cards + a "build your own" card. Dashboard kept in the nav.
- **3 — done:** one-click **first-win** flow (`startPlaybook`): Ollama check → wake node →
  `agent_provision` (waits for the streamed result) → `agent_start`, narrated into a live log
  (mirrors `agent-event`), then a "give it this task" step. **Simplification:** all 3 starter
  playbooks run the proven `crewaimeat.research_crew` with a different pre-filled task; distinct
  per-outcome crews (incl. image generation) are deferred until verified keyless-local.
- **4 — done:** humanized always-visible status ("Your AIMEAT is asleep / Awake").
- **5 — done:** first-run **welcome overlay** (language pick + start) + in-flow **Ollama detect**
  with install/recheck.
- **6 — follow-ups (need Rust + a build):** tray notifications on agent results, the Tauri
  **auto-updater** (needs a signed update feed — gated on code signing), model/RAM guidance, and
  true in-app structured result rendering (auto-queue a task + poll the node, vs. today's "open the
  dashboard to confirm"). Tracked here; not in this pass.

## Out of scope (for now)
- Code signing (tracked in the agent-runtime plan).
- macOS/Linux desktop.
