/**
 * @file build-app-prompt-session.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two sections of the app-building prompt about the SESSION: how an app signs a
 *   person in, and how it calls the node once they are. Extracted from services/build-app-prompt.ts
 *   by pure extraction when adding the second one took that file past 800 lines. The text is the
 *   text that was there; nothing was reworded in the move.
 * @structure buildPromptSessionSections(nodeUrl) → the markdown for both sections
 * @usage body += buildPromptSessionSections(nodeUrl);
 * @version-history
 *   v1.1.0 — 2026-09-13 — The auth pattern uses onSession(session, { restored }), which runs for a restore
 *     and a sign-in alike, instead of three paths (onLogin, login().then, the login event) that a
 *     builder had to wire together and usually wired two of. onLogin is unchanged in the library.
 *   v1.0.2 — 2026-09-13 — ADDITIVE, one sentence in "read `ok` before `data`": what `UNDECLARED_SPACE`
 *     means (a space the workspace manifest does not declare, refused and not stored, the developer's
 *     decision) and that it goes to someone who can declare the space rather than into a retry.
 *   v1.0.1 — 2026-09-13 — The auth sentence names AIMEAT.auth.signIn(), which now exists, instead of
 *     telling a custom button to click the login bar's own button (whose first control is the
 *     language or mode switch).
 *   v1.0.0 — 2026-09-13 — Extracted verbatim from build-app-prompt.ts (max-file-lines).
 */

/**
 * The Auth Pattern block and the one that follows it. Both are about the same object — the session —
 * which is why they travel together: the first hands you one, the second is what you do with it.
 */
export function buildPromptSessionSections(nodeUrl: string): string {
  let body = '';

  // Auth pattern
  body += '### Auth Pattern\n';
  body += 'A person arrives in one of two ways: they sign in, or the page loads already signed in. `onSession(session, { restored })` on the login button covers both: it runs once for every session that becomes available, a restore on page load (`restored: true`) and a sign-in (`restored: false`). Show the app from onSession and nowhere else. `onLogin` still fires ONLY on a fresh sign-in, so a page that relies on onLogin alone shows nothing to a returning user; never reload the page from either callback.\n';
  body += '`AIMEAT.auth.login()` is the restore and never opens anything: it returns the stored session or null. A sign-in button of your own calls `AIMEAT.auth.signIn()` from its click handler (on an app origin that click is the user gesture the consent popup needs; elsewhere it opens the sign-in modal); it resolves to the session or null. Never click the login bar\'s buttons by position: the first control in it is the language or light/dark switch.\n';
  body += '```html\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  body += '<script>\n';
  body += 'function showApp(session) { /* session.owner, session.jwt, session.fetch() */ }\n';
  body += 'function hideApp() { /* hide content, show a "Sign in" message */ }\n';
  body += '\n';
  body += '// One handler for every way a session arrives: the restore on page load, a sign-in\n';
  body += '// through the button, the silent sign-in on an app subdomain, a consent-popup return.\n';
  body += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  body += '  onSession: function (session, how) { showApp(session); },  // how.restored: true on reload\n';
  body += '  onLogout: hideApp\n';
  body += '});\n';
  body += '</' + 'script>\n';
  body += '```\n\n';

  // Calling the node. Added 2026-09-13 after a published app showed an empty mailbox for a week:
  // its wrapper read `data` off a refusal. session.fetch resolves the envelope and never throws, by
  // design (sdk-libs/auth/session.js), so "refused" and "empty" look identical to render code unless
  // the app reads `ok` first. Every session.fetch example in this prompt used the value directly.
  body += '### Calling the node: read `ok` before `data`\n';
  body += '`session.fetch` resolves with the PARSED envelope and does NOT throw when the node refuses. A refusal comes back as a VALUE — `{ ok: false, error: { code, message } }` — so reading `.data` off it gives `undefined`, and your list renders empty as if the user simply had nothing. Check `ok` on every call:\n';
  body += '```javascript\n';
  body += 'const r = await session.fetch("/v1/memory?prefix=notes.");\n';
  body += 'if (!r.ok) { showProblem(r.error); return; }   // never silently render an empty state\n';
  body += 'render(r.data.items);\n';
  body += '```\n';
  body += '`error.code === "SCOPE_DENIED"` means the owner\'s approval is missing a permission word: say that to the user and point them at re-approving the app. Retrying cannot fix it. `error.code === "UNDECLARED_SPACE"` (422) means the workspace\'s manifest does not declare the space the record was written or published into, and nothing was stored: show `error.message` to someone who can declare the space (the GROUP application section says who can), and do not retry until it is declared. If you write your own wrapper around session.fetch, it MUST pass the refusal through — a wrapper that returns `r.data` regardless makes every call site in the app fail silently. The result is already parsed, so never call `.json()` on it.\n\n';

  return body;
}
