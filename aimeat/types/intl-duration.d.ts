/**
 * @file types/intl-duration.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ambient declaration for `Intl.DurationFormat`, which this frontend uses and this
 *   TypeScript's `lib` does not carry.
 *
 *   WHY A FILE RATHER THAN A LIB BUMP. The frontend and SDK configs target ES2022, and raising
 *   `lib` to ES2025 would hand every file the whole of ES2025 — including things no browser we
 *   support has — to type-check one API. Declaring the one API keeps the checker honest about
 *   exactly what was verified, which is the same reason `_core/sdk-globals.d.ts` exists.
 *
 *   WHY types/ RATHER THAN BESIDE EITHER CALLER. Both `/js/format.js` and the served SDK's
 *   `_core/format.js` call it, and they are two separate tsc programs. A copy in each would be the
 *   same duplication this whole piece of work exists to remove, in the one place where the compiler
 *   would never notice the two had drifted.
 *
 *   WHAT WAS VERIFIED. `Intl.DurationFormat` is Baseline Newly available since March 2025 (all
 *   three engines) and is present in Node 24 without a flag — measured on 2026-09-13, not assumed.
 *   `/js/format.js` still wraps every call in a try/catch and falls back to bare numbers, because
 *   "Baseline" describes current browsers and a person may be running an older one.
 * @usage Included by tsconfig.frontend.json and tsconfig.sdk.json. No runtime effect.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial, with duration() in /js/format.js.
 */

declare namespace Intl {
  type DurationFormatUnitDisplay = 'long' | 'short' | 'narrow' | 'numeric' | 'always' | 'auto';

  interface DurationFormatOptions {
    localeMatcher?: 'lookup' | 'best fit';
    numberingSystem?: string;
    style?: 'long' | 'short' | 'narrow' | 'digital';
    years?: DurationFormatUnitDisplay;
    yearsDisplay?: 'always' | 'auto';
    months?: DurationFormatUnitDisplay;
    monthsDisplay?: 'always' | 'auto';
    weeks?: DurationFormatUnitDisplay;
    weeksDisplay?: 'always' | 'auto';
    days?: DurationFormatUnitDisplay;
    daysDisplay?: 'always' | 'auto';
    hours?: DurationFormatUnitDisplay;
    hoursDisplay?: 'always' | 'auto';
    minutes?: DurationFormatUnitDisplay;
    minutesDisplay?: 'always' | 'auto';
    seconds?: DurationFormatUnitDisplay;
    secondsDisplay?: 'always' | 'auto';
    milliseconds?: DurationFormatUnitDisplay;
    millisecondsDisplay?: 'always' | 'auto';
    fractionalDigits?: number;
  }

  /** Every field optional; a field left out is a unit the formatter does not print. */
  interface DurationInput {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
    microseconds?: number;
    nanoseconds?: number;
  }

  class DurationFormat {
    constructor(locales?: string | string[], options?: DurationFormatOptions);
    format(duration: DurationInput): string;
    formatToParts(duration: DurationInput): Array<{ type: string; value: string; unit?: string }>;
    resolvedOptions(): DurationFormatOptions & { locale: string };
  }
}
