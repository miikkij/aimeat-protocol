/**
 * @file app-badge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Inject a small, fixed "aimeat.io · publish your own app" attribution badge into an
 *   inline-served published-app document. A shared app link is often an external visitor's first
 *   contact with AIMEAT, and a bare full-page app gives them no way to the project and no hint they
 *   could publish their own — this badge fixes both. It is a DELIBERATE, permanent attribution mark
 *   (the apps are free to publish/host), so the label + link are hardcoded to aimeat.io rather than
 *   the serving node — it appears on self-hosted nodes too, like a "powered by" credit. Narrowly-
 *   scoped exception to the "serve app HTML raw" rule; used by both serving paths (apex inline in
 *   apps.ts and the isolated app origin in subdomains.ts) so the behaviour is identical.
 * @structure BADGE_MARK — the idempotency marker; badgeSnippet() — the markup, with no opinion about
 *   where it goes. The document detection, the idempotency check and the `</body>`-inside-app-JS
 *   trap all live ONCE in services/app-serve-marks.ts, which is what actually puts it in the page.
 * @usage import { badgeSnippet } from '../utils/app-badge.js';  // via applyServeMarks({ badge: true })
 * @version-history
 *   v2.2.0 — 2026-09-29 — ONE COMPACT ROW, BOTTOM-LEFT (the developer's decision of 2026-09-29, after
 *     the marks covered app content in two corners). The badge is the 34px bolt on every viewport,
 *     not only below 640px; the pill opens above the bolt on hover, keyboard focus or a tap, and
 *     the bolt does not move when it does. It sits after the AI label on one row
 *     (--aimeat-mark-ai-w) and declares its own room (--aimeat-mark-badge-w) for the install
 *     button after it. The pill lost its own bolt, since the bolt is right under it.
 *   v2.1.0 — 2026-09-05 — THE BOLT IS A DRAWING NOW, and the surface is opaque. Two findings from
 *     the Atelier measuring review, one fix each. (1) The house rule is no emoji in the
 *     interface, and the badge carried a ⚡ in two places; it is an inline SVG bolt, sized in
 *     ems so the pill and the round button keep the size they had. (2) The glyph measured 4.19
 *     to 4.29 against its ground on every app page, under the 4.5 text needs, and it measured
 *     DIFFERENTLY on every page because the ground was a .92-alpha panel over whatever the app
 *     painted behind it. The surface is solid now, so the coral sits at 5.1 in both themes and
 *     on every page; backdrop-filter went with the translucency, since a blur under an opaque
 *     panel is work nobody sees. Size, wording and link are untouched.
 *   v2.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: injectAimeatBadge() becomes badgeSnippet().
 *     Four serve-time injectors each re-parsed the same document and each carried its own copy of
 *     the last-</body> rule; they are now one pass (services/app-serve-marks.ts) and this file
 *     supplies only the markup. Byte-for-byte identical output, proved by the golden fixtures in
 *     test/fixtures/serve-marks-golden.json.
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
/** Permanent attribution target — the project home, not the serving node. */
const AIMEAT_HOME = 'https://aimeat.io/';
const AIMEAT_LABEL = 'aimeat.io';

/** Present in an already-badged document. The one string that makes a re-serve idempotent. */
export const BADGE_MARK = 'id="aimeat-app-badge"';

/**
 * The room the bolt takes on the marks' row: its 34px and the 8px gap after it. Declared on `:root`
 * so the install button (public/js/install-chip.js) sits after the bolt when there is one and in
 * the bolt's place when the owner turned the badge off.
 */
export const BADGE_WIDTH_VAR = '--aimeat-mark-badge-w';
const BADGE_ROW_PX = 42;

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
 * The bolt, drawn rather than typed.
 *
 * The house rule is no emoji in the interface, and this badge is served into somebody else's page
 * on every app on the node, so it was the most-seen emoji we had. An inline SVG also gets the
 * lightning off the text-contrast books: a glyph is TEXT and owes 4.5, a drawing is a graphic and
 * owes 3. It is sized in ems so it follows whatever font-size the surrounding rule already sets —
 * 12px in the pill, 16px in the round button — which is how the badge keeps the size it had.
 */
const BOLT = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" '
    + 'aria-hidden="true" focusable="false"><path d="M13.5 2 4 13.2h6.1L9.6 22 20 10.4h-6.4z"/></svg>';

/**
 * The badge markup. The label + link are the fixed aimeat.io attribution (deliberate, since
 * publishing/hosting is free). Pure static markup + a scoped `<style>` block — no script, so it needs
 * nothing the inline CSP doesn't already allow (style-src 'unsafe-inline' governs `<style>` elements
 * and style attributes alike). On every viewport the badge is a small round bolt button, so it
 * doesn't cover app UI; hover or keyboard focus shows the full pill above it, and a tap toggles it
 * via a hidden-checkbox CSS toggle (the only way to get tap-to-expand without a script).
 */
export function badgeSnippet(): string {
    // Shared surface look for both the pill and the bolt button. Everything is !important so
    // arbitrary app CSS (resets, `a{...}`, `label{...}`) can't restyle the badge.
    //
    // OPAQUE, ON PURPOSE. At .92 alpha the ground under the words was whatever the app painted
    // behind the badge, so the same coral measured 4.19 on one page and 4.29 on the next and was
    // under 4.5 on both. A solid panel is the same colour on every page and in both themes, and
    // puts the coral at 5.1 — the contrast stops being the app's business. The backdrop blur went
    // with the translucency: there is nothing behind an opaque panel to blur.
    const surface =
        'background:#14141c!important;box-shadow:0 4px 16px rgba(0,0,0,.28)!important;'
        + 'border:1px solid rgba(255,255,255,.14)!important;';
    // ONE ROW, BOTTOM-LEFT. The node's marks share one row: the AI label first (it declares its own
    // width as --aimeat-mark-ai-w), this bolt next, the install button last (it reads
    // --aimeat-mark-badge-w, declared here). Without an AI label the fallback puts the bolt at 12px.
    const left = 'calc(12px + var(--aimeat-mark-ai-w,0px))';
    const css =
        ':root{' + BADGE_WIDTH_VAR + ':' + BADGE_ROW_PX + 'px}'
        // display:contents — the wrapper adds no box of its own, children position:fixed themselves.
        + '#aimeat-app-badge{display:contents!important}'
        // The toggle checkbox: visually hidden but focusable (never display:none — keyboard a11y).
        + '#aimeat-app-badge input{position:fixed!important;left:' + left + '!important;right:auto!important;bottom:20px!important;'
        + 'width:1px!important;height:1px!important;margin:0!important;opacity:0!important;'
        + 'pointer-events:none!important;z-index:2147483647!important}'
        // The drawn bolt: sized off the rule that contains it, never squeezed by an app's own
        // `svg{width:100%}` reset.
        + '#aimeat-app-badge svg{width:1em!important;height:1em!important;display:block!important;'
        + 'flex:none!important;fill:currentColor!important}'
        // The bolt button, on every viewport: the badge is 34px square until someone asks for more.
        + '#aimeat-app-badge label{display:flex!important;position:fixed!important;left:' + left + '!important;right:auto!important;'
        + 'bottom:12px!important;z-index:2147483647!important;width:34px!important;height:34px!important;'
        + 'box-sizing:border-box!important;margin:0!important;padding:0!important;'
        + 'align-items:center!important;justify-content:center!important;border-radius:50%!important;'
        + 'color:var(--color-primary,#E8564A)!important;font:600 16px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;'
        + 'cursor:pointer!important;user-select:none!important;-webkit-user-select:none!important;' + surface + '}'
        // The pill opens ABOVE the bolt, left edge on the bolt's left edge, and the bolt stays where
        // it is: nothing on the row moves when it opens. It wraps rather than leave the viewport.
        + '#aimeat-app-badge a{display:none!important;position:fixed!important;left:' + left + '!important;right:auto!important;'
        + 'bottom:52px!important;top:auto!important;max-width:calc(100vw - 24px - var(--aimeat-mark-ai-w,0px))!important;'
        + 'box-sizing:border-box!important;margin:0!important;'
        + 'z-index:2147483647!important;align-items:center!important;flex-wrap:wrap!important;'
        + 'gap:2px 8px!important;padding:7px 12px!important;border-radius:15px!important;color:#fff!important;'
        + 'font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;'
        + 'text-decoration:none!important;letter-spacing:.1px!important;' + surface + '}'
        // The 6px between the pill and the bolt, made hoverable, so the pointer can travel from one
        // to the other without the pill closing under it.
        + '#aimeat-app-badge a::after{content:""!important;position:absolute!important;left:0!important;'
        + 'right:0!important;top:100%!important;height:8px!important}'
        // Open: while the pointer is on the bolt or the pill, while the keyboard is in either, and
        // after a tap until the next one (a touch screen has no hover to hold it open).
        + '#aimeat-app-badge:hover a,#aimeat-app-badge:focus-within a,#aimeat-app-badge input:checked~a{display:inline-flex!important}'
        + '#aimeat-app-badge a>span:last-child{opacity:.7!important;font-weight:500!important}'
        + '#aimeat-app-badge input:focus-visible~label{outline:2px solid var(--color-primary,#E8564A)!important;outline-offset:2px!important}';

    // Every user-visible string goes through entities(): the glyphs here are exactly the ones that
    // were rendering as mojibake in a charset-less document. The bolt no longer needs it — SVG
    // markup is ASCII, which is a second thing a drawing buys over a glyph.
    return '<div ' + BADGE_MARK + '>'
        + '<style>' + css + '</style>'
        + '<input type="checkbox" id="aimeat-app-badge-open">'
        + '<label for="aimeat-app-badge-open" aria-label="' + entities('Publish your own app on ' + AIMEAT_LABEL) + '">' + BOLT + '</label>'
        + '<a href="' + AIMEAT_HOME + '" target="_blank" rel="noopener noreferrer" '
        + 'aria-label="' + entities('Publish your own app on ' + AIMEAT_LABEL) + '">'
        + '<span>' + entities(AIMEAT_LABEL) + '</span>'
        + '<span>' + entities('· Publish your own app for free') + '</span>'
        + '</a>'
        + '</div>';
}
