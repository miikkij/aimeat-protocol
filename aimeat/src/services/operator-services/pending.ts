/**
 * @file src/services/operator-services/pending.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A pending device authorization for an operator service's name is never offered to the
 *   person (B1). The node no longer stores one for the service's own credential (routes/agents/
 *   device-auth.ts answers OPERATOR_SERVICE_REFUSED), but an older build did, and any client may ask for
 *   any name. Approving such a request would give an agent under the service's name that no ledger line
 *   names (no fence, no mark, no notice) and take the name for good, so the person's pending lists
 *   (GET /v1/agents/device-authorize/pending, the home feed's count, the waiting list) leave out every
 *   request whose agent name is the id of an entry of agents.operator_services. approveDeviceAuth refuses
 *   one for an agent the service made (OPERATOR_SERVICE_KEY).
 * @structure offeredPending
 * @usage const rows = offeredPending(config, await storage.listPendingDeviceAuthByOwner(owner));
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (operator services, B1).
 */
import type { AimeatConfig } from '../../config.js';

/** `rows` without the requests whose agent name is an operator service entry's id. */
export function offeredPending<T extends { agentName: string }>(config: Pick<AimeatConfig, 'operatorServices'>, rows: readonly T[]): T[] {
  const ids = new Set((config.operatorServices ?? []).map((e) => e.id));
  return ids.size ? rows.filter((r) => !ids.has(r.agentName)) : [...rows];
}
