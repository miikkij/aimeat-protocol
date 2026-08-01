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
 *   v1.6.0 — 2026-08-01 — TARGET-058 Phase 4 step 0c: the em dash is REWORDED out of the badge
 *     ("Publish your own app for free", "Publish your own app on aimeat.io") rather than escaped.
 *     v1.5.0 encoded it, which renders the same glyph — the house style bans the character, not its
 *     byte sequence. Note for whoever looks for it next: this string is a literal here, not a locale
 *     key, which is where the Phase 3 audit expected to find it.
 *   v1.0.0 — 2026-06-24 — Initial: node-branded, idempotent, HTML-only badge injection.
 *   v1.1.0 — 2026-06-24 — Make the badge a permanent aimeat.io attribution mark: label + link
 *     hardcoded to aimeat.io (was node-derived); dropped the baseUrl param.
 *   v1.2.0 — 2026-07-16 — Inject before the LAST closing tag (shared html-inject helper), not the
 *     first: a first-match replace landed the badge inside app JS that contains the literal
 *     '</body>' string, silently killing the whole app.
 *   v1.3.0 — 2026-07-16 — Mobile: collapse to a small round ⚡ button that expands the full pill
 *     on tap (CSS-only checkbox toggle + media query — still zero script, covered by the same
 *     style-src 'unsafe-inline' the inline styles already need). Desktop look unchanged.
 *   v1.5.0 — 2026-08-01 — Fix the mojibake: the badge's ⚡, · and — are emitted as numeric HTML
 *     entities. Apps are served as `text/html` with no charset and usually declare none themselves,
 *     so the raw UTF-8 bytes were being decoded as windows-1252 and shown as "âš¡ ... â€" free".
 *     Caught in a browser during TARGET-058 Phase 3.
 *   v1.4.0 — 2026-07-25 — Brand-as-token: the coral accents are var(--color-primary, #E8564A) so
 *     the badge follows the app's palette (theme system v2); the hex remains only as the fallback
 *     for pages that load no theme. This injector was why every served app measured 2-3 hardcoded
 *     corals even when the app source had none.
 */
import { injectBeforeClosingTag } from './html-inject.js';

/** Permanent attribution target — the project home, not the serving node. */
const AIMEAT_HOME = 'https://aimeat.io/';
const AIMEAT_LABEL = 'aimeat.io';

/**
 * Every non-ASCII character as a numeric HTML entity.
 *
 * MEASURED, NOT PARANOIA. A published app is served as `text/html` with NO charset parameter, and
 * most single-file apps declare no `<meta charset>` either, so the browser falls back to
 * windows-1252 and the badge rendered as "âš¡ aimeat.io Â· Publish your own app â€" free". Entities
 * are decoded identically under every encoding, so the badge is correct whatever the host document
 * did or did not declare. The alternative — forcing `charset=utf-8` on somebody else's document —
 * would also fix the APP's own text and is worth doing, but it is a change to how every published
 * app is decoded and belongs in its own decision.
 */
function entities(s: string): string {
    return s.replace(/[^ -~]/g, (c) => `&#${c.codePointAt(0)};`);
}

/**
 * Append the badge before the LAST `</body>` (fallback last `</html>`, else end). The label + link are the fixed
 * aimeat.io attribution (deliberate, since publishing/hosting is free). Pure static markup + a scoped
 * `<style>` block — no script, so it needs nothing the inline CSP doesn't already allow (style-src
 * 'unsafe-inline' governs `<style>` elements and style attributes alike). On narrow viewports the pill
 * collapses to a small round ⚡ button so it doesn't cover app UI; tapping toggles the full pill via a
 * hidden-checkbox CSS toggle (the only way to get tap-to-expand without a script). Returns the input
 * unchanged when the payload isn't an HTML document or already carries the badge (idempotent).
 */
export function injectAimeatBadge(data: Buffer | Uint8Array | string): Buffer {
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
    // Only touch real HTML documents; never corrupt JSON/SVG/other inline payloads.
    if (!/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) return Buffer.from(text, 'utf-8');
    // Idempotent: don't double-inject if a badged document is ever re-served.
    if (text.includes('id="aimeat-app-badge"')) return Buffer.from(text, 'utf-8');

    // Shared surface look for both the pill and the collapsed ⚡ button. Everything is !important
    // so arbitrary app CSS (resets, `a{...}`, `label{...}`) can't restyle the badge.
    const surface =
        'background:rgba(20,20,28,.92)!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;'
        + 'border:1px solid rgba(255,255,255,.14)!important;backdrop-filter:blur(8px)!important;'
        + '-webkit-backdrop-filter:blur(8px)!important;';
    const css =
        // display:contents — the wrapper adds no box of its own, children position:fixed themselves.
        '#aimeat-app-badge{display:contents!important}'
        // The toggle checkbox: visually hidden but focusable (never display:none — keyboard a11y).
        + '#aimeat-app-badge input{position:fixed!important;right:20px!important;bottom:20px!important;'
        + 'width:1px!important;height:1px!important;margin:0!important;opacity:0!important;'
        + 'pointer-events:none!important;z-index:2147483647!important}'
        // Collapsed ⚡ button — hidden on wide viewports, shown on narrow ones.
        + '#aimeat-app-badge label{display:none!important;position:fixed!important;right:12px!important;'
        + 'bottom:12px!important;z-index:2147483647!important;width:34px!important;height:34px!important;'
        + 'align-items:center!important;justify-content:center!important;border-radius:50%!important;'
        + 'color:var(--color-primary,#E8564A)!important;font:600 16px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;'
        + 'cursor:pointer!important;user-select:none!important;-webkit-user-select:none!important;' + surface + '}'
        // The full pill — the desktop default, unchanged look.
        + '#aimeat-app-badge a{position:fixed!important;right:12px!important;bottom:12px!important;'
        + 'z-index:2147483647!important;display:inline-flex!important;align-items:center!important;'
        + 'gap:8px!important;padding:7px 12px!important;border-radius:9999px!important;color:#fff!important;'
        + 'font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;'
        + 'text-decoration:none!important;letter-spacing:.1px!important;' + surface + '}'
        + '#aimeat-app-badge a>span:first-child{color:var(--color-primary,#E8564A)!important}'
        + '#aimeat-app-badge a>span:last-child{opacity:.7!important;font-weight:500!important}'
        + '#aimeat-app-badge input:focus-visible~label{outline:2px solid var(--color-primary,#E8564A)!important;outline-offset:2px!important}'
        // Narrow viewports: only the ⚡ button by default; checking the toggle reveals the pill
        // beside it (the button stays visible to collapse again; the pill drops its own ⚡).
        + '@media (max-width:640px){'
        + '#aimeat-app-badge label{display:flex!important}'
        + '#aimeat-app-badge a{display:none!important}'
        + '#aimeat-app-badge input:checked~a{display:inline-flex!important;right:56px!important}'
        + '#aimeat-app-badge a>span:first-child{display:none!important}'
        + '}';

    // Every user-visible string goes through entities(): the glyphs here are exactly the ones that
    // were rendering as mojibake in a charset-less document.
    const badge =
        '<div id="aimeat-app-badge">'
        + '<style>' + css + '</style>'
        + '<input type="checkbox" id="aimeat-app-badge-open">'
        + '<label for="aimeat-app-badge-open" aria-label="' + entities('Publish your own app on ' + AIMEAT_LABEL) + '">' + entities('⚡') + '</label>'
        + '<a href="' + AIMEAT_HOME + '" target="_blank" rel="noopener noreferrer" '
        + 'aria-label="' + entities('Publish your own app on ' + AIMEAT_LABEL) + '">'
        + '<span>' + entities('⚡') + '</span>'
        + '<span>' + entities(AIMEAT_LABEL) + '</span>'
        + '<span>' + entities('· Publish your own app for free') + '</span>'
        + '</a>'
        + '</div>';

    return Buffer.from(injectBeforeClosingTag(text, badge), 'utf-8');
}
