/**
 * useViewCSS — no-op hook kept for API compatibility.
 *
 * All view CSS files are now preloaded as <link rel="stylesheet"> in spa.html
 * (stamped with BUILD_ID at serve time by portal.ts serveSpa), so CSS is always
 * applied before any view component renders. No dynamic loading needed.
 *
 * @param {string} _cssPath — unused, kept for call-site compatibility
 */
export function useViewCSS(_cssPath) {
  // CSS is preloaded in spa.html — nothing to do here
}
