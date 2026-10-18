/**
 * @file public/js/audience.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who can read a thing, as one level the screen names in words (plan doc-mvcn6c7e4e5q,
 *   V6.4). Every kind stores its audience in its own field and its own words: a memory record, a
 *   file and a skill say `visibility` ('private', 'owner', 'members', 'public', 'organism:<id>'), a
 *   board says 'shared' for its chosen members, an app has a listing, an access code and `open_to`, a
 *   workspace share has `access` ('open', 'password', 'account', 'organism'). This module reads each
 *   of them into one level, so components/AudienceBadge.js draws the same words for the same reach
 *   whatever the kind. No imports: test/unit/audience-badge.test.ts runs it as it is.
 *
 *   THE LEVELS, narrowest first:
 *     private    the person, their agents, or people they named (a sharing group, a workspace roster,
 *                a board's chosen members). Not exposure, the same as services/exposure/exposure-types.ts.
 *     organism   the members of one organism (`organismId`).
 *     signed-in  any account of this server.
 *     code       anyone with the address and a code or a password (`secret`: 'code' | 'password').
 *     link       anyone with the address.
 *     public     anyone, and it can be listed.
 *   An unknown value is private: the badge never says a thing is wider than the stored value says.
 * @structure AUDIENCE_LEVELS · audienceOf(value) · appAudienceOf(app) · shareAudienceOf(access, organismId) ·
 *   exposureAudienceOf(item) · audienceKeys(audience)
 * @usage
 *   import { audienceOf, audienceKeys } from '/js/audience.js';
 *   const a = audienceOf('organism:abc');        // { level: 'organism', organismId: 'abc' }
 *   t(audienceKeys(a).word, { name })            // "Innokas Medical members"
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */

/** Every level, narrowest first. */
export const AUDIENCE_LEVELS = ['private', 'organism', 'signed-in', 'code', 'link', 'public'];

const ORGANISM_PREFIX = 'organism:';

/**
 * One stored audience value as a level. Reads every form a kind stores: 'public' (and 'system', a
 * board everyone reads), 'members', 'signed-in', 'community' and 'account' (any account here),
 * 'organism:<id>', 'link', 'open' and 'unlisted' (anyone with the address), 'code' and 'password'.
 * Anything else ('private', 'owner', 'shared', 'group', 'workspace', nothing) is private.
 * @param {unknown} value
 * @returns {{ level: string, organismId?: string, secret?: string }}
 */
export function audienceOf(value) {
  if (typeof value !== 'string') return { level: 'private' };
  if (value.startsWith(ORGANISM_PREFIX) && value.length > ORGANISM_PREFIX.length) {
    return { level: 'organism', organismId: value.slice(ORGANISM_PREFIX.length) };
  }
  switch (value) {
    case 'public': case 'system': return { level: 'public' };
    case 'members': case 'signed-in': case 'community': case 'account': return { level: 'signed-in' };
    case 'link': case 'open': case 'unlisted': return { level: 'link' };
    case 'code': return { level: 'code', secret: 'code' };
    case 'password': return { level: 'code', secret: 'password' };
    default: return { level: 'private' };
  }
}

/**
 * Who can open an app, as GET /v1/apps hands it to its owner: an access code first (a stranger needs
 * it, whatever else is set), then `open_to` (signed-in, or one organism's members), then the listing
 * (listed is public; community and unlisted open for anyone with the address).
 * @param {{ protected?: boolean, access_code?: string, open_to?: string, listing?: string, parked?: boolean }} app
 */
export function appAudienceOf(app) {
  if (!app) return { level: 'private' };
  if (app.protected || app.access_code) return { level: 'code', secret: 'code' };
  const open = app.open_to;
  if (open === 'signed-in') return { level: 'signed-in' };
  if (typeof open === 'string' && open.startsWith(ORGANISM_PREFIX)) return audienceOf(open);
  const listing = app.listing || (app.parked ? 'unlisted' : 'listed');
  return listing === 'listed' ? { level: 'public' } : { level: 'link' };
}

/**
 * Who can open a page a workspace shares, from the share's `access`: 'open' (the default) is anyone
 * with the link, 'password' adds the password, 'account' is any account here, and 'organism' is the
 * members of the organism the workspace belongs to.
 * @param {string|undefined} access
 * @param {string} organismId
 */
export function shareAudienceOf(access, organismId) {
  if (access === 'organism') return organismId ? { level: 'organism', organismId } : { level: 'private' };
  if (access === 'password') return { level: 'code', secret: 'password' };
  if (access === 'account') return { level: 'signed-in' };
  return { level: 'link' };
}

/** An item of GET /v1/exposure/mine: its `level` ('public' | 'link' | 'signed-in' | 'organism') and `organism_id`. */
export function exposureAudienceOf(item) {
  if (!item) return { level: 'private' };
  if (item.level === 'organism') return item.organism_id ? { level: 'organism', organismId: item.organism_id } : { level: 'private' };
  return AUDIENCE_LEVELS.includes(item.level) ? { level: item.level } : { level: 'private' };
}

/**
 * The locale keys that say a level: `word` on the badge, `who` in its tooltip. An organism level
 * whose name the caller does not know says so without a name (`organismUnnamed`).
 * @param {{ level: string, secret?: string }} audience
 * @param {boolean} [named] true when the caller has the organism's name to put into {name}
 */
export function audienceKeys(audience, named = true) {
  const lv = audience?.level;
  if (lv === 'organism') return named
    ? { word: 'audience.organism', who: 'audience.organismWho' }
    : { word: 'audience.organismUnnamed', who: 'audience.organismUnnamedWho' };
  if (lv === 'code') return audience.secret === 'password'
    ? { word: 'audience.password', who: 'audience.passwordWho' }
    : { word: 'audience.code', who: 'audience.codeWho' };
  if (lv === 'signed-in') return { word: 'audience.signedIn', who: 'audience.signedInWho' };
  if (lv === 'link' || lv === 'public') return { word: `audience.${lv}`, who: `audience.${lv}Who` };
  return { word: 'audience.private', who: 'audience.privateWho' };
}
