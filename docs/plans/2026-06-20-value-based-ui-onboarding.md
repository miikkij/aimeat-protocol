# Value-based UI & first-experience arc

**Date:** 2026-06-20
**Owner:** Jouni
**Status:** Plan — approved decisions locked, mechanics decided, implementation not started.

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
