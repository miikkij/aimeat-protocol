/**
 * @file dompurify-umd.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Type stub for the vendored UMD build public/lib/dompurify@3.4.17/purify.min.js, which
 *   js/editor-html-sanitizer.js imports for its side effect (it sets globalThis.DOMPurify). The
 *   browser loads the real file; tsconfig.frontend.json maps that specifier here so `tsc --noEmit`
 *   does not type-check the minified bundle. The factory is typed loosely on purpose.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 10b).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  var DOMPurify: any;
}

export {};
