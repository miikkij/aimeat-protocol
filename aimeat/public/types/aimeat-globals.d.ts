/**
 * @file aimeat-globals.d.ts
 * @description Ambient type declarations for the no-build frontend. Covers browser globals that
 *   arrive via <script> tags or build-time injection (not ES-module imports), plus the
 *   conventional fields the api.js fetch wrapper attaches to thrown Errors. This lets
 *   `tsc --noEmit` (checkJs) type-check public/ without these surfacing as "cannot find name"
 *   or "property does not exist" noise. It declares no runtime — types only.
 * @usage  Picked up automatically by tsconfig.frontend.json via its d.ts include glob.
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial ambient declarations for frontend type-checking
 */

export {};

declare global {
  /** The window.AIMEAT SDK (auth, data, ai, …) — loaded by aimeat-auth.js before the SPA. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AIMEAT: any;
  /** Chart.js — loaded via a <script> tag on admin pages. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Chart: any;
  /** Build-time version string injected for cache-busting (see i18n.js). */
  const __APP_VERSION__: string;

  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AIMEAT: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Chart: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mermaid: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toastui: any;
    showToast?: (message: string, isError?: boolean) => void;
    /** Preact bundle marker set by the vendored preact build. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __B?: any;
    /** H-2: true when the node serves apps from a separate app origin — set the launchers to
     *  open published apps top-level (apex inline URL 301s to apps.<domain>) instead of the
     *  opaque-sandbox iframe. Injected into spa.html / app-catalog.html by the server. */
    __APP_ORIGIN_ENABLED?: boolean;
  }

  /**
   * The api.js fetch wrapper attaches these fields to thrown Errors so callers can branch
   * on the server error envelope (see public/js/api.js). Declared here so `err.code` /
   * `err.status` / `err.response` type-check at every catch site.
   */
  interface Error {
    code?: string;
    status?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response?: any;
    source?: string;
  }
}
