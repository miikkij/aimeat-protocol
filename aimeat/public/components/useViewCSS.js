/**
 * @file public/components/useViewCSS.js
 * @description No-op hook kept only for call-site API compatibility. View CSS is now preloaded as
 *   <link rel="stylesheet"> in spa.html (BUILD_ID-stamped by portal.ts serveSpa), so no dynamic
 *   per-view CSS loading is needed.
 *
 * @structure
 *   - useViewCSS(_cssPath): does nothing; the parameter is ignored
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export function useViewCSS(_cssPath) {
  // CSS is preloaded in spa.html — nothing to do here
}
