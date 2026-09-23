/**
 * @file public/views/design-lab/demos.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every live demo the design lab can draw, by catalogue id, plus the gallery's own
 *   extras (the stray wrapper's before and after). `pnpm check:ui-library` holds this index to the
 *   catalogue: every entry has a demo, and every demo is an entry or a named extra.
 * @structure DEMOS · EXTRA_DEMOS · demoFor(id)
 * @usage import { demoFor } from './demos.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { STEP_DEMOS, EXTRA_DEMOS } from './demos-steps.js';
import { PAGE_DEMOS } from './demos-page.js';
import { CONVERSATION_DEMOS } from './demos-conversation.js';
import { SHARED_DEMOS, SHAPE_DEMOS } from './demos-shared.js';

export const DEMOS = { ...STEP_DEMOS, ...PAGE_DEMOS, ...CONVERSATION_DEMOS, ...SHARED_DEMOS, ...SHAPE_DEMOS };
export { EXTRA_DEMOS };

/** The demo for a catalogue id or an extra, or null. */
export function demoFor(id) {
  return DEMOS[id] ?? EXTRA_DEMOS[id] ?? null;
}
