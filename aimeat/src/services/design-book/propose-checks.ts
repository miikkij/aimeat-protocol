/**
 * @file src/services/design-book/propose-checks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the propose-time bench actually proved, named by kind, so the stored record
 *   says which bench ran. Moved out of service.ts unchanged when that file reached 800 lines, then
 *   given the avatar kind's one check.
 *
 *   And whether a proposal goes onto the shelf by itself: componentPublishing() moved here from
 *   service.ts unchanged (that file was at 792 lines), and kitPublishing() beside it.
 * @structure proposeChecksFor(input) · componentPublishing(storage, config, ownerGhii, body) · kitPublishing(storage, config, ownerGhii, body, grownGenre)
 * @usage bench: { checks: proposeChecksFor(input), passed_at: now }
 * @version-history
 *   v1.2.0 — 2026-10-30 — `kit-valid` for the kit kind; componentPublishing() moved from service.ts
 *     (pure extraction); kitPublishing(), which also refuses a kit for an organism the proposer is not
 *     an active member of and a genre that is neither served nor standing.
 *   v1.1.0 — 2026-10-29 — `ornament-valid` for the ornament kind.
 *   v1.0.0 — 2026-10-19 — Moved from service.ts (pure extraction); `avatar-valid` for the avatar kind.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { getAppTemplateIndex } from '../../data/app-templates.js';
import type { PartInput } from './validate.js';
import { isGrownGenreBody } from './grown-genre.js';
import { DesignBookReasons } from './reasons.js';
import { DesignBookError } from './errors.js';
import type { ComponentBody } from './component.js';
import { isActiveMember, type KitBody } from './kit.js';

/** What the propose-time bench actually proved, named by kind — the record says which bench ran. */
export function proposeChecksFor(input: PartInput): string[] {
  if (input.kind === 'layout' || input.kind === 'fill') return ['layout-valid'];
  // A look this node ships, its tokens through the look bench, the genre and the set this node has (kit.ts).
  if (input.kind === 'kit') {
    const tokens = (input.body as { tokens?: Record<string, string> }).tokens ?? {};
    return ['kit-valid', ...(Object.keys(tokens).length ? ['tokens-valid'] : []), ...(tokens['--ak-accent'] ? ['contrast-matrix'] : [])];
  }
  if (input.kind === 'illustration') return ['style-valid'];
  // One SVG the agent-avatar reader accepts (avatar.ts).
  if (input.kind === 'avatar') return ['avatar-valid'];
  // A figure the kit draws, its knobs inside the registry's bounds, a look this node ships (ornament.ts).
  if (input.kind === 'ornament') return ['ornament-valid'];
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

/**
 * Whether a component goes onto the shelf by itself. THREE THINGS, ALL OF THEM (ruled
 * 2026-09-20): the bench passed (or this is not reached), its builder judged it GENERAL and
 * said why, and it comes out of an app whose OWNER said the app turned out well. The bench
 * proves it renders and wears the page; it cannot prove anybody else wants it, which is what
 * the judgement is for, and a finished build proves nothing about the app, which is what the
 * owner's word is for. A component that misses one stays proposed: listed in the queue, usable
 * by whoever made it, and one operator action away from the shelf.
 */
export async function componentPublishing(storage: Storage, config: AimeatConfig, ownerGhii: string, body: ComponentBody): Promise<{ earned: boolean; why: string }> {
  if (body.judgement.reach !== 'general') {
    return { earned: false, why: 'Its builder judged it special to one app, so it stays proposed: listed, and usable by whoever made it.' };
  }
  if (!body.from_app) {
    return { earned: false, why: 'It names no app it came out of (from_app), so there is no owner\'s word to earn publishing from. It stays proposed.' };
  }
  const state = await new DesignBookReasons(storage, config).keptState(ownerGhii, body.from_app);
  if (!state.kept) {
    return { earned: false, why: `The owner has not said "${body.from_app}" turned out well (aimeat_designbook_keep). A finished build is not that. It stays proposed until they do; propose it again then.` };
  }
  if (!state.made.length) {
    return { earned: false, why: `The kept version of "${body.from_app}" wrote down nothing it made by hand (the \`made\` list of its build notes), so nothing says this component came out of it. It stays proposed.` };
  }
  return { earned: true, why: `Published: the bench passed, its builder judged it general, and it comes out of "${body.from_app}", which its owner said turned out well.` };
}

/**
 * What a kit needs from the store before it lands, and whether it goes onto the shelf by itself.
 * A kit for an organism is proposed by an active member of it; its genre is one this node serves
 * or one that grew out of an app and still stands. Inside its reach a kit is published at once
 * (kit.ts). For the whole node it earns the shelf the way a component does, from the owner's word:
 * it comes out of an app its owner said turned out well. Otherwise it stays proposed, usable by its
 * proposer, and one operator action away from the shelf.
 */
export async function kitPublishing(
  storage: Storage, config: AimeatConfig, ownerGhii: string, body: KitBody,
  grownGenre: (id: string) => Promise<unknown>,
): Promise<{ earned: boolean; why: string }> {
  if (body.reach === 'organism' && !(await isActiveMember(storage, body.organism ?? '', ownerGhii))) {
    throw new DesignBookError('NOT_A_MEMBER', `You are not an active member of organism "${body.organism}", so you cannot give its members a kit.`, 403);
  }
  if (body.genre && !getAppTemplateIndex().some(t => t.kind === 'genre' && t.id === body.genre) && !(await grownGenre(body.genre))) {
    throw new DesignBookError('BODY_INVALID', `"${body.genre}" is not a genre this node serves. The Design Book lists them under kind genre.`, 422);
  }
  if (body.reach === 'own') return { earned: true, why: 'Yours: only you read it and build with it.' };
  if (body.reach === 'organism') return { earned: true, why: `The members of organism "${body.organism}" read it and build with it. Its owners and admins can make it the organism's default (aimeat_designbook_kit_default).` };
  if (!body.from_app) {
    return { earned: false, why: 'A kit for the whole node names the app it was taken from (from_app), and is published by itself when its owner said that app turned out well. It stays proposed: usable by you, and one operator action away from the shelf.' };
  }
  const state = await new DesignBookReasons(storage, config).keptState(ownerGhii, body.from_app);
  if (!state.kept) {
    return { earned: false, why: `The owner has not said "${body.from_app}" turned out well (aimeat_designbook_keep). It stays proposed until they do; propose it again then.` };
  }
  return { earned: true, why: `Published for everyone: it comes out of "${body.from_app}", which its owner said turned out well.` };
}
