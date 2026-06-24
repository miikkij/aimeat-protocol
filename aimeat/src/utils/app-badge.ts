/**
 * @file app-badge.ts
 * @description Inject a small, fixed "aimeat.io · publish your own app" attribution badge into an
 *   inline-served published-app document. A shared app link is often an external visitor's first
 *   contact with AIMEAT, and a bare full-page app gives them no way to the project and no hint they
 *   could publish their own — this badge fixes both. It is a DELIBERATE, permanent attribution mark
 *   (the apps are free to publish/host), so the label + link are hardcoded to aimeat.io rather than
 *   the serving node — it appears on self-hosted nodes too, like a "powered by" credit. Narrowly-
 *   scoped exception to the "serve app HTML raw" rule; used by both serving paths (apex inline in
 *   apps.ts and the isolated app origin in subdomains.ts) so the behaviour is identical.
 * @structure injectAimeatBadge(html) — pure string transform, returns a Buffer.
 * @usage const body = injectAimeatBadge(app.data);
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: node-branded, idempotent, HTML-only badge injection.
 *   v1.1.0 — 2026-06-24 — Make the badge a permanent aimeat.io attribution mark: label + link
 *     hardcoded to aimeat.io (was node-derived); dropped the baseUrl param.
 */

/** Permanent attribution target — the project home, not the serving node. */
const AIMEAT_HOME = 'https://aimeat.io/';
const AIMEAT_LABEL = 'aimeat.io';

/**
 * Append the badge before `</body>` (fallback `</html>`, else end). The label + link are the fixed
 * aimeat.io attribution (deliberate, since publishing/hosting is free). Pure static markup + inline
 * styles — no script, so it needs nothing the inline CSP doesn't already allow (style-src
 * 'unsafe-inline'). Returns the input unchanged when the payload isn't an HTML document or already
 * carries the badge (idempotent).
 */
export function injectAimeatBadge(data: Buffer | Uint8Array | string): Buffer {
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
    // Only touch real HTML documents; never corrupt JSON/SVG/other inline payloads.
    if (!/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) return Buffer.from(text, 'utf-8');
    // Idempotent: don't double-inject if a badged document is ever re-served.
    if (text.includes('id="aimeat-app-badge"')) return Buffer.from(text, 'utf-8');

    const badge =
        '<a id="aimeat-app-badge" href="' + AIMEAT_HOME + '" target="_blank" rel="noopener noreferrer" '
        + 'aria-label="' + AIMEAT_LABEL + ' — publish your own app" '
        + 'style="position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;'
        + 'display:inline-flex!important;align-items:center!important;gap:8px!important;'
        + 'padding:7px 12px!important;border-radius:9999px!important;'
        + 'background:rgba(20,20,28,.92)!important;color:#fff!important;'
        + 'font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;'
        + 'text-decoration:none!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;'
        + 'border:1px solid rgba(255,255,255,.14)!important;backdrop-filter:blur(8px)!important;'
        + '-webkit-backdrop-filter:blur(8px)!important;letter-spacing:.1px!important;">'
        + '<span style="color:#E8564A!important">⚡</span>'
        + '<span>' + AIMEAT_LABEL + '</span>'
        + '<span style="opacity:.7!important;font-weight:500!important">· Publish your own app — free</span>'
        + '</a>';

    if (/<\/body\s*>/i.test(text)) return Buffer.from(text.replace(/<\/body\s*>/i, badge + '</body>'), 'utf-8');
    if (/<\/html\s*>/i.test(text)) return Buffer.from(text.replace(/<\/html\s*>/i, badge + '</html>'), 'utf-8');
    return Buffer.from(text + badge, 'utf-8');
}
