/**
 * @file src/utils/app-csp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one Content-Security-Policy a published AIMEAT app runs under, wherever it is
 *   served from: the app origin (`<sub>.apps.<apex>`), the /v1/apps inline route, and the draft
 *   preview. Kept in a single module because the policy used to exist as three hand-copied string
 *   literals, and a change to one of them silently left the other two behind.
 * @structure appCsp(apexOrigin?, grantedOrigin?, opts?) — the header value; the only variable parts
 *   are the apex origin (silent-SSO bridge + grant-token exchange), at most one frame-grant origin,
 *   and the `sandbox` directive of the isolated frame · APP_FRAME_SANDBOX — that directive's flags,
 *   which are also the `sandbox` attribute of the frame page's iframe (src/static/app-frame.js).
 * @usage
 *   import { appCsp } from '../utils/app-csp.js';
 *   res.setHeader('Content-Security-Policy', appCsp(apexOrigin));   // app origin
 *   res.setHeader('Content-Security-Policy', appCsp());             // inline / draft preview
 *   res.setHeader('Content-Security-Policy', appCsp(apexOrigin, '', { sandboxed: true })); // isolated frame
 * @version-history
 *   v1.4.0 — 2026-09-25 — The isolated frame (audit A7-1): `opts.sandboxed` puts the `sandbox`
 *     directive in front, without allow-same-origin, so the app runs in an opaque origin wherever
 *     the bytes land, a direct open included, and names the node itself beside 'self' in the fetch
 *     directives, because 'self' of a sandboxed document is not a thing to lean on.
 *   v1.3.0 — 2026-09-15 — worker-src 'self' blob:. The third directive to fall to this shape: a
 *     service worker the app origin serves itself was refused, so an installed app could not
 *     receive a notification under its own name and icon.
 *   v1.2.0 — 2026-08-26 — media-src 'self' blob: data: https:. Same shape as the manifest-src bug
 *     below and found the same way — on a live app: <video> and <audio> are fetched under this
 *     directive, it had no entry, so it fell back to default-src 'none' and NO published app could
 *     play any video or audio from anywhere, including a file the app had just produced itself.
 *     Measured in KANSI: a 1 MB MP4 assembled in the page failed with "MEDIA_ELEMENT_ERROR: Media
 *     load rejected by URL safety check". `blob:` is the case that matters — an object the page
 *     created and already holds — and `'self'`/`https:` cover the node's own files; img-src is
 *     already `*`, so this grants no destination an app did not effectively have.
 *   v1.1.0 — 2026-08-16 — manifest-src 'self': the per-app web-app manifest (installable apps) is
 *     fetched under this directive, which has no entry of its own and therefore fell back to
 *     default-src 'none' — the browser refused /manifest.webmanifest on every app origin and
 *     logged a CSP violation on every load. Found on a live app the day the manifest shipped.
 *   v1.0.0 — 2026-07-30 — Extracted from subdomains.ts appCsp() + the two literals in
 *     routes/apps/read.ts; script-src gains 'wasm-unsafe-eval' so apps can compile WebAssembly.
 */

/**
 * What an app in the isolated frame may still do: run, submit forms, open dialogs and new windows
 * (which leave the sandbox, so a link the app opens is an ordinary page), download what it made,
 * lock the pointer and the screen for a game, and take the whole tab on a person's click.
 *
 * `allow-same-origin` is NOT here and must never be: it would give the frame the node's own origin,
 * and with it the cookies, the storage and the session this whole arrangement keeps away from the
 * app. The frame page's iframe carries the same list as its `sandbox` attribute; a browser applies
 * both, so a flag missing from either is missing (test/unit/app-frame.test.ts holds them equal).
 */
export const APP_FRAME_SANDBOX: readonly string[] = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-pointer-lock',
  'allow-orientation-lock',
  'allow-presentation',
  'allow-top-navigation-by-user-activation',
];

/**
 * CSP for a published app. `apexOrigin` (when given) additionally allows the apex in `connect-src`,
 * `frame-src` and `frame-ancestors`: an app served on its own origin frames the apex silent-SSO
 * bridge and POSTs the apex for the H-2 grant-token exchange, and the in-SPA sandboxed viewer on the
 * apex frames the app back. `https://aimeat.io` is already covered by `https:`, but an http dev apex
 * (http://localtest.me) is not — hence the explicit entry. Omit it for the inline/draft routes,
 * which serve from the apex itself.
 *
 * `grantedOrigin` is the single origin named by a verified frame grant (?frame=<token>) on THIS
 * request. One origin, per response, authorized — never a standing list: an earlier version
 * enumerated the owner's app origins here, and at 76 apps the header outgrew the reverse proxy's
 * buffer and every app subdomain answered 502. The size of this header must not depend on how much
 * the owner has accumulated. `frame-ancestors` never opens to `*` (clickjacking).
 *
 * Two script-src decisions worth stating, since both look like invitations to widen further:
 * - `'wasm-unsafe-eval'` permits WebAssembly compilation and nothing else, so ffmpeg.wasm,
 *   sqlite-wasm, image codecs and ML runtimes work. Without it the browser refuses to COMPILE the
 *   module, so self-hosting the .wasm does not help. `'unsafe-eval'` — which would also unlock
 *   eval() and new Function() — is deliberately absent.
 * - COOP/COEP are NOT set on app responses: `crossOriginIsolated` stays false, multi-threaded wasm
 *   and SharedArrayBuffer stay unavailable, and node libs that ship without CORP keep loading.
 *
 * font-src carries 'self' so an app can @font-face from its own origin's public storage
 * (/v1/pub/...) — `https:` covers prod app origins but not http://*.apps.localhost in dev.
 *
 * connect-src carries `blob:` because a wasm runtime fetches its own module: the ffmpeg.wasm idiom
 * is toBlobURL(coreURL) + toBlobURL(wasmURL), and the emscripten glue then fetch()es that blob. A
 * blob: URL is an object the page itself created and already holds — allowing it grants no
 * destination the app did not have, next to a connect-src that already permits all of https:.
 * Measured, not assumed: with wasm compilation allowed and this missing, a real encode still died
 * on "Refused to connect ... blob:".
 *
 * `opts.sandboxed` is the isolated frame (services/app-isolation.ts): a node several people share,
 * with no app origin, serves an app on its own address, and this directive is what keeps the app
 * from being that address. Without allow-same-origin the document gets an opaque origin, so it can
 * read no cookie, no localStorage and no IndexedDB of the node, and a request it makes carries
 * `Origin: null` and no SameSite cookie. It is a response header rather than only the iframe's
 * attribute because the bytes can be opened without the frame (a direct link, a new tab), and the
 * header travels with them. `apexOrigin` then joins script, style, font and media: whether a
 * browser reads 'self' of a sandboxed document as its URL's origin or as the opaque one is not a
 * thing to lean on, and an http node on a LAN name (not localhost) would lose its own /v1/libs and
 * /lib scripts if it read the second, since `https:` and `http://localhost:*` do not cover it.
 */
export function appCsp(apexOrigin = '', grantedOrigin = '', opts: { sandboxed?: boolean } = {}): string {
  const apexAllow = apexOrigin ? ' ' + apexOrigin : '';
  const selfAllow = opts.sandboxed ? apexAllow : '';
  const ancestors = ["'self'", ...(apexOrigin ? [apexOrigin] : []), ...(grantedOrigin ? [grantedOrigin] : [])].join(' ');
  return (opts.sandboxed ? `sandbox ${APP_FRAME_SANDBOX.join(' ')}; ` : '')
    + "default-src 'none'; "
    + `script-src 'self'${selfAllow} 'unsafe-inline' 'wasm-unsafe-eval' blob: https: http://localhost:*; `
    + `style-src 'self'${selfAllow} 'unsafe-inline' https: http://localhost:*; `
    + 'img-src * data: blob:; '
    // <video>/<audio> load under media-src. With no entry it fell back to default-src 'none' and an
    // app could not play a file it had made itself, one line after making it.
    + `media-src 'self'${selfAllow} data: blob: https: http://localhost:*; `
    + `font-src 'self'${selfAllow} data: https:; `
    + `connect-src 'self' https: http://localhost:* wss: ws: data: blob:${apexAllow}; `
    // SERVICE-WORKER REGISTRATION IS GOVERNED BY worker-src, and 'blob:' alone refuses a worker the
    // origin serves itself. So `navigator.serviceWorker.register('/sw.js')` was refused on every app
    // origin, which is the one thing an installed app needs in order to receive a notification under
    // its own name and icon. Third time this file has made the same mistake: manifest-src and
    // media-src both fell back to default-src 'none' the same way, and the directive's absence is
    // never visible as an error in the code, only as a thing that does not work in a browser.
    + "worker-src 'self' blob:; "
    + "manifest-src 'self'; "
    + "object-src 'none'; "
    + `frame-src 'self' blob: data: https: http://localhost:*${apexAllow}; `
    + `frame-ancestors ${ancestors}`;
}
