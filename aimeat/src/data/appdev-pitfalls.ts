/**
 * @file appdev-pitfalls.ts
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

/** Facet a pitfall applies to. Kept small and app-build-shaped on purpose. */
export type AppdevPitfallScope =
  | 'app'       // single-file HTML app itself
  | 'auth'      // login / session / identity from an app origin
  | 'ext'       // sandboxed extensions
  | 'cortex'    // cortex layer / libs
  | 'iam'       // apps with their own users/roles (aimeat-iam)
  | 'realtime'  // AimeatRealtime multiplayer
  | 'ai'        // AI calls from apps
  | 'mobile'    // mobile / viewport / keyboard
  | 'publish';  // publishing & updating apps over MCP

export interface AppdevPitfallEntry {
  /** Stable kebab-case id (referenced from prompts and learned-KB dedup). */
  id: string;
  title: string;
  /** What the builder observes when they hit it. */
  symptom: string;
  /** What to do instead. */
  fix: string;
  appliesTo: AppdevPitfallScope[];
  severity: 'info' | 'warn' | 'critical';
  source: 'curated';
  /** Entries can be superseded without deletion: outdated drops from default views. */
  status?: 'active' | 'outdated';
  /** Pointer into repo docs for maintainers (not served meaningfully to agents). */
  docRef?: string;
  updatedAt: string;
}

const E = (e: AppdevPitfallEntry): AppdevPitfallEntry => e;

export const APPDEV_PITFALLS: AppdevPitfallEntry[] = [
  // ---- app basics -------------------------------------------------------
  E({
    id: 'invented-lib-urls',
    title: 'Invented script/style URLs 404 and break the app',
    symptom: 'The app references a plausible-looking node URL (e.g. /i18n/translations.js, /components/x.js) that does not exist; the page half-loads or throws.',
    fix: 'Only load URLs the build spec lists. Fetch GET /v1/prompts/build-app first and use exactly the library/script URLs it names — never guess one.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'inline-js-does-not-parse',
    title: 'An inline <script> that does not parse takes the whole app with it',
    symptom: 'The page renders its static HTML and then nothing works — no data, no handlers, no login bar. The browser stopped at the syntax error and never reached anything after it. Publishing REFUSES this (APP_ARTIFACT_BROKEN): the node parses every inline block before the app goes live.',
    fix: 'Parse before you publish: `cd aimeat && pnpm check:js-syntax --html your-app.html` compiles every inline <script> body without running it, and the publish gate uses that same parser. The classic cause is a literal closing script tag inside a JS string or comment — the HTML parser ends the block there, mid-statement — so build one from pieces: `"</" + "script>"`.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-08-11',
  }),
  E({
    id: 'app-meta-declarations',
    title: 'The three head declarations an app is expected to make',
    symptom: 'The language switch never appears in the login pill, sign-in asks for less than the app needs (ai:use is unavailable, deletes 403), or AIMEATAgentFace.publish cannot work out which app it belongs to on a per-app subdomain.',
    fix: 'Declare them, one line each: `<meta name="aimeat-app" content="my-app.html">` (your published filename), `<meta name="aimeat-scopes" content="memory:read memory:write ai:use">` (what sign-in asks the user to approve — an app that declares nothing gets the default grant only), `<meta name="aimeat-locales" content="en fi">` (the languages you have; this is what draws the segmented switch in the login pill).',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-08-11',
  }),
  E({
    id: 'app-declared-unused',
    title: 'Loaded, declared, and never used',
    symptom: 'The published app opens with no sign-in and no way to change language or theme, or it downloads daisyUI and renders unstyled. Every stylesheet is linked and none of it shows. The person finds this in five seconds by opening the app; no tool said anything.',
    fix: 'Fetch `GET /v1/app-templates` and build on a shell. It already carries the login pill (which IS the sign-in, the language switch and the theme control), the design system, and the head declarations in their correct form. Writing the page from nothing means reproducing all of that from memory, and what actually happens is that it is left out — the app looks finished to whoever built it, because the only way to see the gap is to open it. If you keep a stylesheet or `aimeat-auth.js` in the head, use what it provides; a library that is loaded and unused is a page that looks connected and is not.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-08-15',
  }),
  E({
    id: 'namespace-rule',
    title: 'Data your agents wrote is not in the owner\'s namespace',
    symptom: 'The app shows the signed-in owner an empty screen while the data is plainly there — an agent wrote it minutes ago, the owner can see it in their own memory list, and the app\'s list() returns nothing at all.',
    fix: 'An agent writes under ITS own identity (`name#owner@node`), and an app token is role `app`, which gets no automatic owner-scope broadening — so an unscoped read legitimately finds nothing. Name the namespace: `AIMEAT.data.list({ prefix, ownerScope: true })` covers the owner GHII and every agent of theirs, `{ agent: "name#owner@node" }` picks one, and `AIMEAT.data.getPublic(gaii, key)` reads a specific public record. The build spec states this under "Namespace rule".',
    appliesTo: ['app', 'auth'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-08-11',
  }),
  E({
    id: 'cdn-libs-blocked',
    title: 'CDN libraries are one CSP tightening away from a blank screen',
    symptom: 'A <script src="https://cdn.jsdelivr.net/..."> works today but the app goes blank on a hardened node (CSP blocks external hosts).',
    fix: 'Use the node-vendored equivalents under /lib/ (/lib/tailwindcss@4.js, /lib/daisyui@5.css + /lib/aimeat-daisyui-bridge.css, /lib/chartjs@4.js, ...). Never load from a CDN.',
    appliesTo: ['app', 'publish'],
    severity: 'critical',
    source: 'curated',
    docRef: 'docs/pitfalls.md §12',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'unlabelled-ai-output',
    title: 'An app that generates content and never says so',
    symptom: 'The app requests the `ai:use` scope, shows model-written text to a reader, and nothing on the page says a model wrote it. Publishing warns (`ai_hints`) and records a gap on the app; the catalogue card shows an "Unlabelled AI" marker to the owner.',
    fix: 'Keep the `provenance` object AIMEAT.ai.complete() returns and render the label at first exposure: `AIMEAT.ai.disclose(r.provenance, { target: "#ai-label" })`. It draws the official EU label in the app\'s own theme and draws nothing when no label is owed. Declare `<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no">`, attach the record to anything stored with `AIMEAT.ai.declare(item, r.provenance)`, and open a chat with `AIMEAT.ai.chatNotice()`.',
    appliesTo: ['app', 'publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-08-01',
  }),
  E({
    id: 'ai-provenance-dropped-on-save',
    title: 'The label is on screen but the stored item forgot where it came from',
    symptom: 'The app renders the AI label correctly, then saves the generated item with AIMEAT.data.set() and the stored record carries no provenance. Anything reading the data later — another app, an agent, the owner in six months — reads it as content of unknown origin.',
    fix: 'Wrap the value: `await AIMEAT.data.set(key, AIMEAT.ai.declare(item, r.provenance))`. declare() returns a copy carrying `aiProvenance`, so the record travels with the content instead of living only in the DOM that rendered it once.',
    appliesTo: ['app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-08-01',
  }),
  E({
    id: 'biometric-inference-needs-your-own-notice',
    title: 'Emotion or attention inference is the app owner\'s own duty to declare',
    symptom: 'The app reads a webcam, a microphone or interaction data to infer mood, emotion, attention or any other biometric category, and relies on the platform label to cover it. The platform label describes GENERATED content; it says nothing about inference performed on a person.',
    fix: 'Tell the people exposed, in your own words, before the inference happens — `AIMEAT.ai.chatNotice({ target, title, body })` renders your wording. The duty sits with you as deployer, because only you know who is in front of the camera and why.',
    appliesTo: ['app'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-08-01',
  }),
  E({
    id: 'hardcoded-theme-colors',
    title: 'Hardcoded colors make the light/dark toggle look broken',
    symptom: 'The auth pill theme switch flips <html data-theme> but the app never repaints — users report "the dark/light button does nothing".',
    fix: 'Drive chrome colors off data-theme: use daisyUI tokens / var(--card) via the bridge CSS, or define :root + :root[data-theme="light"] variables. Restore the saved theme before first paint (inline script reading localStorage["aimeat-theme"]).',
    appliesTo: ['app'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §12',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'pub-urls-for-cross-user-files',
    title: 'Cross-user images/files need public /v1/pub/ URLs',
    symptom: 'Images or files embedded for OTHER users 404 or demand auth — the authed memory/file endpoints only serve the owner.',
    fix: 'For anything another user (or an anonymous visitor) must see, store it public and reference it via /v1/pub/{gaii}/{key} — the anonymous public-file URL pattern in the build spec.',
    appliesTo: ['app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),

  // ---- auth from an app origin -----------------------------------------
  E({
    id: 'login-is-silent-only',
    title: 'App-origin AIMEAT.auth.login() is silent-only',
    symptom: 'A hand-rolled "Sign in" button calling AIMEAT.auth.login() does nothing when silent SSO fails — login() only restores an existing session and returns null otherwise; it never opens UI.',
    fix: 'The only interactive sign-in path is the login bar. Mount it with AIMEAT.auth.mountLoginButton(...); a custom button must delegate its click to the bar\'s own button.',
    appliesTo: ['auth', 'app'],
    severity: 'critical',
    source: 'curated',
    docRef: 'docs/pitfalls.md §6',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'handle-both-auth-paths',
    title: 'Handle BOTH onLogin (fresh) and login() restore',
    symptom: 'The app works on first sign-in but shows logged-out UI after a reload — onLogin only fires on a fresh interactive login, not on session restore.',
    fix: 'Wire both paths at startup: call AIMEAT.auth.login() to restore an existing session AND register the onLogin/auth event callback for fresh logins; funnel both into one "session ready" handler.',
    appliesTo: ['auth', 'app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'apps-localhost-cross-site',
    title: '*.apps.localhost is cross-site with localhost — silent SSO fails locally',
    symptom: 'App-origin auto-login fails on local dev (no apex cookie reaches the SSO iframe) while the same app logs in fine on prod (*.apps.aimeat.io is same-site with aimeat.io).',
    fix: 'For local app-origin verification sign in with AIMEAT.auth.loginWithPassword(...) evaluated ON the app origin, and do not reload (app-origin login() is bridge-only by design). Do not "fix" the app for this — it is a local-environment artifact.',
    appliesTo: ['auth'],
    severity: 'info',
    source: 'curated',
    docRef: 'docs/pitfalls.md §6',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'app-grant-role-limits',
    title: 'App tokens are role "app" — they never pass agent role gates',
    symptom: 'An app-grant token gets 403 on organism create/join or workspace structure ops regardless of scopes.',
    fix: 'Published apps needing server-side rules use an extension (ext: namespace + action checks), not organism/agent primitives. Design the data model inside the app\'s own grantable scopes.',
    appliesTo: ['auth', 'ext'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §6',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'app-grant-node-role-via-owners',
    title: 'App tokens carry roles:["app"] — read the owner\'s NODE role via GET /v1/owners/:name',
    symptom: 'The app cannot tell whether the signed-in user is a node operator/admin — session.roles on an app origin is just ["app"], so a node-role check is always false.',
    fix: 'The app-grant token identifies the owner (session.owner) but NOT their node roles. To check a node-level role (e.g. operator), fetch GET /v1/owners/{session.owner} with the session jwt — it returns the roles array to the owner themselves (anonymous callers get name/display_name only, so nothing leaks). Probe it after login and re-render when it resolves.',
    appliesTo: ['auth', 'app'],
    severity: 'info',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),

  // ---- extensions & cortex ---------------------------------------------
  E({
    id: 'three-namespaces',
    title: 'Owner vs extension memory namespaces — never confuse them',
    symptom: 'Translations/settings "not found", or an ext reads the wrong store. Classic mistake: reading user data via getPublic("ext:...").',
    fix: 'Owner data (translations, settings, user content) is read via AIMEAT.data.get(key). Extension data (ext:{name}) is written ONLY by the extension and read via the public getter. The extension is sovereign; cortex trusts the ext API; the app trusts cortex — no layer bypasses the one below.',
    appliesTo: ['ext', 'cortex'],
    severity: 'critical',
    source: 'curated',
    docRef: 'docs/pitfalls.md §8',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'callext-path',
    title: 'Extension action path is /v1/ext/{name}/{action}',
    symptom: '404 calling /v1/extensions/{name}/actions/{action} — that route does not exist.',
    fix: 'Call extension actions at /v1/ext/{name}/{actionId} (via the session/cortex fetch helpers).',
    appliesTo: ['ext'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §8',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'session-fetch-parsed',
    title: 'session.fetch returns PARSED JSON',
    symptom: 'resp.json is not a function.',
    fix: 'Use resp.data directly — the session/cortex fetch helper has already parsed the envelope.',
    appliesTo: ['ext', 'cortex'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §8',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'ext-manifest-strict',
    title: 'Extension/cortex manifests are strict — one missing field fails the install',
    symptom: 'An install is rejected wholesale: identity fields not under metadata:, or an action missing id/method/path/script; a cortex lib without exports/api_surface is invisible to agents.',
    fix: 'Extension manifests: name/version/description/author under metadata:, and EVERY action needs id + method + path + script. Cortex manifests are k8s-style (apiVersion: cortex.aimeat.org/v1, kind: Extension, metadata.name + namespace) with libs as spec.components type: lib entries carrying exports + api_surface. Copy the current examples from the build spec / guides — old copies drift.',
    appliesTo: ['ext', 'cortex'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §8',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'cortex-register-reactivate',
    title: 'Cortex register shape + re-activate order',
    symptom: 'A cortex register rejected ({ lib: ... } instead of { libs: ... }), or a re-activate that silently keeps the old version.',
    fix: 'Register with { libs: { "file.js": code } }. Re-activate = deactivate first, then activate.',
    appliesTo: ['cortex'],
    severity: 'info',
    source: 'curated',
    docRef: 'docs/pitfalls.md §8',
    updatedAt: '2026-07-19',
  }),

  // ---- AI calls from apps ----------------------------------------------
  E({
    id: 'no-max-tokens',
    title: 'Never set max_tokens on an AI call',
    symptom: 'Truncated completions that look like model failures.',
    fix: 'Do not pass max_tokens to AIMEAT.ai.complete() or any LLM call — remove it on sight and let the model finish.',
    appliesTo: ['ai'],
    severity: 'critical',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'long-ai-calls-timeout',
    title: 'Long AI calls need a long timeout and NO retries',
    symptom: 'A long completion aborts mid-flight or double-fires (and double-bills) — default fetch timeouts/retries are tuned for short calls.',
    fix: 'For long generations use an explicit long timeout (e.g. timeoutMs: 1_800_000) with retries: 0 on the request helper, instead of the default POST helper.',
    appliesTo: ['ai'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §9',
    updatedAt: '2026-07-19',
  }),

  // ---- publishing over MCP ---------------------------------------------
  E({
    id: 'presigned-over-inline',
    title: 'Publish files >1 KB via presigned upload, never inline base64',
    symptom: 'A large app inlined as base64 wastes enormous context/tokens and can hit size caps.',
    fix: 'Call aimeat_app_publish (or storage upload) WITHOUT the content param → receive upload_url → PUT the raw file: curl -s -X PUT "<upload_url>" -H "Content-Type: text/html" --data-binary @app.html.',
    appliesTo: ['publish'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'edit-published-app',
    title: 'Editing a published app: fetch → edit → republish same filename',
    symptom: 'Rebuilding an app from scratch (or publishing under a new filename) loses version history and forks the audience.',
    fix: 'aimeat_app_get to fetch the live source, edit locally, syntax-check the inline JS, republish via upload mode with the SAME filename — republish bumps the version, it does not duplicate. Keep the old download for rollback.',
    appliesTo: ['publish'],
    severity: 'info',
    source: 'curated',
    docRef: 'docs/pitfalls.md §12',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'syntax-check-that-checked-nothing',
    title: 'A syntax check handed no file reports a pass for nothing',
    symptom: '"SYNTAX OK" for a file that was never parsed. `node --check bad.js` correctly exits 1, but `node --check $FILE` with $FILE empty or unset reads empty stdin, parses that, and exits 0 printing nothing — identical to a real pass. One unset variable voids every syntax claim in the session.',
    fix: 'Name the file explicitly and let a read error be an error: node -e \'const f=process.argv[1],s=require("fs").readFileSync(f,"utf8");new (require("vm").Script)(s,{filename:f});console.log("parsed:",f)\' app-script.js — or, in this repo, `cd aimeat && pnpm check:js-syntax <file>.html`, which parses every inline <script> body, treats no input as an error, and re-proves its own sentinels on every run.',
    appliesTo: ['publish'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §12',
    updatedAt: '2026-08-01',
  }),

  // ---- iam --------------------------------------------------------------
  E({
    id: 'iam-decide-at-framing',
    title: 'Decide at framing time whether the app needs its OWN users (aimeat-iam)',
    symptom: 'An app that needs member roles/levels ships with hand-rolled auth lists in memory keys; retrofitting real IAM later is painful and often forgotten entirely.',
    fix: 'If the app has its own user community (members, roles, levels, moderation), take the aimeat-iam pack for the server-side gate and AIMEAT.iam for the surface (MemberAdmin is the roster and approval panel) in the plan/frame phase — do not bolt it on after the data model exists. A role belongs to the PERSON, so the agents of a member inherit it.',
    appliesTo: ['iam', 'app'],
    severity: 'warn',
    source: 'curated',
    updatedAt: '2026-07-19',
  }),

  // ---- mobile ------------------------------------------------------------
  E({
    id: 'mobile-means-fullscreen',
    title: '"Mobile-optimized" means native full-screen, not trimmed CSS',
    symptom: 'A focused view (chat/editor/wizard) still shares the screen with app chrome on a phone and feels cramped — incremental CSS trims never satisfy.',
    fix: 'Make the active view take the whole screen under @media (max-width:760px): position: fixed; inset: 0 gated on an is-active class, hide the surrounding chrome, and provide a Back affordance.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'keyboard-viewport',
    title: 'Bottom-pinned inputs hide behind the on-screen keyboard',
    symptom: 'position:fixed;bottom:0 anchors to the LAYOUT viewport; the keyboard shrinks only the visual viewport, so the composer ends up under the keyboard — or a dead gap appears when the height is double-counted.',
    fix: 'Add interactive-widget=resizes-content (+ viewport-fit=cover) to the viewport meta, with a visualViewport-measured height var as fallback. With resizes-content, dvh ALREADY excludes the keyboard — never also subtract the keyboard height. Avoid scrollIntoView({block:"center"}) on the composer.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'grid-track-blowout',
    title: 'One wide child inflates a 1fr grid track and the whole page overflows',
    symptom: 'ONE view overflows horizontally on mobile while sibling views are fine — a non-wrapping table/<pre>/long code inside an overflow-x:auto wrapper still pushes the page wide, because the grid track grew to its min-content.',
    fix: 'Use grid-template-columns: ... minmax(0,1fr) and/or min-width:0 on the grid/flex children so the track can shrink and the inner overflow-x:auto actually scrolls.',
    appliesTo: ['mobile'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'auth-pill-overflow',
    title: 'The golden auth pill overflows portrait headers and shrinks the whole page',
    symptom: 'On a ~390px phone the page zooms out and every font renders tiny — one un-shrinkable header element (the fixed-width login pill next to brand + toggles) forces shrink-to-fit.',
    fix: 'Mostly handled for you now: mountLoginButton renders a compact account button + popover on ≤600px BY DEFAULT on app origins (aimeat-auth v1.2.0), and the app-shell templates ship body{overflow-x:clip}. So the fix is: use the shell (or copy its head), do NOT put other fixed-width widgets in the header row, let flex children shrink (min-width:0), and keep body{overflow-x:clip} (clip, NOT hidden — hidden breaks position:sticky). Verify scrollWidth === clientWidth at 390px and phone-landscape.',
    appliesTo: ['mobile', 'auth'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'fixed-fab-drift',
    title: 'A fixed FAB drifts off-screen when the body scrolls horizontally',
    symptom: 'A position:fixed;right:16px floating button sits past the visible right edge on a phone — the body became horizontally scrollable (usually via the header overflow above) and fixed anchors to the wider area.',
    fix: 'Kill the horizontal overflow at its source (shrinkable flex children, clipped header widgets) instead of repositioning the FAB.',
    appliesTo: ['mobile'],
    severity: 'info',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'flex-nav-wrap',
    title: 'A flex nav/toolbar row with a variable item count overflows on mobile',
    symptom: 'A row of tabs/chips, or a slide-deck pager (prev/next + one dot per slide), fits at a few items but pushes the page wider once the count grows.',
    fix: 'Add flex-wrap:wrap (+ a row-gap) so extra items fold to a second line instead of overflowing. Easy to miss because it only bites past a threshold — a pager that fit at 3 dots overflowed at 9.',
    appliesTo: ['mobile'],
    severity: 'info',
    source: 'curated',
    docRef: 'docs/pitfalls.md §15',
    updatedAt: '2026-07-19',
  }),

  // ---- realtime -----------------------------------------------------------
  E({
    id: 'realtime-handlers-before-connect',
    title: 'Register rt.on(...) handlers BEFORE rt.connect()',
    symptom: 'The peer list never populates — joined/peer-joined frames arrive the instant the socket opens and handlers added after connect() miss them.',
    fix: 'Attach every rt.on(...) handler first, then call rt.connect().',
    appliesTo: ['realtime'],
    severity: 'critical',
    source: 'curated',
    docRef: 'docs/pitfalls.md §16',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'realtime-batch-per-tick',
    title: 'The realtime WS is rate-limited — batch per tick',
    symptom: 'A sequencer or multi-event burst silently stops broadcasting after a while (rate limit tripped by one frame per event).',
    fix: 'Send ONE message per tick carrying all events for that tick ({type:"notes-batch", notes:[...]}), never one broadcast per note.',
    appliesTo: ['realtime'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §16',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'realtime-room-gc-recreate',
    title: 'Rooms are garbage-collected — reconnect must be able to RECREATE',
    symptom: '"Room not found" on reconnect after an idle period; re-dialing the old socket object never recovers.',
    fix: 'On WS close: try getRoom(id); if gone, createRoom again with the same name/tags; reconnect with a FRESH AimeatRealtime instance; back off exponentially and reset the delay on a successful joined.',
    appliesTo: ['realtime'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §16',
    updatedAt: '2026-07-19',
  }),
  E({
    id: 'realtime-anchor-clock',
    title: 'Sync a shared timeline off ONE broadcast anchor, not local clocks',
    symptom: 'Timing drifts between browsers; late joiners are out of phase; tempo changes make the beat jump.',
    fix: 'Broadcast t0 (unix ms of step 0) + bpm; every client computes step = floor((Date.now()-t0)/stepMs) % N. New joiners sync-request and adopt t0/bpm. On tempo change re-anchor t0 = Date.now() - currentStep*newStepMs. Never derive shared timing from a local setInterval counter.',
    appliesTo: ['realtime'],
    severity: 'warn',
    source: 'curated',
    docRef: 'docs/pitfalls.md §16',
    updatedAt: '2026-07-19',
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
}

/** Compact index (no symptom/fix bodies) for overview surfaces and pickers. */
export function getAppdevPitfallIndex(opts?: { includeOutdated?: boolean }): AppdevPitfallIndexEntry[] {
  return getAppdevPitfalls(opts).map(p => ({
    id: p.id, title: p.title, appliesTo: p.appliesTo, severity: p.severity, source: p.source,
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
