/**
 * @file libs.ts
 * @description Serves browser helper libraries used by AIMEAT apps, including auth, data, storage, social, wallet, and capability clients.
 * @structure libsRouter route registration; aimeatAuthLib browser auth/session helper; individual library imports delegated to lib-* modules.
 * @usage app.use(libsRouter(config, storage)) from the server setup.
 * @version-history
 * v1.38.0 - 2026-07-16 - New library aimeat-workflows.js: the Agent Workflows client
 *   (list/get/save/remove defs, run signals|full + sandbox, runs/health/blueprint, cancel) incl.
 *   the human-in-the-loop surface (pendingInputs + answer + watchRun over the aimeat-live
 *   'workflows' domain, polling fallback). Registered as a route, in the pack registry
 *   (library-packs/sdk.ts), and in the dev test-harness.
 * v1.37.0 - 2026-07-16 - /v1/libs catalogue is now DERIVED from the library-pack registry
 *   (src/data/library-packs.ts, Library Acceleration Program Phase 1) instead of a hardcoded
 *   list — same fields (name/url/description/size_estimate/include/requires), plus a
 *   packs_index pointer to GET /v1/library-packs (per-lib AI docs + changelogs). Lib routes
 *   themselves unchanged.
 * v1.36.0 - 2026-07-14 - New library aimeat-agentface.js (Agent Face phase 2): publish the app's
 *   markdown read-surface (the public apps.{filename}.agentface record, served on the app URL for
 *   Accept: text/markdown) in one call — AIMEATAgentFace.publish(markdown | { title, sections }),
 *   filename from an explicit { app } option / <meta name="aimeat-app"> / the /v1/apps path.
 *   Registered as a route, in the /v1/libs catalogue, and in the dev test-harness.
 * v1.35.0 - 2026-07-14 - New library aimeat-commerce.js (TARGET-033): checkout sessions over
 *   /v1/commerce/*, offer price reading, money formatting in 6-decimal micro-units (same
 *   convention as utils.js fmtMoney), x402-style 402 accepts surfaced on thrown errors, and the
 *   TARGET-034 app-tool draft convention (manifest read + forward-compatible invoke). Registered
 *   as a route, in the /v1/libs catalogue, and in the dev test-harness.
 * v1.34.0 - 2026-07-13 - aimeatAuthLib source extracted to src/routes/libs/auth-lib*.ts
 *   (max-file-lines); libsRouter routes + /v1/libs catalogue unchanged.
 * v1.33.0 - 2026-07-10 - aimeat-auth.js: first-social-login dead ends explained. The username-choice
 *   modal handles the new pending mode 'link_existing' (an account claims the email but never verified
 *   it — a notice explains the one-time password sign-in that verifies + links, instead of dead-ending
 *   at "username taken"); an expired/missing pending (?aimeat_signup=1 with no cookie) shows a "click
 *   Continue with Google again, no password needed" notice instead of silently falling to the password
 *   form. New modal i18n keys: signupLinkTitle/Intro/Hint/SignInBtn, signupExpiredTitle/Body/OkBtn.
 * v1.32.0 - 2026-07-08 - aimeat-auth.js: recover legacy/unverified accounts during sign-in. api() now
 *   preserves error.code/error.details on thrown errors; the sign-in modal catches EMAIL_NOT_VERIFIED
 *   (correct password but no verified email) and opens a complete-account flow — enter/confirm an email
 *   (POST /v1/ghii/login/attach-email), enter the code (POST /v1/ghii/verify-email), then it re-runs the
 *   password login for a normal owner session. New modal i18n keys: completeAccountTitle/Desc/DescResend,
 *   sendVerificationCode, enterCodeTitle/Desc, confirmAndSignIn, emailVerifiedSigningIn, errEmailInvalid,
 *   errCodeRequired. Fixes legacy pre-email-mandate accounts being locked out with no way to add an email.
 * v1.31.0 - 2026-07-07 - New library aimeat-live.js (TARGET-012): a served, app-facing realtime
 *   helper wrapping the node SSE transport (POST /v1/events/ticket -> GET /v1/events) behind
 *   AIMEAT.live.subscribe(domains, fn) — one shared owner-scoped connection, selective re-fetch,
 *   no polling/F5. Integrates with the aimeat-auth session (ticket via session.fetch). Listed in /v1/libs.
 * v1.30.0 - 2026-07-07 - aimeat-auth.js: loginWithPassword exposes session._keyCredentials (first-login
 *   durable creds, TARGET-011); logout() on an app origin now ends the SHARED apex session via the
 *   same-site bridge (?mode=logout) so EXIT sticks across the M-ROOM / LOOM / DROP family.
 * v1.29.0 - 2026-07-02 - New libraries: aimeat-organism.js (normalized workspace read + draft/publish
 *   client) and aimeat-editor.js (CodeMirror 6 markdown editor with toolbar + split live preview);
 *   aimeat-markdown gains renderRich/renderToString. Catalogue now lists aimeat-markdown (route
 *   existed but the /v1/libs listing omitted it) + the two new libraries.
 * v1.28.0 - 2026-07-02 - aimeat-auth.js owner-session refresh() now reconciles `owner` + `ghii` from the
 *   refreshed (authoritative) JWT when it is for a different owner than the persisted session — fixes a
 *   stale identity after an OAuth sign-in as a different user without a clean logout (boot restored the
 *   old session, refreshed the token/displayName, but left owner/ghii showing the previous account).
 * v1.27.0 - 2026-07-02 - First-time social-signup modal now lets the user pick their DISPLAY NAME too
 *   (editable, pre-filled from the provider claim), not just the permanent username; finalize POST
 *   sends { username, displayName } and the backend falls back to the provider name when blank. New
 *   modal i18n keys: signupDisplayNameLabel, signupDisplayNameHint.
 * v1.26.0 - 2026-07-01 - aimeat-auth.js sign-in modal renders one social-login button per enabled OIDC
 *   provider (Google + Casdoor + Microsoft Entra ID), baked from config via AUTH_PROVIDERS/PROVIDER_ICONS
 *   instead of the single GOOGLE_LOGIN_ENABLED flag; a delegated handler navigates to
 *   /v1/ghii/login/<id>. The one-time username-choice modal + finalize are now provider-aware (reads
 *   `provider` from /v1/ghii/login/pending, POSTs /v1/ghii/login/<provider>/finalize). New modal i18n
 *   keys: casdoorSignIn, entraSignIn.
 * v1.25.0 - 2026-06-29 - aimeat-auth.js createSession() also coerces `ghii` to a string (or null) at the
 *   session boundary — some writers persisted the server's whole ghii object ({ghii,username,display_name})
 *   instead of the canonical string, which re-hydrated on every boot and broke ghii.split('@') (workspace
 *   createdBy → "request access to your own workspace"). Same one-funnel fix as the owner coercion.
 * v1.24.0 - 2026-06-29 - aimeat-auth.js createSession() coerces `owner` to a string (or null) at the
 *   session boundary — a non-string owner (from an object login payload / stored value) crashed views
 *   that call owner.split (the identicon avatar). Defense-in-depth with the per-call minidenticon guard.
 * v1.23.0 - 2026-06-28 - aimeat-auth.js: (1) owner session refresh() adopts the display_name the
 *   server now returns from /v1/auth/refresh, so the apex login pill picks up profile edits without a
 *   re-login. (2) new auth.updateSessionMeta(patch) + a 'session-updated' event re-render the pill
 *   live after a profile save. (3) the light/dark THEME TOGGLE now lives inside the pill (both
 *   signed-in and signed-out states) so every embedding app inherits it for free; self-contained
 *   (data-theme + 'aimeat-theme' localStorage) and fires 'aimeat-theme-change' to sync the SPA.
 *   New pill i18n keys: themeToDark/themeToLight.
 * v1.22.0 - 2026-06-26 - aimeat-auth.js login pill shows the owner's DISPLAY NAME, falling back to
 *   the GHII when none is set. The H-2 silent bridge now returns display_name, threaded through
 *   restoreSessionFromAppOrigin → _buildAppSession so an app-origin pill (e.g. Pesupossu) reads a
 *   human label instead of the raw "owner@node-id".
 * v1.21.0 - 2026-06-25 - aimeat-auth.js: apps can declare the scopes they need via
 *   <meta name="aimeat-scopes" content="…">. The H-2 silent bridge + consent popup now request the
 *   declared set (falling back to APP_DEFAULT_SCOPES), so e.g. an AI app adds "ai:use" to spend the
 *   owner's AI budget while non-declaring apps are unchanged. authorize still validates every scope.
 * v1.20.0 - 2026-06-25 - aimeat-auth.js: one-time username choice for first-time Google users. A
 *   brand-new Google account is no longer auto-created from the email local-part; the callback bounces
 *   back with ?aimeat_signup=1 and showGoogleSignupModal() prompts for a username (suggested, editable,
 *   live-validated) with a permanence warning, then POSTs /v1/ghii/login/google/finalize. New modal
 *   i18n keys: signupTitle/Intro/EmailNote/UsernameLabel/SuggestedHint/PermanentWarning/Available/
 *   Taken/Invalid/CreateBtn/Creating/CancelBtn.
 * v1.19.0 - 2026-06-20 - aimeat-auth.js seamless SSO on app origins (H-2): when the SDK runs on a
 *   *.apps.<domain> host (where the host-only cookie is unreachable), AIMEAT.auth.login() + refresh()
 *   pull a scoped grant token via the same-site silent bridge (hidden iframe → apex), so an app like
 *   Sanomat is logged in with no separate login. The bridge targets the baked-in APEX_URL (NOT
 *   NODE_URL, which is location.origin = the APP origin on http/https). mountLoginButton re-renders on
 *   the 'login'/'logout' events so the button updates after the async silent login (no opts.onLogin to
 *   avoid a reload loop), and on an app origin with no session it kicks off the silent bridge ITSELF
 *   (so an app that only calls mountLoginButton, never auth.login(), still auto-logs-in). Concurrent
 *   callers share one in-flight bridge. isAppOrigin / silentAppToken / restoreSessionFromAppOrigin.
 * v1.18.0 - 2026-06-20 - Sign-in modal submits on Enter from any field (username/password/
 *   display name), unless the button is mid-request.
 * v1.17.0 - 2026-06-20 - Sign-in modal shows a "Continue with Google" button when the node
 *   has Google sign-in configured (GOOGLE_LOGIN_ENABLED baked in from config). The button
 *   navigates to /v1/ghii/login/google; the node sets a refresh cookie on callback and the
 *   SPA boots logged-in. New modal i18n keys: orLabel, googleSignIn.
 * v1.16.0 - 2026-06-09 - Sign-in modal (showLoginModal) gains a self-contained EN/FI
 *   language switcher. The modal now loads its own translations (same 'aimeat-lang'
 *   key + cookie as the header) and re-renders in place on switch, so it shows/lets
 *   you change the language even when shown standalone without the canonical header.
 * v1.15.0 - 2026-06-03 - aimeat-auth.js boot restores a session from the httpOnly refresh
 *   cookie alone (no localStorage) so a browser an agent authenticated with an owner access
 *   token shows as logged in. (Agent access tokens, Phase 3b.)
 * v1.14.0 - 2026-06-03 - mountLoginButton: add hook classes (aimeat-auth-pill/-dot/
 *   -label/-ghii/-logout) so the logged-in pill can go compact on mobile (theme.css
 *   hides label+ghii, keeping the dot + Logout). Pill markup/styles otherwise unchanged.
 * v1.13.0 - 2026-06-03 - aimeat-auth.js owner sessions now refresh via the httpOnly
 *   refresh cookie (POST /v1/auth/refresh) instead of owner-key signing: single-flight
 *   refresh, refresh-on-boot, logout revokes server-side. Cross-device login no longer
 *   breaks other sessions. Agent/federated paths unchanged. (Phase 3 of refresh-tokens.)
 * v1.12.0 - 2026-06-03 - Session resilience: aimeat-auth.js now refreshes the
 *   JWT on tab focus/visibilitychange (timers don't fire while the machine sleeps
 *   or the tab is frozen, so the proactive setTimeout was unreliable). loginWithPassword
 *   sends request_owner_key only when this device holds no key, so password login
 *   no longer rotates the owner key and breaks other devices' refresh.
 * v1.11.0 - 2026-05-31 - Add aimeat-agents.js — apps commission & observe the
 *   owner's agents (list, createTask/run, watch via SSE, deliverables,
 *   option-prompt answer loop). Registered as a route + in the /v1/libs catalogue.
 * v1.10.0 - 2026-05-29 - Add aimeat-ai.js — AI completion using the user's
 *   OpenRouter key (apps reach /v1/ai/complete; budget + per-app quotas
 *   enforced server-side). Registered both as a route and in the /v1/libs
 *   catalogue.
 * v1.9.8 - 2026-05-28 - Modal submit button now reads "Sign In / Register" to surface upsert behavior.
 * v1.9.7 - 2026-05-28 - Disable browser caching for generated helper libraries.
 * v1.9.6 - 2026-05-28 - Handle dev-mode auth reset responses in browser auth registration.
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { aimeatDataLib } from './lib-data.js';
import { aimeatStorageLib } from './lib-storage.js';
import { aimeatMarkdownLib } from './lib-markdown.js';
import { aimeatSocialLib } from './lib-social.js';
import { aimeatWalletLib } from './lib-wallet.js';
import { aimeatWorkflowsLib } from './lib-workflows.js';
import { aimeatWorkLib } from './lib-work.js';
import { aimeatTunnelLib } from './lib-tunnel.js';
import { aimeatAudioLib } from './lib-audio.js';
import { aimeatSpeechLib } from './lib-speech.js';
import { aimeatCapabilitiesLib } from './lib-capabilities.js';
import { aimeatAiLib } from './lib-ai.js';
import { aimeatAgentsLib } from './lib-agents.js';
import { aimeatHeaderLib } from './lib-header.js';
import { portfolioStandaloneLib } from './lib-portfolio-standalone.js';
import { aimeatOrganismLib } from './lib-organism.js';
import { aimeatIntakeLib } from './lib-intake.js';
import { aimeatEditorLib } from './lib-editor.js';
import { aimeatLiveLib } from './lib-live.js';
import { aimeatCommerceLib } from './lib-commerce.js';
import { aimeatWebmcpLib } from './lib-webmcp.js';
import { aimeatAgentFaceLib } from './lib-agentface.js';
import { aimeatAuthLib } from './libs/auth-lib.js';
import { sdkLibSource } from './libs/sdk-serve.js';
import { buildLibsCatalogue } from '../data/library-packs.js';

function sendJavascriptLibrary(res: Response, source: string): void {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.type('application/javascript').send(source);
}

/**
 * Serves helper JavaScript libraries at /v1/libs/*
 * These are self-contained scripts that AI-generated apps include via <script> tag.
 * The app files are served from the AIMEAT node itself — zero CORS issues.
 */
export function libsRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/libs/aimeat-auth.js — Auth helper library
  router.get('/v1/libs/aimeat-auth.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAuthLib(config));
  });

  // GET /v1/libs/aimeat-webmcp.js — WebMCP bridge (expose app/node tools to in-browser agents;
  // priced tools pay through the commerce checkout). TARGET-034 phase C.
  router.get('/v1/libs/aimeat-webmcp.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWebmcpLib(config));
  });

  // GET /v1/libs/aimeat-agentface.js — publish the app's Agent Face (the markdown read-surface
  // served on the app URL for Accept: text/markdown) in one call from inside the running app.
  router.get('/v1/libs/aimeat-agentface.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAgentFaceLib(config));
  });

  // GET /v1/libs/aimeat-header.js — Drop-in canonical site header (nav + theme +
  // language + live login pill) for standalone pages such as custom portal templates.
  router.get('/v1/libs/aimeat-header.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatHeaderLib(config));
  });

  // GET /v1/libs/portfolio-standalone.js — bridge shim injected into portfolios
  // served on the portfolio origin (<username>.portfolio.<apex>).
  router.get('/v1/libs/portfolio-standalone.js', (_req, res) => {
    sendJavascriptLibrary(res, portfolioStandaloneLib(config));
  });

  // GET /v1/libs/aimeat-data.js — Memory & Micro-Memory library. Migrated to componentized ESM
  // (src/static/sdk-libs/data/) — the config-path proof lib: NODE_URL/NODE_ID come from _core/config
  // (the prelude), authed calls go through _core/session. `?impl=legacy` serves the old generator
  // for the A/B equivalence diff (removed in Phase 5).
  router.get('/v1/libs/aimeat-data.js', (req, res) => {
    if (req.query.impl === 'legacy') { sendJavascriptLibrary(res, aimeatDataLib(config)); return; }
    sendJavascriptLibrary(res, sdkLibSource(config, 'data'));
  });

  // GET /v1/libs/aimeat-storage.js — File storage library
  router.get('/v1/libs/aimeat-storage.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatStorageLib(config));
  });

  // GET /v1/libs/aimeat-markdown.js — safe GFM markdown renderer (AIMEAT.md.render)
  router.get('/v1/libs/aimeat-markdown.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatMarkdownLib(config));
  });

  // GET /v1/libs/aimeat-social.js — Boards & social library
  router.get('/v1/libs/aimeat-social.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatSocialLib(config));
  });

  // GET /v1/libs/aimeat-wallet.js — Wallet library
  router.get('/v1/libs/aimeat-wallet.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWalletLib(config));
  });

  // GET /v1/libs/aimeat-workflows.js — Agent Workflows client (incl. human-input answer loop)
  router.get('/v1/libs/aimeat-workflows.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWorkflowsLib(config));
  });

  // GET /v1/libs/aimeat-work.js — Actions & work exchange library
  router.get('/v1/libs/aimeat-work.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatWorkLib(config));
  });

  // GET /v1/libs/aimeat-tunnel.js — Personal node tunnel client
  router.get('/v1/libs/aimeat-tunnel.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatTunnelLib(config));
  });

  // GET /v1/libs/aimeat-audio.js — Audio engine library
  router.get('/v1/libs/aimeat-audio.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAudioLib(config));
  });

  // GET /v1/libs/aimeat-speech.js — Speech library. Migrated to a componentized ESM source
  // bundled by esbuild (src/static/sdk-libs/speech/, SDK-libs migration Phase 0); served as the
  // committed IIFE + a per-node config prelude. `?impl=legacy` still serves the old string
  // generator so the A/B equivalence diff can compare them (removed in Phase 5).
  router.get('/v1/libs/aimeat-speech.js', (req, res) => {
    if (req.query.impl === 'legacy') { sendJavascriptLibrary(res, aimeatSpeechLib(config)); return; }
    sendJavascriptLibrary(res, sdkLibSource(config, 'speech'));
  });

  // GET /v1/libs/aimeat-capabilities.js — Capability discovery, invoke, management
  router.get('/v1/libs/aimeat-capabilities.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatCapabilitiesLib(config));
  });

  // GET /v1/libs/aimeat-ai.js — AI completion using the user's OpenRouter key
  router.get('/v1/libs/aimeat-ai.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAiLib(config));
  });

  // GET /v1/libs/aimeat-agents.js — commission & observe the owner's agents
  router.get('/v1/libs/aimeat-agents.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatAgentsLib(config));
  });

  // GET /v1/libs/aimeat-organism.js — organism/workspace content client (normalized read + draft/publish)
  router.get('/v1/libs/aimeat-organism.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatOrganismLib(config));
  });

  // GET /v1/libs/aimeat-intake.js — Public Intake client (public getForm/submit + owner form management)
  router.get('/v1/libs/aimeat-intake.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatIntakeLib(config));
  });

  // GET /v1/libs/aimeat-editor.js — markdown editor (CodeMirror 6 + toolbar + split preview)
  router.get('/v1/libs/aimeat-editor.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatEditorLib(config));
  });

  // GET /v1/libs/aimeat-live.js — realtime live-updates (SSE subscribe helper, TARGET-012)
  router.get('/v1/libs/aimeat-live.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatLiveLib(config));
  });

  // GET /v1/libs/aimeat-commerce.js — checkout sessions, offer prices, money formatting (TARGET-033)
  router.get('/v1/libs/aimeat-commerce.js', (_req, res) => {
    sendJavascriptLibrary(res, aimeatCommerceLib(config));
  });

  // GET /v1/libs/ — List available libraries. Derived from the library-pack registry
  // (src/data/library-packs.ts) so this catalogue can never drift from the other AI-facing
  // surfaces (build-app prompt, bootstrap sdk_libraries, llms.txt). Response shape is
  // backwards-compatible with the pre-registry hardcoded list.
  router.get('/v1/libs', (_req, res) => {
    res.json({
      ok: true,
      libraries: buildLibsCatalogue(config.baseUrl),
      packs_index: '/v1/library-packs',
    });
  });

  // GET /v1/libs/test-harness — HTML page that loads all libraries (dev mode only)
  if (config.devMode) {
    router.get('/v1/libs/test-harness', (_req, res) => {
      const nonce = res.locals.cspNonce as string;
      res.type('text/html').send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>AIMEAT Libraries Test Harness</title>
<script src="/v1/libs/aimeat-auth.js"></script>
<script src="/v1/libs/aimeat-data.js"></script>
<script src="/v1/libs/aimeat-storage.js"></script>
<script src="/v1/libs/aimeat-social.js"></script>
<script src="/v1/libs/aimeat-wallet.js"></script>
<script src="/v1/libs/aimeat-workflows.js"></script>
<script src="/v1/libs/aimeat-work.js"></script>
<script src="/v1/libs/aimeat-tunnel.js"></script>
<script src="/v1/libs/aimeat-audio.js"></script>
<script src="/v1/libs/aimeat-speech.js"></script>
<script src="/v1/libs/aimeat-commerce.js"></script>
<script src="/v1/libs/aimeat-agentface.js"></script>
</head>
<body>
<h1 id="title">AIMEAT Test Harness</h1>
<pre id="log"></pre>
<script nonce="${nonce}">
window.__testLog = [];
window.tlog = function(msg) {
  window.__testLog.push(msg);
  document.getElementById('log').textContent = window.__testLog.join('\\n');
};
window.tlog('Libraries loaded: auth=' + !!AIMEAT.auth + ' data=' + !!AIMEAT.data + ' storage=' + !!AIMEAT.storage + ' social=' + !!AIMEAT.social + ' wallet=' + !!AIMEAT.wallet + ' work=' + !!AIMEAT.work + ' tunnel=' + !!AIMEAT.tunnel + ' audio=' + !!AIMEAT.audio + ' speech=' + !!AIMEAT.speech + ' commerce=' + !!AIMEAT.commerce + ' agentface=' + !!AIMEAT.agentface);
window.__ready = true;
</script>
</body></html>`);
    });
  }

  return router;
}
