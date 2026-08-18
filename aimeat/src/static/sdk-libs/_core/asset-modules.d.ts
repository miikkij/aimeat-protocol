/**
 * @file asset-modules.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Types for the non-JS things an SDK library imports at bundle time. esbuild inlines a
 *   `.css` import as a string (the `.css: text` loader in scripts/build-sdk-libs.ts) and a `.json`
 *   import as a module with one named export per top-level key, tree-shaken to what is used. TypeScript
 *   needs telling, and telling it here keeps the alternative — an `any` cast at the import site —
 *   out of the source.
 *
 *   WHY A LIBRARY IMPORTS THESE AT ALL: so there is ONE copy. aimeat-ai's disclose() renders the AI
 *   label from the platform's own public/css/components/ai-label.css and the platform's own
 *   locales/*.json rather than from an SDK-local restatement that would drift.
 * @usage Picked up by tsconfig.sdk.json. No runtime effect.
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5.
 */

declare module '*.css' {
  /** The stylesheet's text, inlined by esbuild's `text` loader. */
  const css: string;
  export default css;
}

declare module '*.json' {
  /** The AI-label strings block, the one key an SDK library reads out of a locale bundle. */
  export const aiLabel: Record<string, string | Record<string, string>>;
}
