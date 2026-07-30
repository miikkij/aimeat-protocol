/**
 * @file src/utils/app-csp.ts
 * @description The one Content-Security-Policy a published AIMEAT app runs under, wherever it is
 *   served from: the app origin (`<sub>.apps.<apex>`), the /v1/apps inline route, and the draft
 *   preview. Kept in a single module because the policy used to exist as three hand-copied string
 *   literals, and a change to one of them silently left the other two behind.
 * @structure appCsp(apexOrigin?, grantedOrigin?) — the header value; the only variable parts are
 *   the apex origin (silent-SSO bridge + grant-token exchange) and at most one frame-grant origin.
 * @usage
 *   import { appCsp } from '../utils/app-csp.js';
 *   res.setHeader('Content-Security-Policy', appCsp(apexOrigin));   // app origin
 *   res.setHeader('Content-Security-Policy', appCsp());             // inline / draft preview
 * @version-history
 *   v1.0.0 — 2026-07-30 — Extracted from subdomains.ts appCsp() + the two literals in
 *     routes/apps/read.ts; script-src gains 'wasm-unsafe-eval' so apps can compile WebAssembly.
 */

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
 */
export function appCsp(apexOrigin = '', grantedOrigin = ''): string {
  const apexAllow = apexOrigin ? ' ' + apexOrigin : '';
  const ancestors = ["'self'", ...(apexOrigin ? [apexOrigin] : []), ...(grantedOrigin ? [grantedOrigin] : [])].join(' ');
  return "default-src 'none'; "
    + "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https: http://localhost:*; "
    + "style-src 'self' 'unsafe-inline' https: http://localhost:*; "
    + 'img-src * data: blob:; '
    + "font-src 'self' data: https:; "
    + `connect-src 'self' https: http://localhost:* wss: ws: data: blob:${apexAllow}; `
    + 'worker-src blob:; '
    + "object-src 'none'; "
    + `frame-src 'self' blob: data: https: http://localhost:*${apexAllow}; `
    + `frame-ancestors ${ancestors}`;
}
