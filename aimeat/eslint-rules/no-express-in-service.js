/**
 * @file no-express-in-service.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: a service does not take an Express request. Reports any import
 *   from `express` inside `src/services/`.
 *
 *   WHY THIS RULE EXISTS. This is the root cause of a whole class of drift, not a style preference.
 *
 *   `canManageInstalledExt` is the example that names it. It is the correct ownership check for an
 *   extension, it has been correct since it was written, and routes/extensions/crud.ts calls it on
 *   every operation that changes one. Its first parameter is an Express `Request`. So when the MCP
 *   tools were written — activate, deactivate, delete, the same three operations — they could not
 *   call it. They did not call anything instead. Any agent holding `ext:write` could uninstall
 *   another owner's extension until 2026-08-11, and the guard that would have stopped it was sitting
 *   in the same repository, correct, unreachable.
 *
 *   The same shape produced the rest: `enforcePaywall` took a `Response`, so the MCP tool called
 *   none of it and a priced action was free through a tool call. `canWriteNamespace` was a closure
 *   inside a route factory, so the MCP workspace tools published over the organism manifest with a
 *   membership check and nothing else.
 *
 *   A guard shaped like one door does not reach the other. So a service takes what it needs —
 *   the caller's identity, roles and scopes — and the door hands them over. Then a second door is a
 *   second caller rather than a second implementation.
 *
 *   WHAT TO DO INSTEAD. Take `{ owner, roles, scopes }` (or the resolved identity) as a parameter.
 *   If a service needs to WRITE a response, it does not: it returns a refusal and each door renders
 *   it — see services/consent-write.ts and routes/extensions/metered-response.ts's PaywallResponder
 *   for the two shapes that work.
 *
 *   THE SEED. Seven services imported express on 2026-08-11 and are listed below with what each one
 *   actually needs. The list only shrinks: a new service that reaches for express fails the build.
 * @structure
 *   - EXEMPT — the seven that predate the rule, each with the reason
 *   - noExpressInService: the rule module
 * @usage
 *   'aimeat/no-express-in-service': 'error'
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: enforcing the architecture the drift ignored).
 */

/**
 * Services that took an Express type before this rule existed. Each is a promise to come back to it,
 * and every removal is a service that a second surface can now call.
 */
const EXEMPT = new Set([
  // Renders an HTML face for a request; genuinely HTTP-shaped output, not a capability.
  'src/services/agent-face.ts',
  // Reads Accept headers to decide a representation. Content negotiation IS the request.
  'src/services/markdown-negotiation.ts',
  // Per-request timing spans, attached to the request object by design.
  'src/services/perf-trace.ts',
  // RFC 9728 protected-resource metadata: a response shape defined by the spec.
  'src/services/protected-resource.ts',
  // Mints and clears the owner session cookie, which only exists over HTTP.
  'src/services/owner-session.ts',
  // Reads the caller off the request to decide a provenance mark. Should take the caller instead.
  'src/services/ai-provenance-marks.ts',
  // Reads the caller off the request to decide accountant access. Should take the caller instead.
  'src/services/finance/accountant-access.ts',
]);

export const noExpressInService = {
  meta: {
    type: 'problem',
    docs: {
      description: 'A service takes the caller, not an Express request, so a second surface can call it',
    },
    schema: [],
    messages: {
      express:
        'A service under src/services/ must not import from "express". Take the caller\'s identity, '
        + 'roles and scopes as a parameter and let each door hand them over. This is the root cause of '
        + 'the MCP/REST drift: canManageInstalledExt was the correct ownership check for an extension '
        + 'and took a Request, so the MCP tools could not call it and called nothing instead — any '
        + 'agent with ext:write could uninstall another owner\'s extension. If the service needs to '
        + 'write a response, return a refusal and let the door render it (services/consent-write.ts), '
        + 'or take a structural responder (routes/extensions/metered-response.ts PaywallResponder).',
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (!filename.includes('/src/services/')) return {};
    const rel = filename.slice(filename.indexOf('src/services/'));
    if (EXEMPT.has(rel)) return {};

    return {
      ImportDeclaration(node) {
        if (node.source?.value !== 'express') return;
        context.report({ node, messageId: 'express' });
      },
    };
  },
};
