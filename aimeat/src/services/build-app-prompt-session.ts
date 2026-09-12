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
  body += 'Handle BOTH login paths: a fresh sign-in click (the onLogin callback) AND a page that loads already signed in (restore the session yourself). `onLogin` fires ONLY on a fresh sign-in — it does NOT fire on reload when a session already exists, so a page that relies on onLogin alone shows nothing to an already-logged-in returning user.\n';
  body += 'The login bar is the ONLY interactive sign-in path: on an app origin `AIMEAT.auth.login()` is silent-only (it restores an existing session and returns null otherwise). Never hand-roll a sign-in button that calls login() — mount the login bar; a custom button must delegate its click to the login bar\'s own button.\n';
  body += '```html\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  body += '<script>\n';
  body += 'function showApp(session) { /* session.owner, session.jwt, session.fetch() */ }\n';
  body += 'function hideApp() { /* hide content, show a "Sign in" message */ }\n';
  body += '\n';
  body += '// Path 1 — fresh sign-in / sign-out via the login button:\n';
  body += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  body += '  onLogin: showApp,   // fires ONLY on a fresh sign-in click, NOT on reload\n';
  body += '  onLogout: hideApp\n';
  body += '});\n';
  body += '\n';
  body += '// Path 2 — already signed in when the page loads. Restore the stored session\n';
  body += '// explicitly; login() returns the session (or null if not signed in).\n';
  body += 'AIMEAT.auth.login().then(function (session) { if (session) showApp(session); });\n';
  body += '\n';
  body += '// Path 3 — ASYNC logins (app-subdomain silent SSO, consent-popup return): these\n';
  body += '// fire neither onLogin nor the login() promise above. The login EVENT covers every\n';
  body += "// path — always add it, or a published app stays hidden after the user grants access.\n";
  body += "AIMEAT.auth.on('login', showApp);\n";
  body += "AIMEAT.auth.on('logout', hideApp);\n";
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
  body += '`error.code === "SCOPE_DENIED"` means the owner\'s approval is missing a permission word: say that to the user and point them at re-approving the app. Retrying cannot fix it. If you write your own wrapper around session.fetch, it MUST pass the refusal through — a wrapper that returns `r.data` regardless makes every call site in the app fail silently. The result is already parsed, so never call `.json()` on it.\n\n';

  return body;
}
