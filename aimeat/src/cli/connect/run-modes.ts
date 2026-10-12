/**
 * @file run-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The run modes this connector's runtime can honour, presented to the node at connect
 *   in the X-AIMEAT-Run-Modes header (tunnel-client.ts).
 *
 *   `aimeat connect serve` hands every agent to a crew runtime, and the connector cannot see which
 *   one. The default is `spawn`: aimeat-crewai's daemon and the fleet's spawner start a worker per
 *   piece of work, and nothing in them keeps an agent up. A runtime that CAN keep an agent resident
 *   says so by starting the connector with AIMEAT_RUN_MODES (`spawn,resident`), because the runtime
 *   is the party that knows. The node reads the header when an agent is proposed: a `resident`
 *   proposal for a connector that says `spawn` alone is stored as spawn and says so
 *   (services/agent-proposals.ts, 2026-10-02), and the owner's connector list shows what each
 *   machine can run.
 *
 *   A value that names no known mode is the default, not an empty list: a connector that presented
 *   nothing would be read by the node as one that did not say, and given the benefit of the doubt.
 * @structure KNOWN_RUN_MODES · readRunModes(value) · CONNECTOR_RUN_MODES · runtimeHeaders()
 * @usage headers: { ...runtimeHeaders() }
 * @version-history
 *   v1.2.0 -- 2026-10-12 -- runtimeHeaders(): the run modes and, when the runtime declared any, its
 *     features (./runtime-features.ts), as the headers the tunnel upgrade carries.
 *   v1.1.0 -- 2026-10-10 -- AIMEAT_RUN_MODES: a runtime that keeps agents resident declares it at
 *     the connector's start. Without it the connector presents `spawn`, as before.
 *   v1.0.0 -- 2026-10-02 -- Initial.
 */

import { featureHeaders } from './runtime-features.js';

/** The run modes the node's agent card knows (models/agent-card.ts RUN_MODES). */
export const KNOWN_RUN_MODES: readonly string[] = ['spawn', 'resident'];

/**
 * AIMEAT_RUN_MODES as a list of known run modes, in the order written and without repeats.
 * Unset, empty or naming no known mode: `spawn`.
 */
export function readRunModes(value: string | undefined | null): readonly string[] {
  const modes = String(value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(m => KNOWN_RUN_MODES.includes(m));
  return modes.length ? [...new Set(modes)] : ['spawn'];
}

/** What this connector presents: the runtime's declaration, else `spawn`. */
export const CONNECTOR_RUN_MODES: readonly string[] = readRunModes(process.env.AIMEAT_RUN_MODES);

/**
 * The upgrade headers that describe this connector's crew runtime: how it runs agents, and what
 * it honours beyond its tools when it declared any (./runtime-features.ts).
 */
export function runtimeHeaders(): Record<string, string> {
  return { 'X-AIMEAT-Run-Modes': CONNECTOR_RUN_MODES.join(','), ...featureHeaders() };
}
