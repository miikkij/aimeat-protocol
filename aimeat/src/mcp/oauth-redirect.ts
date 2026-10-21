/**
 * @file src/mcp/oauth-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this redirect_uri one the client registered? Exact string match, plus the one
 *   exception RFC 8252 §7.3 requires: a loopback redirect (http on localhost, 127.0.0.1 or [::1])
 *   matches a registered loopback redirect on any port.
 *
 *   WHY THE EXCEPTION. A native or command-line client cannot know its port in advance: it binds an
 *   ephemeral one when the sign-in starts. So it registers `http://localhost/callback` and sends
 *   `http://localhost:62067/callback`, and RFC 8252 §7.3 says the authorization server MUST allow
 *   any port at request time. Claude Code's Client ID Metadata Document
 *   (https://claude.ai/oauth/claude-code-client-metadata) lists exactly those two portless
 *   addresses, and until 2026-10-22 both MCP OAuth routes compared strings, so every Claude Code
 *   sign-in to this node ended in `redirect_uri not registered`.
 *
 *   WHAT STAYS EXACT. Everything except the port: the scheme (http only, as §7.3 names it), the
 *   host as written (localhost does not match 127.0.0.1, because the client registered the one it
 *   will listen on), the path and the query. A non-loopback address keeps the exact comparison, port
 *   included, and a requested address carrying userinfo or a fragment never takes the exception.
 *   The code lands on the person's own machine only, which is why the port may vary there and
 *   nowhere else.
 * @structure
 *   - redirectUriRegistered(registered, requested) — the allowlist check both MCP OAuth routes use
 * @usage
 *   if (!redirectUriRegistered(client.redirectUris, redirectUri)) refuse();
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial: the RFC 8252 §7.3 loopback port exception, for Claude Code.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The address as a loopback redirect, or null when it is not one (or does not parse). */
function loopback(uri: string): URL | null {
    if (!URL.canParse(uri)) return null;
    const u = new URL(uri);
    if (u.protocol !== 'http:' || !LOOPBACK_HOSTS.has(u.hostname)) return null;
    if (u.username || u.password || u.hash) return null;
    return u;
}

/**
 * Is `requested` one of the `registered` redirect URIs? Exact match first; then a loopback request
 * matches a loopback registration that differs from it only in the port.
 */
export function redirectUriRegistered(registered: readonly string[], requested: string): boolean {
    if (registered.includes(requested)) return true;
    const req = loopback(requested);
    if (!req) return false;
    return registered.some((entry) => {
        const reg = loopback(entry);
        return !!reg
            && reg.hostname === req.hostname
            && reg.pathname === req.pathname
            && reg.search === req.search;
    });
}
