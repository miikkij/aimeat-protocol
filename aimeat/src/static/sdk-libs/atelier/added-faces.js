/**
 * @file atelier/added-faces.js
 * @description The faces the node's operator added to the running node (the font manager,
 *   services/themes/fonts.ts) reach an Atelier app only when the app's look names one. The kit's
 *   stylesheet imports the base faces (/lib/aimeat-fonts.css through /lib/aimeat-theme.css); the
 *   added faces live in /v1/themes/fonts.css, which the app's own origin serves. Linking that sheet
 *   on every page would cost every app an extra request before its first paint, so the kit links it
 *   only when it is needed (Jouni's decision, 2026-10-03): once the kit's stylesheet has loaded, the
 *   first family of `--ak-font` and of `--ak-font-display` is read off the root, and when one of them
 *   is neither a generic or system face nor a family some `@font-face` on the page already declares,
 *   the sheet is linked once. A look on the base faces costs nothing.
 *
 *   This is the kit's third outward read, in the same class as the two the library header names: a
 *   sessionless GET of a public stylesheet of the app's own origin, the way the kit's own sheet is
 *   read. Nothing here touches a session or a credential.
 * @structure firstFamily(stack) · needsAddedFaces(families, declared) · loadAddedFaces(link)
 * @usage  import { loadAddedFaces } from './added-faces.js'; loadAddedFaces(kitStylesheetLink);
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager, decision 1: the kit loads added faces on demand).
 */

/** The address of the added faces' sheet, on the app's own origin. */
export const ADDED_FACES_HREF = '/v1/themes/fonts.css';
/** The id of the link once it is on the page, so it is added once. */
export const ADDED_FACES_LINK_ID = 'ak-added-faces';
/** The two look tokens that name a face. */
export const FACE_TOKENS = ['--ak-font', '--ak-font-display'];

/** Generic keywords and the faces a browser has without a download. Lower case. */
const SYSTEM_FACES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont',
  'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'verdana', 'tahoma', 'trebuchet ms',
  'georgia', 'times new roman', 'times', 'palatino', 'garamond', 'courier new', 'courier', 'consolas',
  'menlo', 'monaco', 'impact', 'inherit', 'initial', 'unset', 'revert',
]);

/**
 * The first family of a CSS font stack, without its quotes; '' for an empty stack.
 * @param {string} stack  for example "'Space Mono', 'JetBrains Mono', monospace"
 * @returns {string}
 */
export function firstFamily(stack) {
  const s = String(stack || '').trim();
  if (!s) return '';
  const q = s[0];
  if (q === '"' || q === "'") {
    const end = s.indexOf(q, 1);
    return (end > 0 ? s.slice(1, end) : s.slice(1)).trim();
  }
  return s.split(',')[0].trim();
}

/**
 * Whether the page must link the added faces' sheet: one of the families is neither a system face
 * nor declared by an @font-face the page already has.
 * @param {string[]} families  the first family of each face token
 * @param {Iterable<string>} declared  the families the page's @font-face rules declare
 * @returns {boolean}
 */
export function needsAddedFaces(families, declared) {
  const known = new Set();
  for (const f of declared) known.add(String(f).replace(/^["']|["']$/g, '').trim().toLowerCase());
  return families.some((f) => {
    const name = String(f || '').trim().toLowerCase();
    return !!name && !SYSTEM_FACES.has(name) && !known.has(name);
  });
}

/** The families the page's @font-face rules declare, from document.fonts. */
function declaredFamilies() {
  const out = [];
  const set = document.fonts;
  if (set && typeof set.forEach === 'function') set.forEach((face) => { out.push(face.family); });
  return out;
}

/**
 * Read the look off the root and off the app frame (a look preset sets its tokens on the frame),
 * and link the added faces' sheet when the look needs it.
 */
function check() {
  if (document.getElementById(ADDED_FACES_LINK_ID)) return;
  const hosts = [document.documentElement, document.querySelector('.ak-app')].filter(Boolean);
  const families = [];
  for (const host of hosts) {
    const cs = getComputedStyle(/** @type {Element} */ (host));
    for (const name of FACE_TOKENS) families.push(firstFamily(cs.getPropertyValue(name)));
  }
  if (!needsAddedFaces(families, declaredFamilies())) return;
  const link = document.createElement('link');
  link.id = ADDED_FACES_LINK_ID;
  link.rel = 'stylesheet';
  link.href = ADDED_FACES_HREF;
  (document.head || document.documentElement).appendChild(link);
}

let armed = false;

/**
 * Arm the check once per page: when the kit's stylesheet has loaded (so the base faces' @font-face
 * rules are on the page), or at once when it already has.
 * @param {HTMLLinkElement|null} link  the kit's stylesheet link
 */
export function loadAddedFaces(link) {
  if (armed || typeof document === 'undefined') return;
  armed = true;
  if (!link || link.sheet) { check(); return; }
  const run = () => { check(); };
  link.addEventListener('load', run, { once: true });
  link.addEventListener('error', run, { once: true });
}
