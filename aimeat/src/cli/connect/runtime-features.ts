/**
 * @file runtime-features.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What this connector's crew runtime honours beyond its tools, presented to the node at
 *   connect in the X-AIMEAT-Features header (tunnel-client.ts).
 *
 *   `aimeat connect serve` hands every agent to a crew runtime, and the connector cannot see which
 *   one or what it can do. The runtime is the party that knows, so it names its features when it
 *   starts the connector: AIMEAT_RUNTIME_FEATURES, comma-separated (`record_spaces,record_backfill`).
 *   The node keeps them on the connector's row, and the home's new-agent page reads them to decide
 *   what it offers for an agent made for this computer: `record_spaces` means the runtime wakes an
 *   agent on the records of the workspace spaces its definition names.
 *
 *   WHY NOT ASK AN AGENT. The node can ask a connected agent what its runtime offers (`crew.menu`),
 *   and that answer carries the same names. A computer with no agent on it has nobody to ask, so
 *   the first agent made for a new computer could not be offered the feature.
 *
 *   UNSET SENDS NOTHING. A connector that presents no header is read by the node as one that did
 *   not say, and the page then asks an agent. An empty list would read as "this runtime honours
 *   nothing", which a runtime that never set the variable has not said.
 * @structure readRuntimeFeatures(value) · CONNECTOR_RUNTIME_FEATURES · featureHeaders()
 * @usage headers: { ...featureHeaders() }
 * @version-history
 *   v1.0.0 -- 2026-10-12 -- Initial (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 */

/** The most names presented, and the shape of one: the node keeps the same (connect-tunnel-roster.ts). */
const FEATURES_MAX = 32;
const FEATURE_NAME = /^[a-z0-9_]{1,64}$/;

/** AIMEAT_RUNTIME_FEATURES as a list of well-formed names, lower-cased, in the order written and without repeats. */
export function readRuntimeFeatures(value: string | undefined | null): readonly string[] {
  const names = String(value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(s => FEATURE_NAME.test(s));
  return [...new Set(names)].slice(0, FEATURES_MAX);
}

/** What this connector presents: the runtime's declaration, or nothing. */
export const CONNECTOR_RUNTIME_FEATURES: readonly string[] = readRuntimeFeatures(process.env.AIMEAT_RUNTIME_FEATURES);

/** The upgrade header, or no header at all when the runtime declared nothing. */
export function featureHeaders(features: readonly string[] = CONNECTOR_RUNTIME_FEATURES): Record<string, string> {
  return features.length ? { 'X-AIMEAT-Features': features.join(',') } : {};
}
