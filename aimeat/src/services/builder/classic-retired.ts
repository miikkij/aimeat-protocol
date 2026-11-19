/**
 * @file src/services/builder/classic-retired.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the addresses of the retired Classic build specification serve since
 *   2026-11-19: the Atelier specification, with a notice that says so.
 *
 *   WHY THE ADDRESSES STAY. GET /v1/prompts/build-app, its sections and `aimeat_handbook_get { tier:
 *   "build-app" }` are written into prompts people pasted, skills on other nodes, llms.txt copies and
 *   the memory of models. A 404 there would leave such an AI with nothing; the Classic text would
 *   build an app on a retired track. So each answers with the Atelier specification and says, first,
 *   that the guide it asked for is gone and which one replaced it (decision-atelier-is-the-only-app-
 *   build-guide-classic-and-t1-t2-t3-are, plan doc-mwnnroacarhc).
 *
 *   THE WHOLE TEXT IS THE PASTE DELIVERY. The reader of GET /v1/prompts/build-app?format=txt was an AI
 *   that could not connect: the Classic text was the self-contained one. It now gets the Atelier text
 *   with ?delivery=paste's preface and publish-by-hand section (atelier-platform.ts).
 *
 *   A CLASSIC SECTION ID FINDS ITS ATELIER PLACE. The Classic parts `start`, `libraries` and `look`
 *   have Atelier parts of the same name; `data` became the platform section `data-storage`; every
 *   on-demand Classic section the Atelier platform serves keeps its id. Anything else (the tier
 *   shapes, the hand-written sign-in, the daisyUI design sections) is gone, and the answer names the
 *   ids there are.
 * @structure CLASSIC_RETIRED_NOTICE · retiredPieceId(id) · retiredBuildAppText(config, opts)
 * @usage const { full, body, specToken } = retiredBuildAppText(config, { mode, lang, idea });
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import { buildAtelierPrompt, buildAtelierSpecToken } from './atelier-prompt.js';
import { ATELIER_PARTS } from './atelier-layers.js';
import { ATELIER_PLATFORM } from './atelier-platform.js';

/** The first thing every retired address says. */
export const CLASSIC_RETIRED_NOTICE = '## This address now serves the Atelier specification\n'
  + 'The Classic build specification that lived here was retired on 2026-11-19, with its T1/T2/T3 shells. '
  + 'What follows is the Atelier specification, the one guide every app on this node is built and changed with. '
  + 'Connected over MCP, read it in parts instead: `aimeat_handbook_get { tier: "build-app-atelier" }`. '
  + 'An app that was built on the Classic track is moved with its section `from-classic`.\n\n';

/** The Atelier id a Classic part or section id now answers with, or null when it has none. */
export function retiredPieceId(id: string): string | null {
  if (id === 'data') return 'data-storage';
  if (ATELIER_PARTS.some(p => p.id === id)) return id;
  if (id === 'platform' || ATELIER_PLATFORM.some(s => s.id === id)) return id;
  return null;
}

/** The whole text the retired GET /v1/prompts/build-app answers: the notice, then the paste delivery. */
export function retiredBuildAppText(
  config: AimeatConfig, opts: { mode?: 'new' | 'improve'; lang?: string; idea?: string } = {},
): { full: string; body: string; specToken: string } {
  const { full, body } = buildAtelierPrompt(config, { ...opts, delivery: 'paste' });
  return { full: CLASSIC_RETIRED_NOTICE + full, body, specToken: buildAtelierSpecToken(config) };
}
