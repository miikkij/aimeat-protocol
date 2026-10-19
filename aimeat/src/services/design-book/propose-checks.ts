/**
 * @file src/services/design-book/propose-checks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the propose-time bench actually proved, named by kind, so the stored record
 *   says which bench ran. Moved out of service.ts unchanged when that file reached 800 lines, then
 *   given the avatar kind's one check.
 * @structure proposeChecksFor(input)
 * @usage bench: { checks: proposeChecksFor(input), passed_at: now }
 * @version-history
 *   v1.0.0 — 2026-10-19 — Moved from service.ts (pure extraction); `avatar-valid` for the avatar kind.
 */
import type { PartInput } from './validate.js';
import { isGrownGenreBody } from './grown-genre.js';

/** What the propose-time bench actually proved, named by kind — the record says which bench ran. */
export function proposeChecksFor(input: PartInput): string[] {
  if (input.kind === 'layout' || input.kind === 'fill') return ['layout-valid'];
  if (input.kind === 'illustration') return ['style-valid'];
  // One SVG the agent-avatar reader accepts (avatar.ts).
  if (input.kind === 'avatar') return ['avatar-valid'];
  // Markup against the allowlist, the stylesheet under its own prefix, every colour a token.
  if (input.kind === 'component') return ['markup-allowlist', 'styles-scoped', 'colours-are-tokens', 'no-script', 'judgement-given'];
  // A genre that grew out of an app is the proposer's own page; what earns it the shelf is its
  // owner's word, answered in `publishing`, and no bench of this node runs a stranger's script.
  if (input.kind === 'genre' && isGrownGenreBody(input.body)) return ['own-app', 'judgement-given'];
  if (input.kind === 'ambient') {
    // The ambient bench always runs the matrix: the preset is proven on the part's look.
    const checks = ['ambient-valid', 'contrast-matrix'];
    const tokens = (input.body as { tokens?: Record<string, string> }).tokens;
    if (tokens && Object.keys(tokens).length > 0) checks.push('tokens-valid');
    return checks;
  }
  if (input.kind === 'effect') {
    // The effect bench proves the target and the knobs; no words sit under a hero band, a
    // figure or the layer, so the matrix has nothing to measure until the effect lands on
    // words in an arrangement, where the layout validator runs it.
    const checks = ['effect-valid'];
    const tokens = (input.body as { tokens?: Record<string, string> }).tokens;
    if (tokens && Object.keys(tokens).length > 0) checks.push('tokens-valid');
    return checks;
  }
  const checks = ['tokens-valid'];
  const tokens = (input.body as { tokens?: Record<string, string> }).tokens ?? {};
  if (tokens['--ak-accent']) checks.push('contrast-matrix');
  return checks;
}
