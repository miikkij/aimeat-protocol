/**
 * @file src/services/classification/audience-levels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audience levels a label's cap names, their order, and the pure questions asked of
 *   them (plan doc-mvdipuyqraas, L3.1). Pure: nothing here reads storage.
 *
 *   ONE ORDER. The levels are the exposure report's (services/exposure/exposure-types.ts LEVELS, widest
 *   first: public, link, signed-in, organism) with 'private' below them, for content nobody outside
 *   reads. So private < organism < signed-in < link < public, and a label's `maxAudience` is the widest
 *   of these its content may be given. No second list: a level added to the report is a level here.
 *
 *   ON A CLOSED NODE (config contentAccess 'signed-in') nothing is served wider than the node's own
 *   accounts, so public and link compare as signed-in (storedLevel): the cap is held against what the
 *   node actually serves, as the exposure report lists it.
 * @structure AudienceLevel · AUDIENCE_LEVELS · isAudienceLevel() · audienceRank() · isWiderAudience() ·
 *   narrowerCap() · storedLevel() · capAllows() · AUDIENCE_LEVEL_WORDS
 * @usage
 *   if (!capAllows(label.maxAudience, storedLevel(config, 'public'))) → refuse
 *   const cap = narrowerCap(node.maxAudience, layer.maxAudience);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3.1).
 */
import { signedInOnly, type ContentAccess } from '../../config-visibility.js';
import { LEVELS, type ExposureLevel } from '../exposure/exposure-types.js';

/** Who may read content: one of the exposure levels, or private (nobody outside). */
export type AudienceLevel = ExposureLevel | 'private';

/** Every level, from the narrowest to the widest: private, organism, signed-in, link, public. */
export const AUDIENCE_LEVELS: readonly AudienceLevel[] = ['private', ...[...LEVELS].reverse()];

/** How each level is named in a sentence (English; the locales carry the other languages). */
export const AUDIENCE_LEVEL_WORDS: Record<AudienceLevel, string> = {
  private: 'only its owner',
  organism: 'the members of an organisation',
  'signed-in': 'everyone signed in to this node',
  link: 'anyone with the link',
  public: 'anyone',
};

export function isAudienceLevel(v: unknown): v is AudienceLevel {
  return typeof v === 'string' && (AUDIENCE_LEVELS as readonly string[]).includes(v);
}

/** The position of a level in the order: 0 for private, up to 4 for public. */
export function audienceRank(level: AudienceLevel): number {
  return AUDIENCE_LEVELS.indexOf(level);
}

/** Is `a` a wider audience than `b`? */
export function isWiderAudience(a: AudienceLevel, b: AudienceLevel): boolean {
  return audienceRank(a) > audienceRank(b);
}

/** The narrower of two caps; no cap (null or undefined) admits everything, so the other one stands. */
export function narrowerCap(a: AudienceLevel | null | undefined, b: AudienceLevel | null | undefined): AudienceLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return isWiderAudience(a, b) ? b : a;
}

/** The level the node serves for `level`: on a closed node public and link are signed-in. */
export function storedLevel(config: { contentAccess?: ContentAccess }, level: AudienceLevel): AudienceLevel {
  return signedInOnly(config) && (level === 'public' || level === 'link') ? 'signed-in' : level;
}

/** Does a cap admit this level? No cap admits every level. */
export function capAllows(cap: AudienceLevel | null | undefined, level: AudienceLevel): boolean {
  return !cap || !isWiderAudience(level, cap);
}
