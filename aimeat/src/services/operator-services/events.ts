/**
 * @file src/services/operator-services/events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live change an operator service listens for: `operator-services`, sent to every
 *   operator account of this node when the accounts a service covers change (an account registered,
 *   disabled, enabled or erased; a person turned a service off or on) and when the setting changes.
 *   The SSE stream forwards the domain to the operator in person and, among the things acting for an
 *   operator, only to a principal holding operator:service-provision (auth/sse-domain-scopes.ts), so
 *   the credential agent hears it and reads GET /v1/operator-services/{id}/accounts again. No polling.
 *
 *   Nothing is read or sent on a node with no operator service.
 * @structure OPERATOR_SERVICES_DOMAIN · announceOperatorServices
 * @usage void announceOperatorServices(storage, config);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { emitChange } from '../event-bus.js';
import { listOperatorGhiis } from '../operators.js';
import { logger } from '../../utils/logger.js';

/** The SSE domain of operator services. */
export const OPERATOR_SERVICES_DOMAIN = 'operator-services';

/**
 * Tell every operator account that what an operator service covers changed. Never throws; nothing
 * happens when the setting holds no entry and `force` is not set (a setting change that removed the
 * last entry sets it).
 */
export async function announceOperatorServices(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'operatorServices'>, force = false,
): Promise<void> {
  if (!force && (config.operatorServices ?? []).length === 0) return;
  try {
    for (const ghii of await listOperatorGhiis(storage, config as AimeatConfig)) emitChange(OPERATOR_SERVICES_DOMAIN, ghii);
  } catch (err) {
    logger.warn('operator services: the operators were not told of a change', { error: String(err) });
  }
}
