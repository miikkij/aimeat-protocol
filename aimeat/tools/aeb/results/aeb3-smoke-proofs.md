# AEB-3 smoke-proofs — chartjs / styling / phaser / realtime on Haiku 4.5 (2026-07-17)

A lighter instrument than the full controlled A/B (`run-task.md`), used to answer the **tier
question** — "does a mid-tier model produce WORKING code for this pack?" — for the packs whose tier
was still inferred `[I]`. Each is a single-purpose component (pure pack render, no domain app) built
one-shot by a **Claude Haiku 4.5** agent that fetched the pack's ai_doc, published to a local bench
node, and was verified in a real browser (Playwright MCP): renders + zero app-attributable console
errors = pass. This proves *reliability on the model*, not domain acceleration (that's the A/B's job).

| Pack | Verdict | Browser evidence | Tier |
|---|---|---|---|
| **chartjs** | ✅ pass | 2 canvases both drawn (non-blank), `window.Chart` present, 0 console errors | `any` [M] |
| **styling** | ✅ pass | full daisyUI v5 render — 7 btn variants, card, badges, form; Tailwind v4 JIT compiled; 0 errors | `any` [M] — **reclassified from inferred `frontier`** |
| **phaser** | ✅ pass | 800×600 WebGL canvas booted; player rect + 5 bouncing balls rendered (screenshot); 0 errors | `any` [M] |
| **realtime** | ⚠ blocked | never reached the realtime API — crashed in auth wiring (see below) | `needs-doc` [I] (unproven) |

## chartjs — pass
Haiku fetched the ai_doc, included only `chartjs@4.js`, and rendered a bar + a 2-dataset line chart,
theme-aware. Both canvases sampled non-blank; 0 console errors. Chart.js v4 is close to v3 and
ubiquitous — a mid-tier model codes it correctly from memory. Confirms `any`.

## styling — pass, and it corrects a wrong inference
I had inferred `styling` as `frontier` (Tailwind v4 ≠ the v3 models know). **The measurement refuted
that:** Haiku produced a fully-working page — navbar, card, all seven daisyUI v5 button variants with
correct colours, badges, a form — using Tailwind v4 utilities + daisyUI v5 classes with 0 console
errors. The v4 browser-JIT + v5 class names did not trip it. Reclassified `frontier → any`, the
inferred `apiCaveat` removed. (This is exactly why the ledger measures instead of guessing.)

## phaser — pass
Haiku fetched the ai_doc and built a Phaser 3 arcade scene with generated textures (no external
files): `Phaser.AUTO` picked WebGL, the game booted (800×600 canvas), a keyboard-controlled player
rectangle and five world-bounds-bouncing balls rendered (screenshot `scratchpad/smoke-phaser.jpeg`),
0 console errors. Phaser 3 is the dominant Phaser in training data (v4 is new) — low drift. Confirms
`any`. Note: Phaser's own Graphics API legitimately uses `fillStyle/fillRect` (unlike pixi v8) — the
ai_doc shows this and the model used it correctly.

## realtime — blocked in auth wiring, NOT the realtime API
The realtime smoke never got to test the pack: it threw
`Uncaught SyntaxError: Failed to execute 'querySelector'… '[object Object]' is not a valid selector`
at `AIMEAT.auth.mountLoginButton`. The app called `mountLoginButton({ onLogin })`, but the real
signature is `mountLoginButton(selector, opts)` — the first arg must be a CSS-selector string, so the
options object became the selector → `document.querySelector([object Object])`. The `AimeatRealtime`
client itself was loaded and correct; the sign-in wiring failed before any room connect. So this run
is **inconclusive for realtime's own API** — it stays `needs-doc` [I], unproven.

### Finding (SDK, gated): `AIMEAT.auth.mountLoginButton(selector, opts)` is a signature trap
A mid-tier model naturally reaches for `mountLoginButton({ onLogin })` (options-first). Options:
accept an options-only overload (`mountLoginButton(optsOrSelector, opts?)`, defaulting to a standard
container) or throw a clearer error than a raw `querySelector` SyntaxError. Not applied — SDK change,
needs the developer's go. To actually prove realtime, re-run its smoke with the auth wiring fixed
(and a second client for presence).

## Ledger updates applied
`chartjs`, `phaser` → `any` with a Haiku `pass` proof. `styling` → `any` (from `frontier`) with a
Haiku `pass` proof, `apiCaveat` dropped. `realtime` unchanged (`needs-doc`, inferred). After this
batch, **pixi is the sole confirmed `frontier` pack** (the only one measured to fail a mid-tier model
on version-drift).
