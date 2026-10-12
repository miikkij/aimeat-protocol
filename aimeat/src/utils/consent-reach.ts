/**
 * @file src/utils/consent-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How far a consent reaches (Core 2026-11 §5.4, AUTHZ-18; ruling
 *   decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l Q8).
 *
 *   Three values: `local` (the recipient reads matching records on this node), `federation` (as local,
 *   and matching records that are also public may be replicated to peers and listed in the
 *   directory), `auth` (another node may sign the person in with the credentials this node holds).
 *   `private` and `dmz` are older names for `local`: accepted through the 4.x releases, stored and
 *   answered as `local`, and deprecated. A row written before this change may still hold either, so
 *   every read maps it (consentReachOf), in both storage providers.
 *
 *   THE DEFAULT. A consent made without a reach was `federation`, which made a public record
 *   replicable without the person saying so. From CONSENT_REACH_LOCAL_DEFAULT_IN (4.0.0) it is
 *   `local`; before that release it stays `federation`, so nothing changes under a running 3.x node.
 *
 *   A leaf: storage reads it, so it imports nothing from services.
 * @structure ConsentReach · CONSENT_REACHES · CONSENT_REACH_ALIASES · CONSENT_REACH_INPUTS ·
 *   CONSENT_REACH_LOCAL_DEFAULT_IN · CONSENT_REACH_ALIAS_REMOVED_IN ·
 *   defaultConsentReach(version?) · consentReachOf(stored) · isConsentReachAlias(value)
 * @usage
 *   const reach = raw === undefined ? defaultConsentReach() : consentReachOf(raw);
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery, AUTHZ-18).
 */
import { getSoftwareVersion, versionAtLeast } from './version.js';

/** What a consent stores and answers. */
export type ConsentReach = 'local' | 'federation' | 'auth';

/** The three reaches a node answers with. */
export const CONSENT_REACHES: readonly ConsentReach[] = ['local', 'federation', 'auth'];

/** Older names for `local`, accepted on write through 4.x and answered as `local`. */
export const CONSENT_REACH_ALIASES = ['private', 'dmz'] as const;

/** Every value a write may send: the three reaches and the two aliases. */
export const CONSENT_REACH_INPUTS = [...CONSENT_REACHES, ...CONSENT_REACH_ALIASES] as const;

/** The release from which a consent made without a reach is `local` rather than `federation`. */
export const CONSENT_REACH_LOCAL_DEFAULT_IN = '4.0.0';

/**
 * The release that stops taking `private` and `dmz` on a write: they are aliases "through the 4.x
 * releases" (ruling Q8), so the first release after 4.x. A stored row keeps being read as `local`.
 */
export const CONSENT_REACH_ALIAS_REMOVED_IN = '5.0.0';

/** The reach a consent gets when the request names none. */
export function defaultConsentReach(version: string = getSoftwareVersion()): ConsentReach {
  return versionAtLeast(version, CONSENT_REACH_LOCAL_DEFAULT_IN) ? 'local' : 'federation';
}

/** True for `private` and `dmz`, the deprecated names for `local`. */
export function isConsentReachAlias(value: unknown): boolean {
  return (CONSENT_REACH_ALIASES as readonly unknown[]).includes(value);
}

/**
 * The reach a stored or sent value means. An alias and anything unknown read as `local`, the reach
 * that never makes a record replicable, so an unreadable row cannot widen what a consent allows.
 */
export function consentReachOf(stored: unknown): ConsentReach {
  return stored === 'federation' || stored === 'auth' ? stored : 'local';
}
