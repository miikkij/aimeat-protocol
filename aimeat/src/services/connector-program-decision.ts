/**
 * @file src/services/connector-program-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's decision on one program of one connector: recorded on the connector's row,
 *   and the connector told over its tunnel so it acts at once instead of at its next start.
 *
 *   Its own file so the approval request's applier (publish-requests/apply-connector-program.ts) and
 *   the direct route (connector-programs.ts) record a decision the same way, without an import cycle
 *   through the request store.
 *
 *   THE MACHINE DECIDES WHAT RUNS. The node sends no command: the delivery names the connector and
 *   nothing else, and each agent on it reports again and reads the decisions back
 *   (cli/connect/program-report.ts), acting only on a hash it holds itself.
 * @structure PROGRAMS_DECIDED · recordProgramDecision · tellConnector
 * @usage await recordProgramDecision(ctx, owner, installId, hash, 'allowed');
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { mutateConnector, principalsOnConnector } from './connector-registry.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** The delivery kind a connector hears when the owner decided on one of its programs. */
export const PROGRAMS_DECIDED = 'connector.programs_decided';

type Ctx = { config: AimeatConfig; storage: Storage };

/** Tell every agent on the connector, so each reports again and reads its decision back. */
export function tellConnector(owner: string, installId: string): void {
  const at = Date.now();
  for (const target of principalsOnConnector(owner, installId)) {
    emitDelivery({ target, kind: PROGRAMS_DECIDED, id: `connector-programs/${installId}/${at}`, payload: { type: PROGRAMS_DECIDED, event: PROGRAMS_DECIDED, connector: installId } });
  }
}

/**
 * Record the owner's decision on the programs under `hash` on connector `installId`, and tell the
 * connector. False when the connector is not the owner's, or reports no programs under that hash.
 */
export async function recordProgramDecision(
  ctx: Ctx, owner: string, installId: string, hash: string, decision: 'allowed' | 'declined',
): Promise<boolean> {
  const done = await mutateConnector(ctx, owner, installId, (rec) => {
    if (!Object.values(rec.programs ?? {}).some(p => p.hash === hash)) return { write: false, result: false };
    rec.program_asks = { ...(rec.program_asks ?? {}), [hash]: { decision, decided_at: new Date().toISOString(), request_id: null } };
    return { write: true, result: true };
  });
  if (!done) return false;
  logger.info('Connector program decided', { event: 'connector.program_decided', owner, connector: installId, hash, decision });
  tellConnector(owner, installId);
  emitChange('agents');
  return true;
}
