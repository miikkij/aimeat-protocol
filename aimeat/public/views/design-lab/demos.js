/**
 * @file public/views/design-lab/demos.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every live demo the design lab can draw, by catalogue id, plus the gallery's own
 *   extras (the stray wrapper's before and after). `pnpm check:ui-library` holds this index to the
 *   catalogue: every entry has a demo, and every demo is an entry or a named extra.
 * @structure DEMOS · demoFor(id) · isLabOnly(id)
 * @usage import { demoFor } from './demos.js';
 * @version-history
 *   v1.2.0 — 2026-09-23 — Proposal pictures (`proposal:<id>`); the extras went into the decisions.
 *   v1.1.0 — 2026-09-23 — Decision variants (`decision:<id>`) from decision-samples.js.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { STEP_DEMOS } from './demos-steps.js';
import { PAGE_DEMOS } from './demos-page.js';
import { CONVERSATION_DEMOS } from './demos-conversation.js';
import { SHARED_DEMOS, SHAPE_DEMOS } from './demos-shared.js';
import { SAMPLES, PROPOSALS } from './decision-samples.js';

export const DEMOS = { ...STEP_DEMOS, ...PAGE_DEMOS, ...CONVERSATION_DEMOS, ...SHARED_DEMOS, ...SHAPE_DEMOS };

/** A decision's variants as a demo: `decision:<id>`, one variant per sample, each measured. */
function decisionDemo(id) {
  const samples = SAMPLES[id];
  return samples ? { variants: samples.map((s) => ({ name: s.id, measure: s.measure, render: s.render })) } : null;
}

/** A decision's proposal picture as a demo: `proposal:<id>`. */
function proposalDemo(id) {
  const p = PROPOSALS[id];
  return p ? { variants: [{ name: 'proposal', measure: p.measure, render: p.render }] } : null;
}

/** The demo for a catalogue id, a decision (`decision:<id>`) or a proposal (`proposal:<id>`), or null. */
export function demoFor(id) {
  if (id.startsWith('decision:')) return decisionDemo(id.slice('decision:'.length));
  if (id.startsWith('proposal:')) return proposalDemo(id.slice('proposal:'.length));
  return DEMOS[id] ?? null;
}

/** True for an id that is not a catalogue entry, so the preview page asks the catalogue nothing. */
export const isLabOnly = (id) => id.startsWith('decision:') || id.startsWith('proposal:');
