/**
 * @file run-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The run modes this connector's runtime can honour, presented to the node at connect
 *   in the X-AIMEAT-Run-Modes header (tunnel-client.ts).
 *
 *   `aimeat connect serve` hands every agent to a crew runtime that starts a worker per piece of
 *   work (aimeat-crewai's daemon, and the fleet's); nothing here keeps an agent resident. The node
 *   reads this when an agent is proposed: a `resident` proposal on an account whose connectors all
 *   say `spawn` is stored as spawn and says so (services/agent-proposals.ts, 2026-10-02).
 * @structure CONNECTOR_RUN_MODES
 * @usage headers: { 'X-AIMEAT-Run-Modes': CONNECTOR_RUN_MODES.join(',') }
 * @version-history
 *   v1.0.0 -- 2026-10-02 -- Initial.
 */

/** What this connector can run. One value, because the runtime it serves spawns. */
export const CONNECTOR_RUN_MODES: readonly string[] = ['spawn'];
