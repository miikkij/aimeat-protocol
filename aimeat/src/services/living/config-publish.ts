/**
 * @file src/services/living/config-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `status` of a living-document config that a member of another account publishes
 *   over: the holder's stored status stays.
 *
 *   WHY. A living config's `status` holds the holder's controls and the pulse's own state: the owner's
 *   pause (status.paused, written by the Living page's owner save), the retirement (status.health
 *   'retired' at the charter's stop condition), the pulse count that max_pulses compares and the
 *   cadence clock (status.last_pulse). The owner's one-press allowance for a writer of another account
 *   is bound to the config's content without `status` (living-pulse-spend.ts livingConfigContent),
 *   because the pulse rewrites `status` on every run. A member who republished the allowed content with
 *   a fresh status resumed a paused document, revived a retired one or restarted its pulse count, and
 *   the next pulse spent the owner's AI with no new question (secaudit2026nov08b round 15,
 *   living-pulse-spend.ts:livingConfigContent:status-outside-allowance-hash).
 *
 *   THE RULE. A publish of a `living-config` value at `organism.<org>.w.<ws>.living.<doc>.latest` by a
 *   publisher of another account than the record's holder writes the holder's stored `status`, or no
 *   status when the stored value is not a living config. Every other field is the publisher's, as
 *   before, and the allowance hash still decides whether the pulse may spend for it. A publish by the
 *   holder or by the holder's own agents is unchanged, and so are the owner's plain saves and the
 *   pulse's own status write, which do not publish.
 *
 *   A publish that changes the content (sections, charter, title) leaves the cadence clock
 *   (status.last_pulse) out, so the pulse asks the owner about the change at once, as it did before;
 *   the owner's answer comes before any spend.
 * @structure isLivingConfigLatestKey · holderLivingStatus
 * @usage const value = holderLivingStatus(`${base}.latest`, draftValue, existingLatest?.value, publisherGhii, holderGhii);
 * @version-history
 *   v1.0.2 -- 2026-11-09 -- The key pattern takes dot-free organism and workspace ids, so it no longer
 *     backtracks polynomially on a crafted key (code scanning alert 1784, js/polynomial-redos).
 *   v1.0.1 -- 2026-11-08 -- Moved from src/services/living-config-publish.ts into a domain folder
 *     (check:services-flat); no behaviour change.
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15,
 *     living-pulse-spend.ts:livingConfigContent:status-outside-allowance-hash).
 */
import { canonicalJson } from '../../utils/memory-content.js';

// Organism and workspace ids hold no dot (services/write-guards.ts KEY_RE), so each segment is
// `[^.]+`: two lazy `.+?` around `.w.` backtracked polynomially on a crafted key (code scanning 1784).
const LIVING_LATEST_RE = /^organism\.([^.]+)\.w\.([^.]+)\.living\.([^.]+)\.latest$/;

/** A living-document config's published key (services/living-pulse.ts CONFIG_RE). */
export const isLivingConfigLatestKey = (key: string): boolean => LIVING_LATEST_RE.test(key);

const isLivingConfig = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (v as { type?: unknown }).type === 'living-config';

/** A config without its `status`, as one comparable string (the content the owner's allowance names). */
const contentOf = (v: Record<string, unknown>): string => {
  const { status: _status, ...rest } = v;
  void _status;
  return canonicalJson(rest);
};

/**
 * The value a publish writes at a living config's `.latest`. `publisherGhii` and `holderGhii` are the
 * accounts (GHII) of the publisher and of the record's holder; when they differ and the published value
 * is a living config, its `status` is the stored one. When the published content also differs from the
 * stored content, `last_pulse` is left out, so the next pulse comes due at once and asks the owner
 * about the change (living-pulse-spend.ts) instead of waiting out the cadence; nothing is spent before
 * the owner answers. Otherwise `value` is returned unchanged.
 */
export function holderLivingStatus(
  latestKey: string, value: unknown, storedValue: unknown, publisherGhii: string, holderGhii: string,
): unknown {
  if (publisherGhii === holderGhii || !isLivingConfigLatestKey(latestKey) || !isLivingConfig(value)) return value;
  const { status: _published, ...rest } = value;
  void _published;
  if (!isLivingConfig(storedValue) || !storedValue.status || typeof storedValue.status !== 'object') return rest;
  const status = { ...(storedValue.status as Record<string, unknown>) };
  if (contentOf(value) !== contentOf(storedValue)) delete status.last_pulse;
  return { ...rest, status };
}
