/**
 * @file eslint.config.js
 * @description ESLint flat config for AIMEAT project. Includes TypeScript-ESLint recommended
 *   rules plus custom AIMEAT rules for file headers and file size limits.
 *
 * @usage
 *   pnpm lint
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-03-13 — Added custom aimeat plugin (file-header, max-file-lines)
 *   v1.2.0 — 2026-06-05 — Ignore src/generated/** (Prisma clients, openapi types)
 *   v1.3.0 — 2026-06-19 — Lint public/ (frontend); ignore vendored frontend dirs;
 *     defer no-undef to tsc (tsconfig.frontend.json checkJs) for browser globals
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import aimeatPlugin from './eslint-rules/index.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test/**',
      // src/static is not our source EXCEPT the SDK-libs migration sources (real, JSDoc-typed
      // ESM under src/static/sdk-libs/, which we DO lint — 800-line + header rules apply). Keep
      // everything else under src/static ignored, and ignore the generated dist bundles.
      'src/static/app-catalog/**',
      'src/static/*.js',
      'src/static/sdk-libs/dist/**',
      'src/generated/**',
      // kysely-codegen output (the typed DB schema) — generated, do not lint.
      'src/storage/providers/*/db-types.ts',
      // Vendored / generated frontend bundles — not our source.
      'public/lib/**',
      'public/cortex-bundled/**',
      'public/samples/**',
    ],
  },
  {
    plugins: {
      aimeat: aimeatPlugin,
    },
    rules: {
      // Cleaned to zero on 2026-07-13 and ratcheted to 'error'. The Prisma storage provider
      // keeps 3 documented per-line disables (dynamic dual client); everything else is typed.
      '@typescript-eslint/no-explicit-any': 'error',
      // Cleaned to zero on 2026-07-13 and ratcheted to 'error' — unused imports/vars/params
      // now fail the pre-commit hook + CI instead of accumulating. Unused args prefixed with `_`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Custom AIMEAT rules
      // file-header cleaned to zero on 2026-07-13 and ratcheted to 'error' — every source
      // file must carry a header, enforced by the pre-commit hook + CI.
      'aimeat/file-header': 'error',
      // Cap raised 500→800 and ratcheted to 'error' on 2026-07-13 once every source file
      // was brought under 800 (large routes/services/views/storage-providers split into
      // sibling modules). New files over 800 now fail the pre-commit hook + CI.
      'aimeat/max-file-lines': ['error', { max: 800 }],

      // A caught error must be rethrown with its cause attached, not replaced by a fresh one that
      // loses the original. Already 'error' for public/ since 2026-07-13; extended to src/ as part
      // of the silent-exception cleanup, since `{ cause }` is what makes a rethrown error traceable.
      'preserve-caught-error': 'error',
    },
  },
  {
    // ── Silent-exception cleanup: ratchet by area ───────────────────────────────────────────────
    // A swallowed error costs most where a WRITE or an identity decision is at stake: the caller
    // reads the absence value as "nothing to do here" and reports success. That is exactly how an
    // extension upsert came to answer `200 success:true` over code it never wrote (2026-07-26).
    //
    // The whole SERVER side is cleaned to zero and enforced. Two treatments were used: a handler that
    // suppresses a real failure logs it (carrying the author's own comment as the message, so the
    // reason why it was thought safe is what an operator reads when it was not), and a handler where
    // the throw is expected control flow — "not a valid JWT, try the refresh path", "not JSON, store
    // as string" — carries a disable stating that.
    //
    // The browser side (public/, src/static/) is enforced separately below: it has no `logger`, and
    // its idioms differ, so it gets its own treatment rather than being forced into this one.
    files: ['src/**/*.ts'],
    rules: {
      'aimeat/no-silent-catch': 'error',
    },
  },
  {
    // The browser SPA. There is no server logger here, and printing every suppressed failure would
    // destroy a signal this project measures against: Rule 1b verification treats a clean console as
    // evidence. So the frontend records them instead — public/js/swallowed.js keeps a bounded buffer,
    // readable at any time with AIMEAT_SWALLOWED() and echoed to the console only under ?debug=1.
    // Browser idioms where the throw IS the answer (storage blocked, no user gesture, a cache entry
    // that is not JSON) carry a disable saying so.
    files: ['public/**/*.js'],
    rules: {
      'aimeat/no-silent-catch': 'error',
      // Session state has ONE source in the frontend: public/js/services/auth.js (and the
      // useSession() hook over it). Reaching into window.AIMEAT.auth directly opts out of the
      // service's guarantee that a session it hands you has not already been signed out — which is
      // how the header came to render the notification bell next to a "Sign In" button (2026-08-07).
      // The service itself carries a file-level disable; see the rule's header for the full story.
      'aimeat/no-direct-auth': 'error',
    },
  },
  {
    // The no-build frontend in public/ is type-checked by tsconfig.frontend.json (checkJs),
    // which detects undefined names with full type info. eslint's no-undef can't see the
    // browser/SDK globals (window, document, AIMEAT, …) and would only flood with false
    // positives that tsc already covers — defer it to tsc.
    files: ['public/**/*.js', 'public/**/*.d.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'off',
      // Preact uses the same hook contract as React, so these rules apply. Warn-level for now
      // (gradual adoption) — surfaces missing/incorrect effect deps and hook-ordering issues.
      // rules-of-hooks + exhaustive-deps cleaned to zero on 2026-07-13 and ratcheted to
      // 'error'. Intentional mount/[key] effects carry a documented per-line disable with
      // justification; genuine missing deps were added (stable values / useCallback-wrapped).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Legacy-frontend findings surfaced when lint coverage was extended to public/
      // (2026-06-19). Cleaned to zero on 2026-07-13 and ratcheted to 'error' so new
      // occurrences fail the pre-commit hook + CI instead of silently accumulating.
      'no-useless-escape': 'error',
      'preserve-caught-error': 'error',
      'no-useless-assignment': 'error',
    },
  },
  {
    // The served SDK libraries (src/static/sdk-libs/) are browser ESM, type-checked by
    // tsconfig.sdk.json (checkJs). As with public/, eslint's no-undef can't see the browser/SDK
    // globals (window, document, speechSynthesis, MediaRecorder, AIMEAT, …) and would only flood
    // with false positives tsc already covers — defer it to tsc. dist/ bundles are ignored above.
    files: ['src/static/sdk-libs/**/*.js'],
    rules: {
      'no-undef': 'off',
      // These libs are ported browser code that uses the classic `var self = this` closure idiom
      // in prototype methods / event callbacks (e.g. aimeat-tunnel's WebSocket client). Allow it.
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
);
