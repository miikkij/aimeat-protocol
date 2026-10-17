/**
 * @file src/services/build-atelier-review.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier specification's section "What the review always catches", moved here
 *   verbatim from build-atelier-prompt.ts on 2026-10-17 to keep that file under 800 lines when the
 *   data map step joined it (build-data-map-step.ts). The text is unchanged, so the spec token is
 *   unchanged by the move. Its history is in build-atelier-prompt.ts (v1.7.0, 2026-08-28).
 * @structure ATELIER_REVIEW_SECTION
 * @usage import { ATELIER_REVIEW_SECTION } from './build-atelier-review.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Moved verbatim from build-atelier-prompt.ts.
 */

/** The second AEB round's app-level root causes as rules. Placed in the body after "Finishing". */
export const ATELIER_REVIEW_SECTION = '## What the review always catches\n\n'
    + '- A form that switches into edit mode says so: retitle it and its primary action '
    + '("Edit entry" / "Save changes"), and the row being edited stays visibly selected. A form '
    + 'still headed "Log an entry" while it edits reads as adding a duplicate.\n'
    + '- Counters and the lists beside them read from the SAME data, computed in one place. A '
    + 'screen whose numbers disagree with its rows reads as broken even when both are defensible.\n'
    + '- Say a number ONCE. The same three counts as a stat row, as tab labels, as chips and again '
    + 'in a heading is the most common defect the review finds — pick the one place the number '
    + 'earns, and delete the echoes.\n'
    + '- The content people came for comes BEFORE the form that adds to it. In a journal, reading '
    + 'is the daily act; a full-height form above the entries buries the product under its input.\n'
    + '- Master-detail is ALWAYS listDetail, never a hand-rolled pick panel: the component carries '
    + 'the selection mark, the row-to-detail morph and the narrow-screen fold, and a hand-rolled '
    + 'panel loses all three.\n'
    + '- The shell\'s bar is the ONLY top bar. Building a second header of your own puts two bars '
    + 'and the account pill in a fight for the same edge.\n'
    + '- A filter applies WHEN IT CHANGES. A separate Show/Apply button beside a dropdown is a '
    + 'second step nobody expects of a filter.\n'
    + '- Give the shell a `tagline` (one line on what the app IS): the sign-in screen presents the '
    + 'app with it, so a first visitor learns what they are looking at before they log in.\n'
    + '- Storage internals never reach the person: "under keys that start with standup." is a '
    + 'sentence for a developer, not for a screen.\n\n';
