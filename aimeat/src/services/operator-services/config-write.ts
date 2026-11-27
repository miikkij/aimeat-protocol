/**
 * @file src/services/operator-services/config-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A service's own credential agent does not write agents.operator_services (S6), even
 *   when it also holds operator:admin: it could rewrite its own entry (widen its words, take the
 *   private read, make itself required, move its audience). An agent that is the `credential_agent` of
 *   any entry, in the stored value or in the value being written, is refused the write and the reset of
 *   that setting, on PUT and DELETE /v1/admin/config and aimeat_admin_config_set
 *   (services/config/admin-view.ts calls this). The operator in person, or another operator agent, may.
 *   The same sentence the per-account switch gives (./operator-switch.ts).
 * @structure OPERATOR_SERVICES_PATH · CREDENTIAL_SWITCH_REFUSAL · credentialSettingRefusal
 * @usage const refused = credentialSettingRefusal(config, caller, changes);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services review, S6).
 */
import type { AimeatConfig } from '../../config.js';
import { parseGaiiLoose } from '../../utils/gaii.js';

export const OPERATOR_SERVICES_PATH = 'agents.operator_services';

/** The refusal a service's own agent gets for switching or rewriting operator services. */
export const CREDENTIAL_SWITCH_REFUSAL = 'An operator service\'s own agent does not change the operator services. The operator does, or an operator\'s agent that is not a service.';

const credentialsIn = (value: unknown): string[] => (Array.isArray(value)
  ? value.map((e) => (e && typeof e === 'object' ? (e as { credential_agent?: unknown }).credential_agent : undefined))
    .filter((n): n is string => typeof n === 'string')
  : []);

/**
 * The refusal for a write (`changes`) or a reset (`path`) of agents.operator_services by an agent that
 * is an entry's credential agent, or null. Anything else, and every other setting, is not this file's.
 */
export function credentialSettingRefusal(
  config: Pick<AimeatConfig, 'operatorServices'>, caller: { sub: string },
  request: { changes: unknown } | { path: string },
): { status: 403; code: 'ACCESS_DENIED'; message: string } | null {
  const touched = 'path' in request
    ? request.path === OPERATOR_SERVICES_PATH ? [] as unknown[] : null
    : Array.isArray(request.changes)
      ? (request.changes as Array<{ path?: unknown; value?: unknown }>).filter((c) => c?.path === OPERATOR_SERVICES_PATH).map((c) => c.value)
      : null;
  if (touched === null || ('changes' in request && touched.length === 0)) return null;
  // The caller's agent name, read off its principal: a person's principal names no agent.
  const name = parseGaiiLoose(caller.sub).agent;
  if (!name) return null;
  const names = new Set([...credentialsIn(config.operatorServices), ...touched.flatMap(credentialsIn)]);
  return names.has(name) ? { status: 403, code: 'ACCESS_DENIED', message: CREDENTIAL_SWITCH_REFUSAL } : null;
}
