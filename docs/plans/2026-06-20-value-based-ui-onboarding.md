# Value-based UI & first-experience arc

**Date:** 2026-06-20
**Owner:** Jouni
**Status:** Phase 1 (jargon) DONE. Phase 2 pixel-grid REVERTED. Phase 2 redesigned as
"build-to-touch / wall of creations" — first slice (BuildHero + live wall) DONE + browser-verified.

## 2026-06-20 — Phase 2 first slice shipped & verified (BuildHero + live wall)

Concept converged with owner: the "canvas" = the **wall of creations itself**. The hero is the
proven app-catalog king flow elevated to the front door — *build a real app with your AI, it's
yours, it goes live on the wall.*

- [landing.js](../../aimeat/public/views/landing.js): replaced the Sanomat `Hero` with `BuildHero`
  (value pitch + one-click "Copy the build prompt", reusing `buildLandingAppPrompt`); rewrote
  `Gallery` into a **live wall** that renders the REAL published apps from `/v1/apps`
  (manifest-driven: name, description, author), with a friendly empty state.
- i18n keys `landing.buildHero*` + `landing.wall*` added to both locales.
- **No new backend** — reuses the existing app build prompt, the apps API, and the publish flow.
- Verified in-browser (FI, logged-in via in-app flag): hero renders, the wall shows real apps
  (LIVE SSE App, Comicland v2, Weather Gladiators, Kiosk Display, Admin Panel, Rick and Morty…)
  with authors. Gates green: lint 0 errors, typecheck:frontend clean, importmap in sync, locales
  6750/6750 parity. (The one console 401 is the pre-existing `/v1/auth/refresh`, unrelated.)

**Wall v2 + hero refinement (2026-06-20, shipped & verified).** Per owner: the wall is a fixed
**3-up grid with a filter search**; each card shows **name · description · author · publish
date/time** (`manifest` + `created_at`). Hero subline now adds **"let your agents keep it running,
the way AIMEAT Sanomat writes itself every evening"** — apps you build, agents maintain. Verified:
filter narrows live (typing "weather" → 2 apps), meta shows author + date/time, gates green, locales
6752/6752.

**Direction change — anon dropped.** Owner: forget anonymous entirely. Auth = **Google one-click OR
email registration**. The reward needs no twist/gamification — it is simply *publish a silly/fun/
useful thing live to everyone in under 10 minutes*, which proves the power of AI + the platform;
agents tuning + data collection come later. Config to enact (pending owner go-ahead + working SMTP):
- `AIMEAT_ANONYMOUS=false` (currently `true`) — kill anonymous mode.
- `AIMEAT_EMAIL_CONFIRMATION_REQUIRED=true` (currently unset) — force email on registration (also
  good for password recovery). ⚠️ Requires SMTP configured or registration locks out — verify first.

**Still open:** wire the hero CTA to the Google/email login when not signed in; fold the lower full
build-prompt section into the hero to avoid duplication; later, agent-maintenance + data hooks.

## 2026-06-20 — App screenshots + descriptions (owner direction)

Findings: the apps API already supports screenshots (store at publish, serve, `has_screenshot`/
`screenshot_url`) but **0/17 apps had one** (the catalog publish sends `screenshot: null`);
**11/17 have a description** (AI fills `manifest.description`), not enforced. Auto-capture *on view*
is impossible (H-2 sandbox = opaque origin, cross-origin canvas blocked). Owner chose the
**screenshot-worker** approach (an operator-run agent backfills missing screenshots), and:
screenshots + descriptions should be first-class; description required + AI-written.

**Slice 1 (DONE + verified) — set-screenshot endpoint + wall renders images:**
- New `POST /v1/apps/:owner/:filename/screenshot` ([apps.ts](../../aimeat/src/routes/apps.ts)):
  set/replace an app's screenshot WITHOUT re-publishing. Auth = the app's **owner OR a node
  operator** (so the worker can backfill any app). `createStorageFile` upserts → overwrites.
  Path-traversal guarded, 2 MB cap, base64-validated.
- OpenAPI: added the `/v1/apps/{owner}/{filename}/screenshot` path (GET + POST); `generate:types`
  re-run. (The wider apps API remains undocumented in openapi.yaml — pre-existing gap, not touched.)
- E2E ([e2e-apps.ts](../../aimeat/test/e2e-apps.ts) Phase 6): owner sets screenshot, GET serves the
  image + listing flips `has_screenshot`, 400 on empty body, 403 for a different non-operator
  owner. **21/21 pass on SQLite.**
- Wall ([landing.js](../../aimeat/public/views/landing.js)): cards render a `.ld-app-shot`
  thumbnail when `screenshot_url` is present. Gates green: lint 0 errors, typecheck (backend +
  frontend) clean, importmap in sync.

**Slice 2 (next) — the screenshot worker:** a Node + Playwright (already a dev-dep) tool, run as
operator: list apps with `has_screenshot=false` → render each app headless → capture PNG → POST to
the new endpoint. On-demand/scheduled. Manual override = owner uploads via the same endpoint.

**Slice 3 — description required + AI-written:** enforce a description on publish (reject missing)
and have the build prompt instruct the AI to write a good one. ⚠️ Behaviour change (only new
publishes).

## 2026-06-20 — Phase 2 pixel-grid reverted; redesigned as "build-to-touch"

**Why reverted.** The shared paintable pixel grid demonstrated *nothing* about AIMEAT: it had no AI,
no creation, no ownership — the three things AIMEAT actually is. Painting a coloured dot trivialises
the product. Reverted in the working tree (it had been committed in `da43ca4d`; the jargon work was
in an earlier commit, so restoring landing.js/landing.css/locales to `da43ca4d^` removed the grid and
kept the jargon). Owner decision.

**New concept — "build-to-touch": a shared canvas you can only affect by building an app with AI.**
- There is one **shared canvas / dataset** (a public AIMEAT memory artifact) everyone sees.
- You **cannot edit it directly.** The only way to affect it is to **build your own app with AI**
  (the prompt loop) that reads/writes that shared data through AIMEAT's APIs. Building + publishing
  the app IS the "touch to the platform" — you have now published something of your own.
- Your app is **your own lens/view** into the shared data — you give it a twist.
- Published apps are listed below as a growing wall: "this user made an app over this canvas — with
  a twist." Everyone contributes a variation.
- Each point/app can hold **per-point private data others can't see** except through that software
  (consent/visibility).

**Why this actually proves AIMEAT** — it maps 1:1 to the core architecture (CLAUDE.md "No SSR"):
*CSM defines the data shape → generic APIs handle storage/consent/validation → clients render UI.*
The shared canvas = the shared data; each user's app = a client over it. The landing becomes a live
proof of AIMEAT's thesis: AI-assisted creation, ownership, shared data with many lenses, consent.

**Proposed MVP slice (build on existing machinery, don't reinvent):**
1. **Shared canvas data contract** — one public memory key (e.g. `shared.canvas`) with a documented
   read/write shape (grid of points/cells + optional per-point private field).
2. **Canvas-specialised build prompt** — the hero prompt is not "build any app"; it is "build YOUR
   app that draws on / views the shared canvas," with the canvas API + data shape + how to add a
   twist + how to store per-point private data baked in. Reuses the prompt-loop pattern
   (`buildLandingAppPrompt`).
3. **Wall of canvas apps** — list below the hero of apps tagged as canvas-apps (maker + twist),
   each openable. Reuses the apps catalogue, filtered by tag.

**Honest constraint to surface:** building + publishing an app uses the user's own AI chat (the
prompt loop) and likely login to publish to their node — so the reward (your app on the wall) is the
*real* loop, not a fully-anonymous instant action. The "instant" part is getting your tailored
prompt + seeing the wall of others' apps. This is honest to AIMEAT (unlike the fake pixel).

**Deferred within this concept:** real morsel debit, heavy gamification, per-point private-data UX.

## Progress log

**2026-06-20 — Phase 1 (jargon translation) shipped & verified.**
- Translated the Tier-1 first-impression copy in `en.json` + `fi.json`: `registerDesc`,
  `registerBtn`, `whyGhii` (×2) — GHII jargon → "your own private space" / "your own digital
  identity — only you control it".
- Organism **gloss** (not rename) at its newcomer touchpoints: `profile.notebook.desc`,
  `profile.services.setupStep4Why` → "shared space (organism)" / "yhteinen tila (organismi)".
- **Bonus:** normalized the Finnish heart-morsel inconsistency (`Muruset`→`Sydänmuruset`,
  `morselia`→`murusia` in 4 user-facing spots, `Morselisaldo`→`Murusaldo`). EN was already
  consistent.
- **Deferred `capability`:** it is two different concepts in the UI (an agent's *skills* vs. the
  buy-once *capability* binding) with no clean newcomer touchpoint — glossing it would land in the
  wrong place. Revisit in Phase 4 (Home) with full context.
- Verified: both locales valid JSON, 6742 keys, full parity; dev server serves the new strings
  (no cache); notebook gloss renders correctly in-context (Finnish).

**2026-06-20 — Phase 2 MVP (hero pixel grid) shipped & verified.**
- Replaced the Sanomat newspaper Hero with `PixelGridHero` in
  [landing.js](../../aimeat/public/views/landing.js) (`/v1/portal`, the human front door): a shared
  24×12 r/place canvas + 8-colour palette + heart-quota bar. Styles `.ld-cv-*` in
  [landing.css](../../aimeat/public/css/views/landing.css). i18n keys `landing.canvas*` added to
  both locales.
- **No new backend** — reuses the anonymous-token + public-memory mechanism (same as the oneliners
  feed): `POST /v1/auth/anonymous` → write/read the shared public key `anonymous.canvas` under the
  shared anonymous GAII. r/place persistence (pixels stay until overpainted) falls out of the
  single shared key.
- Heart quota is **client-side** for anon (localStorage, 20) with a register-to-paint-more CTA when
  it hits 0. The real per-pixel morsel debit is deferred (see below).
- Verified in-browser: renders (FI), painting applies the colour, hearts 20→19, and the write
  PERSISTS — `GET …/anonymous.canvas` returns `{pixels:{"16,4":0}}`, public, readable by all. The
  pre-first-write 404s on the read poll are handled gracefully (same as oneliners). Gates green:
  lint 0 errors, typecheck:frontend clean, importmap in sync, locales 6751/6751 parity.

**Phase 2 refinements still open (deferred):**
- **Real morsel debit per pixel** (the locked "morsels = paint quota" decision) — needs a server
  path; current anon quota is client-side UX only.
- **Concurrency:** painting read-modify-writes the whole grid (last-write-wins); fine for a hero,
  not for scale. Per-pixel writes if traffic grows.
- **Registered-user painting / keeping your art** post-login (the landing redirects logged-in users
  away today).

**Front door resolved (2026-06-20).** `/` is INTENTIONALLY differentiated by client: an AI/bot/
crawler gets an accelerated, machine-readable version at `/`; a human is redirected to
`/v1/portal`. So the **human front door is [landing.js](../../aimeat/public/views/landing.js) at
`/v1/portal`** — that is where the hero pixel grid goes. The `/` AI-facing page is deliberate and
stays untouched. (Earlier "stale PWA cache" hypothesis was wrong — it's by design.)

## Problem

A first-time visitor doesn't understand what AIMEAT offers, even though the landing page
([landing.js](../../aimeat/public/views/landing.js)) is already "reward-first". Two root causes:

1. **The reward belongs to someone else.** The hero shows a newspaper *agents* made ("Tonight's
   paper wrote itself") — the visitor watches from the side, never acts, never owns a result.
   The first thing *asked* of them is large (open someone's app, or download the desktop app).
2. **Jargon surfaces too early.** morsel, organism, capability, GHII/GAII, foundry, generator,
   cortex, node — none translate to a benefit the visitor recognizes.

## Guiding principle

> **Never name the mechanism. Name what the user gets.**

Test for every string/screen: if it describes *how the system works*, it's wrong on the surface;
if it describes *what the user gets or did*, it's right. Exact terms don't disappear — they move
deep (settings, dev docs, API), where they're needed.

## Locked decisions

1. **"morsel" stays** — brand word kept: *sydänmuruset* ("heart morsels"), earned as thanks.
   Framing = a gesture of love ("lovee"): you give a little, another receives. This is already the
   spirit of [en.json:451](../../aimeat/locales/en.json#L451) — reinforce it, don't replace it.
2. **portal.js (classic Genesis view) is being retired** → out of scope. Do NOT touch its
   wallet/memory dashboard ([portal.js](../../aimeat/public/views/portal.js)). The value-based Home
   is built in the `profile.landing` view, not portal.js.
3. **Hero = a shared paintable pixel grid** (not a text one-liner, not "watch someone's app").

## The hero: a shared paintable pixel grid

The painting action drives the entire AIMEAT value loop in one ~10-second interaction, and heart
morsels are the natural meter:

- **You do:** paint on the grid in your own colour/style. Appears instantly, live, in a shared
  canvas (same public-memory + polling mechanism the oneliners feed already uses,
  [portal.js:970](../../aimeat/public/views/portal.js#L970)).
- **You get:** your mark lives on the canvas — yours, public, owned. *That is* the reward, not a
  separate "look what someone made".
- **Heart morsels = paint quota.** Each pixel costs morsels ("you give a little love to leave a
  mark"). **Anonymous = few morsels → little paint.** Registering grants the starting 100 → much
  more paint. The registration call is not a gate but *earned*: *"Out of morsels — make your own
  space, get 100 heart morsels, paint more."*
- **Reciprocity made visible:** when someone paints next to / over your mark, that's the natural
  moment to show morsels flowing back — the economy becomes visible with zero jargon.

### Mechanics (decided)

- **Persistence: r/place style.** Fixed grid; your pixels persist until someone paints over them.
  "Your mark lives as long as no one replaces it." Simplest, most familiar, creates a natural
  come-back hook.
- **Painting costs heart morsels.** Morsel balance *is* the paint quota — anonymous gets few,
  registered gets 100. Dogfoods the economy, makes the registration call earned, reuses the
  existing mechanic (no separate quota system).

This single widget demonstrates public memory, the anonymous→registered upgrade, heart morsels,
and the live feed — without explaining a word of the protocol. It collapses arc steps 1–3 into one
coherent mechanic.

## First-experience arc (current → target)

### Step 1 — Arrival (hero)
- **Now:** [landing.js](../../aimeat/public/views/landing.js#L390) shows someone else's Sanomat
  paper to click. Reward belongs to others.
- **Change:** hero = the shared paintable pixel grid above. Sanomat moves *below* the hero as
  proof, not in its place.
- **Files:** `landing.js` (new Hero), `landing.css`; new shared-canvas widget; a public-memory
  canvas key (analogous to `anonymous.oneliners`); anonymous-token write path.

### Step 2 — First action (reward visible)
- **Now:** no immediate feedback — the visitor clicks a link away.
- **Change:** painting is its own instant reward; show the morsel meter draining ("X heart morsels
  left"). The value loop becomes visible *before* any registration ask.
- **Files:** `landing.js`, keys under `landing.*` + `morsels.*`.

### Step 3 — Registration call (earned, not demanded)
- **Now:** registration is a gate before any benefit.
- **Change:** the call appears only after the visitor has a result and runs low on morsels: *"Keep
  this and get more — make your own space."* Framed as *keeping* a result, not *creating* an
  account. Reuses the existing login-modal trigger
  ([portal.js:1291](../../aimeat/public/views/portal.js#L1291) pattern).
- **Files:** `aimeat-auth.js` login trigger, `landing.*` strings.

### Step 4 — First own view (profile Home)
- **Now:** [profile.landing](../../aimeat/locales/en.json#L3156): *"Welcome! Start here. You have
  four paths forward."* — four parallel paths = choice paralysis at the front.
- **Change:** one recommended next action that continues what was just done (you painted → "paint
  more / make your grid your own page"). The other three paths go behind progressive disclosure.
  Reframe any stat surface from mechanism ("wallet: 100 / memory: 3") to "what you did · what you
  earned · what you own".
- **Files:** the profile Home view (`profile.landing` keys).

### Step 5 — Second action (loop closes)
- **Change:** after the first owned result, show where it leads ("others saw this", "you earned
  more", "you can make this shareable"). Only here introduce the bigger tools (build prompts) that
  currently sit on the landing page.
- **Files:** profile Home; `landing.js` (build prompts move behind progressive disclosure).

## Jargon → benefit map

Applied across the surface (`landing.*`, `portal.*`, `profile.landing.*`, `morsels.*`,
`welcome.*`). Left = stays in code & deep settings; right = what the surface shows.

| Term (surface) | What it is to the user | Surface wording |
|---|---|---|
| morsel / heart morsel | thanks you earn & own | KEEP as *sydänmuruset / heart morsels*, framed as love given/received |
| organism | a shared workspace | "shared space", "your team's place" |
| capability | a ready tool bought **once** (not rented) | "ready tool", "buy once" |
| GHII / GAII | you vs. your AI | "you" / "your agent" — never the identifier form on the surface |
| foundry / generator / cortex | three ways to build | merge to one: "build" — don't expose three engines to a first-timer |
| node | your own server, you own the data | "your space", "your data" |
| work / action / service | what you do for / get from others | one word: "task" / "help" — not three |

All wording changes touch `locales/en.json` **and** `locales/fi.json` together (Rule 4), plus
`public/locales/` if mirrored. Largely a key-by-key wording pass, not code.

## Implementation order

Each step is independently shippable and browser-verifiable (Rule 1b, drive via Playwright MCP
against `pnpm dev` on port 40050).

1. **Jargon map first** — wording swap in `en.json` + `fi.json` only. No code, low risk; exposes
   how much the jargon was dragging, and is the base for everything else.
2. **Hero pixel grid (steps 1–3)** — biggest impact on first impression. New shared-canvas widget +
   public-memory canvas key + anonymous-token write path + morsel-as-paint-quota wiring.
3. **Profile Home value-based (steps 4–5)** — one recommended next action; reframe stats;
   progressive disclosure of the other paths and the build prompts.

New backend (canvas key, morsel debit on paint) needs storage-sync across both backends
(SQLite + MongoDB) and E2E tests (happy path + out-of-morsels failure) per Rule 1; OpenAPI sync per
Rule 3 if a new route is added.

## Open / deferred

- Canvas size, pixel cost in morsels, and anonymous starting balance are tuning values — decide at
  build time of step 2.
- Whether the painted grid can become a visitor's own shareable page (step 5 hook) — revisit after
  step 2 ships.
