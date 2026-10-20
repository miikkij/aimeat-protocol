/**
 * @file appdev-pitfalls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Curated registry of pitfalls for building apps ON AIMEAT (app-catalog apps,
 *   extensions, cortexes — what an AI builder agent does over MCP). Platform-level knowledge,
 *   distilled from real builds. This registry covers ONLY app development on the platform —
 *   node-development pitfalls (storage sync, migrations, CI, tooling) do NOT belong here.
 *   Same drift-proof pattern as library-packs.ts: the registry is the single source of truth,
 *   served at GET /v1/appdev/pitfalls and merged into the appdev research surfaces.
 * @structure AppdevPitfallEntry — one curated pitfall; APPDEV_PITFALLS — the registry;
 *   getAppdevPitfalls() / getAppdevPitfallIndex() / getAppdevPitfallFacets() — accessors.
 * @usage import { getAppdevPitfalls, getAppdevPitfallIndex } from '../data/appdev-pitfalls.js';
 * @version-history
 *   2026-10-19 — no-max-tokens: a text job runs uncapped and its record says truncated (wish
 *     ai-jobs-run-uncapped-and-report-a-cut-answer). schedule-next-run-needs-the-year: a failed
 *     one-shot is turned off with no next run (wish a-failed-one-shot-schedule-does-not-wait-a-year).
 *   2026-10-19 — Seven more removed whose facts reached production with 908d4fe6c (Jouni, 2026-10-19):
 *     isolated-frame-on-shared-nodes, app-grant-node-role-via-owners, app-grant-role-limits
 *     (the aimeat-auth and aimeat-organism aiDocs), realtime-room-gc-recreate,
 *     an-ai-co-player-is-an-agent (the realtime aiDoc), overflow-clip-hides-scrollwidth (the build
 *     specification's mobile check; grid-track-blowout and auth-pill-overflow point there now) and
 *     schedule-list-hides-what-fired (the aimeat-agents aiDoc).
 *   2026-10-19 — Eleven entries the 2026-10-17 round marked outdated are removed (Jouni, 2026-10-19):
 *     unlabelled-ai-output, ai-provenance-dropped-on-save, biometric-inference-needs-your-own-notice,
 *     pub-urls-for-cross-user-files, ui-component-shapes, presigned-over-inline,
 *     iam-decide-at-framing, realtime-batch-per-tick, realtime-anchor-clock,
 *     outbound-replay-is-not-a-send, one-file-past-a-megabyte. Nothing in the repository cites them.
 *     handle-both-auth-paths stays, outdated, because app-declared-unused points at it.
 *   2026-10-18 — callext-path: AIMEAT.data.action, and a `public: true` action answers a visitor (Comicland v3 A-7).
 *   2026-10-17 — +team-data-in-personal-memory (plan V7, the data map step in both build interviews).
 *     The two types moved verbatim to appdev-pitfall-types.ts and are re-exported here.
 *   2026-10-17 — Every entry re-read against node 4.0.3 (852e0eff6) by the pitfall-list watch and
 *     stamped. Seven corrected: app-declared-unused (a new app forks a genre; mountLoginButton with
 *     onSession), hand-rolled (no atelier.radar: chart with kind "radar"), atelier-register (a proto
 *     or plain page owes no register), app-grant-role-limits (an app grant can add a space and send
 *     workspace invitations), no-max-tokens (an owner's saved limit still applies to a job),
 *     session-fetch-parsed (the lowercase content-type trap is fixed in 3c8615738) and
 *     mobile-means-fullscreen (the bottom strip is 46px); undeclared-scope-words also names
 *     social:write for a realtime room, which the publish check now flags. Twelve marked outdated because the build
 *     specification or a library guide now states the fact and no publish check cites the id:
 *     unlabelled-ai-output, ai-provenance-dropped-on-save, biometric-inference-needs-your-own-notice,
 *     pub-urls-for-cross-user-files, ui-component-shapes, handle-both-auth-paths,
 *     presigned-over-inline, iam-decide-at-framing, realtime-batch-per-tick, realtime-anchor-clock,
 *     outbound-replay-is-not-a-send, one-file-past-a-megabyte.
 *   2026-10-13 — undeclared-scope-words: the id the publish check carries for a word the code needs on a
 *     4.0 node and aimeat-scopes does not name (services/app-scope-needs.ts).
 *   2026-10-04 — isolated-frame-on-shared-nodes: the frame also takes a package's app on a node one
 *     person uses (routes/apps/inline-frame.ts v1.1.0).
 *   2026-10-02 — track-mixing: a Classic page may load the kit for its library blocks; the mix is the
 *     shell drawn, or the kit loaded and nothing in it called (the publish lint says the same).
 *   2026-10-01 — iam-decide-at-framing points at the node roster and a gate from aimeat_iam_define,
 *     not at the aimeat-iam pack, which keeps its own roster in ctx.memory.
 *   2026-09-26 — provenance-without-model: a declaration that names no model, and the publish hint.
 *   2026-09-25 — isolated-frame-on-shared-nodes: what an app meets on a node several people share
 *     with no app origin, where it runs in an opaque-origin frame (audit A7-1).
 *   2026-09-19 — track-drift: a new app that ended up on Classic, and what the publish says about
 *     it.
 *   v1.7.1 — 2026-09-13 — handle-both-auth-paths names onSession, the one handler for a restore and a
 *     sign-in, and keeps the two-path wiring for a page that does not use it.
 *   v1.7.0 — 2026-09-13 — Every entry re-read against the code and stamped (verifiedAt,
 *     verifiedVersion). Fourteen corrected where the platform had moved under them, among them
 *     login-is-silent-only (AIMEAT.auth.signIn exists now), edit-published-app (the draft road,
 *     not aimeat_app_get), long-ai-calls-timeout (apps have AIMEAT.ai.job, not the SPA helper),
 *     no-max-tokens (a cut answer now says truncated), callext-path, cdn-libs-blocked and the
 *     realtime four. This registry is now the only home of the app-builder traps docs/pitfalls.md
 *     carried in §4, §6, §8, §12, §15, §16 and §16b; the eight that had no entry here arrived as
 *     body-background-seam, overflow-clip-hides-scrollwidth, ui-component-shapes,
 *     heavy-widgets-on-a-phone, an-ai-co-player-is-an-agent, outbound-replay-is-not-a-send,
 *     schedule-next-run-needs-the-year and schedule-list-hides-what-fired.
 *   v1.6.0 — 2026-09-05 — +atelier-register, the id the register gate's refusal carries: an
 *     Atelier app that names no committed look (no `aimeat-register` meta, or the shell's
 *     REPLACE-ME placeholder) does not publish. The bare shell is a frame, not a page.
 *   v1.5.0 — 2026-08-27 — +track-mixing, the id the four track-separation findings in the publish
 *     artifact check carry (TARGET-074: Classic and Atelier have separate guides that never mix).
 *   v1.4.0 — 2026-08-25 — +one-file-past-a-megabyte. The first entry here about what an app
 *     ACCUMULATES rather than what it gets wrong: measured on a 3.18 MB app whose author felt the
 *     slowdown for two days while every number that explained it sat on our side, unshown.
 *   v1.3.0 — 2026-08-15 — +app-declared-unused, the id the three new artifact-lint findings carry.
 *   v1.2.0 — 2026-08-11 — +inline-js-does-not-parse, +app-meta-declarations, +namespace-rule. All
 *     three are what the publish-time artifact check (services/app-artifact-lint.ts) reports by id,
 *     so a finding in a publish response resolves to a full entry at GET /v1/appdev/pitfalls/{id}.
 *     Each was hit for real on 2026-08-11 by one app that reached production.
 *   v1.1.0 — 2026-07-19 — +flex-nav-wrap (mobile) +app-grant-node-role-via-owners (auth); updated
 *     auth-pill-overflow now that the compact pill is default + shells ship overflow-x:clip.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 5: three AI-transparency entries (unlabelled output,
 *     provenance dropped on save, biometric inference being the owner's OWN duty). Research-first
 *     surfaces these before a build, which is the only point at which they are cheap to act on.
 *   v1.0.0 — 2026-07-19 — initial: 26 curated entries distilled from docs/pitfalls.md
 *     (app-builder-relevant sections only) + recurring app-build lessons.
 */

import type { AppdevPitfallScope, AppdevPitfallEntry } from './appdev-pitfall-types.js';
export type { AppdevPitfallScope, AppdevPitfallEntry } from './appdev-pitfall-types.js';

const E = (e: AppdevPitfallEntry): AppdevPitfallEntry => e;

/** The review that last read every entry against the code. */
const CHECKED = { verifiedAt: '2026-10-17', verifiedVersion: '4.0.3' } as const;

export const APPDEV_PITFALLS: AppdevPitfallEntry[] = [
  // ---- app basics -------------------------------------------------------
  E({
    id: 'invented-lib-urls',
    title: 'Invented script/style URLs 404 and break the app',
    symptom: 'The app references a plausible-looking node URL (e.g. /i18n/translations.js, /components/x.js) that does not exist. Publishing REFUSES a node path that answers 404 (APP_ARTIFACT_BROKEN); a relative path or an outside host only gets a warning, and then the page half-loads in the browser.',
    fix: 'Only load URLs the build spec lists. Fetch GET /v1/prompts/build-app first and use exactly the library and script URLs it names, and GET /v1/library-packs for everything the node vendors. Never guess one.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'inline-js-does-not-parse',
    title: 'An inline <script> that does not parse takes the whole app with it',
    symptom: 'The page renders its static HTML and then nothing works: no data, no handlers, no login bar. The browser stopped at the syntax error and never reached anything after it. Publishing REFUSES a classic inline block that does not parse (APP_ARTIFACT_BROKEN). A `<script type="module">` block is not parsed by the gate, and the publish answer says so with a warning, so a module with a syntax error still goes live.',
    fix: 'Parse before you publish, module blocks especially: `node -e \'new (require("vm").Script)(require("fs").readFileSync(process.argv[1],"utf8"))\' block.js` on each inline body, or move a module into its own file and run `node --check`. The classic cause is a literal closing script tag inside a JS string or comment: the HTML parser ends the block there, mid-statement, so build one from pieces: `"</" + "script>"`.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'app-meta-declarations',
    title: 'The three head declarations an app is expected to make',
    symptom: 'The language switch never appears in the login pill, sign-in asks for less than the app needs (ai:use is unavailable, deletes 403), sign-in does nothing at all, or AIMEATAgentFace.publish cannot work out which app it belongs to on a per-app subdomain.',
    fix: 'Declare them, one line each: `<meta name="aimeat-app" content="my-app.html">` (your published filename), `<meta name="aimeat-scopes" content="memory:read memory:write ai:use">` (what sign-in asks the user to approve; declaring nothing gets the four-word default, and declaring replaces the default rather than adding to it), `<meta name="aimeat-locales" content="en fi">` (the languages you have; two or more draw the switch in the login pill). One word in aimeat-scopes that the node cannot grant refuses the WHOLE sign-in with INVALID_SCOPE; GET /v1/app-grants/scopes lists the grantable words, and the publish answer warns about any other.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'app-declared-unused',
    title: 'Loaded, declared, and never used',
    symptom: 'The published app opens with no sign-in and no way to change language or theme, or it downloads daisyUI and renders unstyled. Every stylesheet is linked and none of it shows. The publish answer warns about all three shapes; the person finds it in five seconds by opening the app.',
    fix: 'Start from what the node hands you, never from an empty page. A new app forks a genre (`aimeat_app_template_get { id: "genre-<id>" }`) and adds the sign-in bar the way the Atelier specification\'s fork section shows. An app already on Classic keeps its shell from `GET /v1/app-templates`, which carries the login pill (the sign-in, the language switch and the theme control), daisyUI and the head declarations. If you keep a stylesheet or `aimeat-auth.js` in the head, use what it provides: mount the bar with `AIMEAT.auth.mountLoginButton(sel, { onSession })`, which restores a returning session and handles a fresh sign-in (see handle-both-auth-paths).',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),
  E({
    id: 'track-mixing',
    title: 'An app built from two guides at once',
    symptom: 'The app declares one build track and carries the other track\'s vocabulary: Classic declared with the Atelier shell drawn (atelier.app()) or with the kit loaded and nothing in it called, Atelier declared with the kit missing or with raw daisyUI class markup outside a section escape hatch, or the Atelier kit loaded with no track declared at all. Publishing warns; the visible cost comes later, when an edit session loads the declared track\'s guide and half-understands the file.',
    fix: 'Pick the track first and stay on it. `<meta name="aimeat-track" content="classic">` means daisyUI classes and the Classic build guide; `content="atelier"` means the Atelier kit is the vocabulary, and raw markup lives only inside a section body the app fills itself (`AIMEAT.atelier.section`). The declaration is what routes every later improve session to the right guide, so it must match what the page actually does. A Classic page may load the kit for the library blocks it uses (AIMEAT.atelier.members, joinRequest, aiTask, copy, workspaceTeam); that is not a mix.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-08-27',
    ...CHECKED,
  }),
  E({
    id: 'below-level',
    title: 'The app is not at the level its owner chose',
    symptom: 'The owner asked for an app and found out by looking at the result what kind of app they got: a bare stack of components where they expected something worth showing, or an hour of styling where they wanted to try one idea today. The builder chose the level, usually the one that was least work. Publishing warns (`app_hints`, pitfall `below-level`) when a page that states `aimeat-level` "proto" or "plain" carries a sheet of styles of its own, and refuses (`atelier-register`) a page that states "fine", or no level, and names no register.',
    fix: 'Ask the level BEFORE any code, in plain words, and say what each one gets them: a quick prototype (the kit\'s components as they come, no styling), an ordinary page (a ready layout and look from the Design Book, following their theme), or the finest (a forked genre, the Book\'s proven parts, components of its own, each written down with its reason). All three are Atelier, in two languages, with the data on the owner\'s node, so raising the level later is a change of look and never a rewrite. State it in the head: `<meta name="aimeat-level" content="proto">`, `"plain"` or `"fine"`. A page that states none is held to the finest. Never pick a lower level on the owner\'s behalf.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-19',
    ...CHECKED,
  }),
  E({
    id: 'hand-rolled',
    title: 'A mechanism written by hand that a library of this node already is',
    symptom: 'The app runs its own speech recognition loop, its own audio graph, its own `fetch` to `/v1/memory`, `/v1/ai/` or `/v1/storage`, its own `EventSource` to the node, its own notification, its own language control, keeps a person\'s data under several `localStorage` keys, or draws a chart in code (SVG shapes or a 2d canvas) on a page that loads the Atelier kit. It works on the day it ships. It stops following the platform the day the route, the token handling or the consent rule behind it changes, and nobody is told. Publishing warns (`app_hints`, pitfall `hand-rolled`) when the page uses the browser API and loads none of the libraries that would have done it.',
    fix: 'Read the list of libraries BEFORE writing a mechanism: `GET /v1/libs`, or part `libraries` of the build specification. Speech and conversation: `aimeat-voice`. Instruments and samples: `aimeat-audio`. A person\'s data: `aimeat-data`, one record per thing. A model: `aimeat-ai`, or `aimeat-decide` for a decision. Files: `aimeat-storage`. Live updates: `aimeat-live`. Notifications: `aimeat-push`. A chart, a gauge or a radar: `AIMEAT.atelier.chart` (with `kind: "radar"` for a radar) and `AIMEAT.atelier.gauge`, which draw in the page\'s own tokens; a genre that draws its own figures keeps them, and the warning stays quiet there. The language switch is in the sign-in bar. A draft or a preference in `localStorage` is fine. If the hand-written mechanism is deliberate, say why to the owner.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),
  E({
    id: 'genre-not-forked',
    title: 'A genre\'s name over a page that is not its fork',
    symptom: 'The head says `aimeat-register` `genre-<id>` and the page is the default look with a hero, forms and cards stacked in it: the same dashboard every app becomes, in new paint. It passes the register gate, which asks only that a register is named, and it passes contrast, width and tap-size checks, none of which say whether the page is any good. Publishing warns (`app_hints`, pitfall `genre-not-forked`) when the page carries under a fifth of the genre\'s own styles; a real fork keeps about four fifths.',
    fix: 'Fork the genre: `aimeat_app_template_get { id: "genre-<id>" }` returns the whole page. Keep its composition, its type and its physics, and change the words, the sources and the images; let kit components serve the page where it needs a live part. A look preset is for a screen with no genre of its own. If the page has a look of its own, declare `content="custom:<name>"`. Before handing over, put it beside the genre at 390 and 1440 px in both themes and ask whether it holds up: passing tests do not answer that.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-19',
    ...CHECKED,
  }),
  E({
    id: 'one-language',
    title: 'A new app that speaks one language',
    symptom: 'The app declares `aimeat-locales` with one language, so the sign-in bar draws no language switch, or it declares two and its strings are typed into the markup, so the switch changes the bar and nothing else. It usually happens because the builder was talking to the owner in that language and took it for the app\'s, or because it forked a genre, which carries one language. Publishing a NEW one-language app warns (`app_hints`, pitfall `one-language`).',
    fix: 'Two languages is the default: `<meta name="aimeat-locales" content="en fi">`. Put every string the page shows in a dictionary and paint from it: on the Atelier track `AIMEAT.atelier.i18n.use({ en: {...}, fi: {...} })`, `i18n.t(key)`, and `i18n.onChange(paint)`, with the node\'s own bar mounted by `AIMEAT.auth.mountLoginButton(\'#pill\', ...)`; never a switch of your own. The switch keeps what the person was doing. One language is the owner\'s decision: ask, do not decide. Before handing over, press the switch both ways in the middle of using the app and read every screen in both.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-19',
    ...CHECKED,
  }),
  E({
    id: 'track-drift',
    title: 'A new app that ended up on the Classic track',
    symptom: 'A new app is published on Classic, or a build that read the Atelier specification publishes an app with no Atelier kit in it. It works and it looks like every hand-built page: a header written by hand, a sign-in bar that breaks at phone width, states nobody designed. Publishing warns (`app_hints`, pitfall `track-drift`). It happens because the Classic shell can be started from at once and the Atelier road asks for a genre and its own specification first.',
    fix: 'A new app is built on the Atelier track: load `node:aimeat-app-builder-atelier`, read its specification (`aimeat_handbook_get { tier: "build-app-atelier" }`, in parts; over HTTP `GET /v1/prompts/build-app-atelier`), fork a genre (`aimeat_designbook_search { kind: "genre" }`, then `aimeat_app_template_get { id: "genre-<id>" }`) and keep its shell. Classic is for improving an app that is already Classic, or when the owner asks for it by name, and then you say so to the owner. Never change track in the middle of a build: stop and tell the owner what you found.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-19',
    ...CHECKED,
  }),
  E({
    id: 'atelier-register',
    title: 'An Atelier app that never chose a look',
    symptom: 'The app is the bare shell with words in it: stacked sections in the default look, the same page every other app built that way has. Publishing REFUSES this (APP_ARTIFACT_BROKEN): an Atelier app that states no `aimeat-level`, or states "fine", and has no `aimeat-register` meta in its head, still has the shell\'s REPLACE-ME placeholder, or names an empty `custom:` register, does not go live. A page whose owner chose "proto" or "plain" owes no register (see below-level).',
    fix: 'Start from a genre, never from the bare shell. `GET /v1/designbook?kind=genre` lists the committed registers and `GET /v1/app-templates/genre-<id>` hands over the whole page; every genre already carries `<meta name="aimeat-register" content="genre-<id>">`, so a fork passes the gate by construction. Swap the words, sources and images for the app at hand and keep the physics. A page that commits to a look of its own names it: `<meta name="aimeat-register" content="custom:<name>">`, where the name says what the register is (custom:game, custom:ledger), never "default". The bare shell is a frame, not a page.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),
  E({
    id: 'namespace-rule',
    title: 'Data your agents wrote is not in the owner\'s namespace',
    symptom: 'The app shows the signed-in owner an empty screen while the data is plainly there: an agent wrote it minutes ago, the owner can see it in their own memory list, and the app\'s list() returns nothing at all. Or a delete answers ok and the record is still there, or an agent\'s update never shows because the owner holds an older copy of the same key.',
    fix: 'An agent writes under ITS own identity (`name#owner@node`), and an app token is role `app`, which gets no automatic owner-scope broadening, so an unscoped read legitimately finds nothing. Name the namespace on every operation: `AIMEAT.data.list({ prefix, ownerScope: true })` covers the owner GHII and every agent of theirs (each item carries owner_gaii), `{ agent: "name#owner@node" }` picks one, `AIMEAT.data.getPublic(gaii, key)` reads a specific public record, and `AIMEAT.data.delete(key, { ownerScope: true })` removes a key an agent wrote (check what it answers rather than catching and ignoring it, or a refused delete looks done). When the owner and an agent both hold one key, owner-scope reads return the owner\'s copy. The build spec states this under "Namespace rule".',
    appliesTo: ['app', 'auth'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'cdn-libs-blocked',
    title: 'CDN libraries are one CSP tightening away from a blank screen',
    symptom: 'A <script src="https://cdn.jsdelivr.net/..."> works today, because the app CSP still allows https script hosts, and the publish answer warns about it. The app goes blank on the day a node tightens its CSP to its own origin.',
    fix: 'Use the node-vendored equivalents under /lib/ and /v1/libs/ (/lib/tailwindcss@4.js, /lib/daisyui@5.css + /lib/aimeat-daisyui-bridge.css, /lib/chartjs@4.js, ...). GET /v1/library-packs lists what the node serves. Load nothing from a CDN.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'provenance-without-model',
    title: 'The AI label says who served the model and not which model',
    symptom: 'The app was published with an `ai_provenance` block that gives `level` (and often `provider`) but no `model`. The public "How this was made" page then shows "Served by openai" and no model row, and nobody can tell from the record which model wrote the app. The node cannot fill the gap: it did not watch the generation, and a publish with the owner\'s own token has no agent record to read a model from. Publishing warns (`app_hints`, pitfall `provenance-without-model`).',
    fix: 'Name your own model in every declaration: `ai_provenance: { level: "ai-generated", model: "openai/gpt-6", provider: "openai" }`, with the id as your provider names it. Take it from your own configuration; do not ask the person. The record is bound to one version, so the next publish is where the model appears.',
    appliesTo: ['app', 'ai', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-26',
    ...CHECKED,
  }),
  E({
    id: 'hardcoded-theme-colors',
    title: 'Hardcoded colors make the light/dark toggle look broken',
    symptom: 'The login pill\'s mode switch flips <html data-theme> and fires the `aimeat-theme-change` window event, but the app never repaints: users report "the dark/light button does nothing". Publishing warns about hardcoded chrome colours.',
    fix: 'Drive chrome colours off data-theme: the /lib/aimeat-theme.css tokens (what the shells link), daisyUI tokens via the bridge CSS, or your own :root + :root[data-theme="light"] variables. Restore the saved mode before first paint (the shells carry the inline script reading localStorage["aimeat-theme"]). A page that deliberately keeps its own light, a tracker grid or a canvas, says so with `<meta name="aimeat-light" content="fixed">`, which turns the switch off instead of leaving it dead.',
    appliesTo: ['app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'body-background-seam',
    title: 'A background gradient on body draws a seam one screen down',
    symptom: 'A full-page gradient ends in a hard horizontal line at exactly one viewport height on any page taller than the window. `background-attachment: fixed` produces the same line by another route.',
    fix: 'The body background propagates to the canvas, so `background-size: 100% 100%` resolves against the root element, not the body. Put the background on an ordinary element that grows with the content: `#app { min-height: 100dvh; background: ... }`.',
    appliesTo: ['app', 'mobile'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- whose data it is --------------------------------------------------
  // TalentGrid on innokas.aimeat.io, 2026-10-17: a company asked for ONE shared talent database
  // and got an app where every person keeps their own (plan doc-mvcn6c7e4e5q, V7).
  E({
    id: 'team-data-in-personal-memory',
    title: 'A team app built on per-user memory gives every person an empty copy',
    symptom: 'Each person sees only what they entered themselves, while the team expected one shared list: a colleague adds a candidate and nobody else sees it. The cause is that the app keeps the team\'s data in each signed-in person\'s own memory (AIMEAT.data, or memory keys under the person), which is private to that person by design.',
    fix: 'Ask the data map step of the build interview BEFORE building: who opens the app, whose each kind of data is (personal, shared by the team, public), who may change the shared data; then confirm a short scenario with named people and wait for a yes. Keep team data in ONE organism workspace (AIMEAT.organism read, writeDraft, publish; AIMEAT.organism.findOrCreateWorkspace or the kit\'s workspacePicker picks it on the first run), keep only each person\'s own view in AIMEAT.data, and limit who opens the app with its open_to setting (signed-in, or organism:<id>). An app already live with team data per person needs the records carried into the workspace once.',
    appliesTo: ['app'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),

  // ---- auth from an app origin -----------------------------------------
  E({
    id: 'login-is-silent-only',
    title: 'AIMEAT.auth.login() restores a session; AIMEAT.auth.signIn() is the one that asks',
    symptom: 'A hand-rolled "Sign in" button calling AIMEAT.auth.login() does nothing when there is no session to restore: login() is silent, returns null and never opens anything.',
    fix: 'Call `AIMEAT.auth.login()` at start to restore, and `AIMEAT.auth.signIn()` from your own button\'s click handler to sign in: it runs the interactive grant inside the user gesture on an app origin and opens the sign-in dialog elsewhere, resolving to the session or null. The login pill\'s own button calls the same function. Never script a click on the pill: its first button is the language and theme cluster, not Sign In.',
    appliesTo: ['auth', 'app'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'handle-both-auth-paths', status: 'outdated',
    title: 'Show the app from onSession: onLogin alone misses a returning user',
    symptom: 'The app works on first sign-in but shows logged-out UI after a reload: onLogin fires on a fresh interactive sign-in, not on a session restored in the background.',
    fix: 'Outdated 2026-10-17 (node 4.0.3): the build specification\'s session section and the aimeat-auth library guide state onSession. Pass your "session ready" handler as `mountLoginButton(sel, { onSession: ready })`: it runs once for a restore (`restored: true`) and for a sign-in (`restored: false`), so there is one path instead of two. Without onSession, wire both: `AIMEAT.auth.login().then(s => { if (s) ready(s); })` for the restore and `onLogin: ready` for a fresh sign-in, and make ready() safe to run twice. The pill renders signed-in only from a live session, so a stale stored one no longer shows "logged in" over an app that cannot call anything.',
    appliesTo: ['auth', 'app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'apps-localhost-cross-site',
    title: '*.apps.localhost is cross-site with localhost — silent SSO fails locally',
    symptom: 'App-origin auto-login fails on local dev (no apex cookie reaches the SSO iframe) while the same app logs in fine on prod (*.apps.aimeat.io is same-site with aimeat.io).',
    fix: 'For local app-origin verification sign in with AIMEAT.auth.loginWithPassword(...) evaluated ON the app origin, and do not reload (app-origin login() is bridge-only by design). Do not "fix" the app for this — it is a local-environment artifact.',
    appliesTo: ['auth'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-07-19',
    ...CHECKED,
  }),

  // ---- extensions & cortex ---------------------------------------------
  E({
    id: 'three-namespaces',
    title: 'Owner, extension and instance namespaces: never confuse them',
    symptom: 'Translations or settings "not found", an extension reads the wrong store, or a person\'s data kept by an extension is readable by anyone. Classic mistake: reading user data via getPublic("ext:...").',
    fix: 'Owner data (translations, settings, user content) is read via AIMEAT.data.get(key), e.g. AIMEAT.data.get("service.i18n.fi"). Extension data (`ext:{name}`) is written ONLY by the extension and read via the public getter; an instance of an extension has its own `ext:{name}.{instanceId}`. An extension\'s writes are public by default: pass `{ visibility: "private" }` on EVERY ctx.memory.set that holds somebody\'s personal data. The extension is sovereign, cortex trusts the ext API, the app trusts cortex, and no layer bypasses the one below.',
    appliesTo: ['ext', 'cortex'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'callext-path',
    title: 'Extension actions are called at POST /v1/ext/{name}/{action}',
    symptom: 'POST /v1/extensions/{name}/actions/{action} answers 404. That path exists only for GET and PATCH, which read and patch the action\'s script for its installer.',
    fix: 'Call extension actions at POST /v1/ext/{name}/{actionId} (an instance: /v1/ext/{name}/{instanceId}/{actionId}) with AIMEAT.data.action(name, actionId, input), which uses the session when someone is signed in. An action requires a signed-in caller unless its manifest says `public: true`; a public one also answers a visitor, read-only.',
    appliesTo: ['ext'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-18',
    ...CHECKED,
  }),
  E({
    id: 'session-fetch-parsed',
    title: 'session.fetch returns the parsed envelope, and a refusal is a value, not an error',
    symptom: '`resp.json is not a function`; or the app renders nothing after a 403 because it read `resp.data` from `{ ok: false, error }`.',
    fix: 'Use the value session.fetch resolves to: it is the parsed envelope. Check `res.ok` before `res.data` and show `res.error.message` otherwise; a refusal does not throw. A body that is not JSON (a proxy error page) does reject, so keep a catch.',
    appliesTo: ['app', 'ext', 'cortex'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),
  E({
    id: 'ext-manifest-strict',
    title: 'Extension/cortex manifests are strict — one missing field fails the install',
    symptom: 'An install is refused wholesale: identity fields not under metadata:, an action missing id/method/path/script, a YAML value with an unquoted colon, or a cortex lib whose api_surface is not a string. The refusal names the field, and a YAML error names the line and column.',
    fix: 'Extension manifests: name/version/description/author under metadata:, and EVERY action needs id + method + path + script. Cortex manifests are k8s-style (apiVersion: cortex.aimeat.org/v1, kind: Extension, metadata.name + namespace, spec.version) with libs as spec.components type: lib entries carrying exports (a list) and api_surface (a string; write it as a YAML block scalar). Quote any description that contains a colon, and write schemas in YAML block style. Copy the examples from the build spec (GET /v1/prompts/build-extension).',
    appliesTo: ['ext', 'cortex'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'cortex-register-reactivate',
    title: 'Cortex register shape, and PUT to ship new code',
    symptom: 'A cortex install refused for a lib with no bytes (`{ lib: ... }` instead of `{ libs: ... }`), or new code that never reaches the page because activate on an active cortex does nothing.',
    fix: 'Install with `{ manifest, libs: { "file.js": code } }`; every lib component needs its bytes under libs, or the install is refused naming the file. Ship new code with PUT /v1/cortex/:name, which replaces the cortex in place and re-runs its init; activating one that is already active is a no-op.',
    appliesTo: ['cortex'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- AI calls from apps ----------------------------------------------
  E({
    id: 'no-max-tokens',
    title: 'Do not cap an AI call\'s output, and read `truncated` on every answer',
    symptom: 'An answer that stops mid-sentence and reads like a model failure. A cap cuts it in silence, and so can a limit the owner saved in their AI settings.',
    fix: 'Do not pass max_tokens to AIMEAT.ai.complete(). Every answer carries `finish_reason` and `truncated` (true when the provider cut it at a length limit): when truncated is true, show the answer as unfinished or ask again, never as the whole answer. A generation that needs minutes belongs in AIMEAT.ai.job: a text job runs with no cap, a limit the owner saved included, and the record from AIMEAT.ai.job.get() or waitFor() carries the same `finish_reason` and `truncated`.',
    appliesTo: ['ai'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-10-19',
    ...CHECKED,
  }),
  E({
    id: 'long-ai-calls-timeout',
    title: 'A generation that takes minutes is a job, not a held-open request',
    symptom: 'A long completion from the app dies with the tab, the network or a proxy timeout, and the person clicks again and pays twice.',
    fix: 'AIMEAT.ai.complete() holds one request open and never retries on its own, so keep it for answers that come back in seconds. For anything longer use `AIMEAT.ai.job.start({ prompt, result_key })` and `AIMEAT.ai.job.waitFor(id)`: the node runs it with the owner\'s key, writes the answer to result_key, and the page can close in between.',
    appliesTo: ['ai'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- publishing over MCP ---------------------------------------------
  E({
    id: 'edit-published-app',
    title: 'Editing a published app: seed a draft, change it, publish it under the same filename',
    symptom: 'Rebuilding an app from scratch, publishing under a new filename, or looking for the source in aimeat_app_get (which returns the manifest, not the HTML) loses version history and forks the audience.',
    fix: 'aimeat_app_draft_seed copies the live app into a draft on the node; change it with aimeat_app_draft_read / aimeat_app_draft_replace, open its preview_url, and publish with aimeat_app_draft_publish under the SAME filename, which bumps the version. When you need a local copy, GET the app\'s download_url (the stored file). A copy saved from the inline page carries the node\'s serve marks; publishing one still works, because the publish removes those marks before storing and names them in served_marks_removed, but the stored file is the one to edit.',
    appliesTo: ['publish'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'syntax-check-that-checked-nothing',
    title: 'A syntax check handed no file reports a pass for nothing',
    symptom: '"SYNTAX OK" for a file that was never parsed. `node --check bad.js` correctly exits 1, but `node --check $FILE` with $FILE empty or unset reads empty stdin, parses that, and exits 0 printing nothing, identical to a real pass. One unset variable voids every syntax claim in the session.',
    fix: 'Name the file explicitly and let a read error be an error: node -e \'const f=process.argv[1],s=require("fs").readFileSync(f,"utf8");new (require("vm").Script)(s,{filename:f});console.log("parsed:",f)\' app-script.js',
    appliesTo: ['publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- mobile ------------------------------------------------------------
  E({
    id: 'mobile-means-fullscreen',
    title: '"Mobile-optimized" means native full-screen, not trimmed CSS',
    symptom: 'A focused view (chat, editor, wizard) still shares the screen with app chrome on a phone and feels cramped; incremental CSS trims never satisfy.',
    fix: 'Make the active view take the whole screen under @media (max-width:760px): position: fixed; inset: 0 gated on an is-active class, hide the surrounding chrome, and provide a Back affordance. Give a bottom input row `padding-bottom: var(--aimeat-chrome-bottom, 46px)` so it clears the node\'s own bottom marks.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-17',
    ...CHECKED,
  }),
  E({
    id: 'keyboard-viewport',
    title: 'Bottom-pinned inputs hide behind the on-screen keyboard',
    symptom: 'position:fixed;bottom:0 anchors to the LAYOUT viewport; the keyboard shrinks only the visual viewport, so the composer ends up under the keyboard, or a dead gap appears when the height is double-counted.',
    fix: 'The shells already carry interactive-widget=resizes-content in the viewport meta; where a browser does not honour it, size the pane from visualViewport (body top to visualViewport bottom). With resizes-content, dvh ALREADY excludes the keyboard, so never also subtract the keyboard height. Keep a message list pinned to the bottom instead of scrollIntoView({block:"center"}) on the composer. Verify by focusing the input and shrinking the viewport height (780 to 440): the composer bottom should meet the viewport bottom.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'grid-track-blowout',
    title: 'One wide child inflates a 1fr grid track and the whole page overflows',
    symptom: 'ONE view overflows horizontally on mobile while sibling views are fine — a non-wrapping table/<pre>/long code inside an overflow-x:auto wrapper still pushes the page wide, because the grid track grew to its min-content.',
    fix: 'Use grid-template-columns: ... minmax(0,1fr) and/or min-width:0 on the grid/flex children so the track can shrink and the inner overflow-x:auto actually scrolls. Verify per element at 390px with the measure the build specification gives in its mobile section: under the shells\' body{overflow-x:clip} a scrollWidth check passes while the track is still too wide.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'auth-pill-overflow',
    title: 'The login pill next to other header widgets overflows a portrait phone',
    symptom: 'On a ~390px phone the page zooms out and every font renders tiny: an un-shrinkable header row (the pill beside a brand and extra toggles) forces shrink-to-fit.',
    fix: 'mountLoginButton renders compact on every origin by default: signed in, an account button with a popover; signed out, Sign In and one settings trigger. So: use the shell (or copy its head), put no other fixed-width widgets in the header row (the pill already carries language and theme), let flex children shrink (min-width:0), and keep body{overflow-x:clip} (clip, NOT hidden, which breaks position:sticky). Verify per element at 390px and phone landscape, with the measure the build specification gives in its mobile section.',
    appliesTo: ['mobile', 'auth'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'fixed-fab-drift',
    title: 'A fixed FAB drifts off-screen when the body scrolls horizontally',
    symptom: 'A position:fixed;right:16px floating button sits past the visible right edge on a phone: the body became horizontally scrollable (usually via a header overflow) and fixed anchors to the wider area.',
    fix: 'Kill the horizontal overflow at its source (shrinkable flex children, no extra fixed-width header widgets) instead of repositioning the FAB, and clip rather than hide the body\'s horizontal overflow.',
    appliesTo: ['mobile'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),
  E({
    id: 'flex-nav-wrap',
    title: 'A flex nav/toolbar row with a variable item count overflows on mobile',
    symptom: 'A row of tabs/chips, or a slide-deck pager (prev/next + one dot per slide), fits at a few items but pushes the page wider once the count grows.',
    fix: 'Add flex-wrap:wrap (+ a row-gap) so extra items fold to a second line instead of overflowing. Easy to miss because it only bites past a threshold — a pager that fit at 3 dots overflowed at 9.',
    appliesTo: ['mobile'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-07-19',
    ...CHECKED,
  }),
  E({
    id: 'heavy-widgets-on-a-phone',
    title: 'A desktop rich-text editor behind a phone keyboard is unusable',
    symptom: 'On a phone the WYSIWYG toolbar and its Write/Preview tabs take the space the keyboard leaves, and typing a paragraph means fighting the editor.',
    fix: 'At ≤760px open a plain auto-growing <textarea> and do not load the editor at all (/lib/toastui and similar): decide once at mount with matchMedia("(max-width:760px)").',
    appliesTo: ['mobile', 'app'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- realtime -----------------------------------------------------------
  E({
    id: 'realtime-handlers-before-connect',
    title: 'Register rt.on(...) handlers BEFORE rt.connect()',
    symptom: 'A peer who joined early never appears, or a broadcast from the first seconds is never seen: frames that arrive before a handler exists are not replayed.',
    fix: 'Attach your rt.on(...) handlers first, then call rt.connect(). Since realtime.js v1.3.0 two things forgive the other order: a `joined` handler added after the join is called with it, and a broadcast sent while the socket is still opening is queued and sent when it opens. peer-joined, broadcast and presence frames still are not replayed.',
    appliesTo: ['realtime'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-09-13',
    ...CHECKED,
  }),

  // ---- sending and scheduling -------------------------------------------
  E({
    id: 'schedule-next-run-needs-the-year',
    title: 'A schedule\'s next-run time without the year reads as this week',
    symptom: 'A schedule with a day-and-month cron shows a next run of "04.08. 21:00", which looks like this week and is next year. A failed one-shot (max_runs 1) no longer does this: the node turns it off and it has no next run.',
    fix: 'Print the year whenever you show a schedule\'s next-run time outside a month grid, and show lastRunResult and lastRunError beside it. A schedule that is off has no nextRunAt: show it as finished or failed from lastRunResult, never as upcoming.',
    appliesTo: ['app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-19',
    ...CHECKED,
  }),

  // ---- the words 4.0 checks ------------------------------------------------
  E({
    id: 'undeclared-scope-words',
    title: 'From 4.0 a route the app calls refuses a word its aimeat-scopes does not name',
    symptom: 'On a 4.0 node a signed-in app gets 403 SCOPE_DENIED from routes that answered on 3.x: an extension action (/v1/ext/..., AIMEAT.iam, AIMEAT.webhook, a cortex lib that calls one), the agent list (AIMEAT.agents.list, /v1/agents), organism workspaces (AIMEAT.organism.workspaces, AIMEAT.intake.listForms), schedules (POST /v1/schedules, AIMEAT.refinery.schedule), a schedule edit (PATCH /v1/schedules/:id), or an image or file that is not public read from /v1/pub with the visitor\'s token (a workspace document\'s images stay empty). The publish answer warns with the word and the line that needs it.',
    fix: 'Name every word the code needs in `<meta name="aimeat-scopes">`, beside the four the app already uses: ext:invoke for an extension action, agent:read for the agent list, task:write for a task or a new schedule, workflow:write for a schedule edit, organism:read for an organism\'s workspaces, organism:invite for workspace access, social:write for a new realtime room, storage:read for a file from /v1/pub that is not public. Declaring replaces the default set, so keep memory:read memory:write storage:read storage:write in it. An app published before the node moved to 4.0 kept these words by itself (aimeat_app_manage scope_allowance names them); declaring them is still the fix, and a new app gets nothing kept.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-10-20',
    ...CHECKED,
  }),
];

/** Full entries, optionally including outdated ones (default: active only). */
export function getAppdevPitfalls(opts?: { includeOutdated?: boolean }): AppdevPitfallEntry[] {
  if (opts?.includeOutdated) return APPDEV_PITFALLS;
  return APPDEV_PITFALLS.filter(p => p.status !== 'outdated');
}

export interface AppdevPitfallIndexEntry {
  id: string;
  title: string;
  appliesTo: AppdevPitfallScope[];
  severity: AppdevPitfallEntry['severity'];
  source: 'curated';
  verifiedAt: string | null;
  verifiedVersion: string | null;
}

/** Compact index (no symptom/fix bodies) for overview surfaces and pickers. */
export function getAppdevPitfallIndex(opts?: { includeOutdated?: boolean }): AppdevPitfallIndexEntry[] {
  return getAppdevPitfalls(opts).map(p => ({
    id: p.id, title: p.title, appliesTo: p.appliesTo, severity: p.severity, source: p.source,
    verifiedAt: p.verifiedAt ?? null, verifiedVersion: p.verifiedVersion ?? null,
  }));
}

/** Facet counts (per applies-to scope and per severity) so agents can page deliberately. */
export function getAppdevPitfallFacets(entries?: AppdevPitfallEntry[]): {
  applies_to: Record<string, number>;
  severity: Record<string, number>;
} {
  const list = entries ?? getAppdevPitfalls();
  const applies_to: Record<string, number> = {};
  const severity: Record<string, number> = {};
  for (const p of list) {
    for (const scope of p.appliesTo) applies_to[scope] = (applies_to[scope] ?? 0) + 1;
    severity[p.severity] = (severity[p.severity] ?? 0) + 1;
  }
  return { applies_to, severity };
}
