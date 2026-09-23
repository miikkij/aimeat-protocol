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
 *   v1.1.0 — 2026-09-23 — Decision variants (`decision:<id>`) from decision-samples.js.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { STEP_DEMOS, EXTRA_DEMOS } from './demos-steps.js';
import { PAGE_DEMOS } from './demos-page.js';
import { CONVERSATION_DEMOS } from './demos-conversation.js';
import { SHARED_DEMOS, SHAPE_DEMOS } from './demos-shared.js';
import { SAMPLES } from './decision-samples.js';

export const DEMOS = { ...STEP_DEMOS, ...PAGE_DEMOS, ...CONVERSATION_DEMOS, ...SHARED_DEMOS, ...SHAPE_DEMOS };
export { EXTRA_DEMOS };

/** A decision's variants as a demo: `decision:<id>`, one variant per sample, each measured. */
function decisionDemo(id) {
  const samples = SAMPLES[id];
  return samples ? { variants: samples.map((s) => ({ name: s.id, measure: s.measure, render: s.render })) } : null;
}

/** The demo for a catalogue id, an extra, or a decision (`decision:<id>`), or null. */
export function demoFor(id) {
  if (id.startsWith('decision:')) return decisionDemo(id.slice('decision:'.length));
  return DEMOS[id] ?? EXTRA_DEMOS[id] ?? null;
}
