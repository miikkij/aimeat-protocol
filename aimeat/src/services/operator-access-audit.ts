/**
 * @file src/services/operator-access-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record an operator leaves when they reach into another person's account: one
 *   usage row in the operator's own stream that names the account inspected, and one line on that
 *   person's account feed.
 *
 *   WHY IT IS ONE FUNCTION. The usage and compliance admin doors each wrote their audit row inline,
 *   and the memory doors, the most invasive reads on the node (another owner's private entry, whole),
 *   wrote none: an operator could search, open, delete and restore somebody's diagnosis and the only
 *   trace was the deleter stamp on a binned row (security audit A8-2). A door that has to remember to
 *   write its own trail is a door that can forget, so the trail is written here and a door calls it.
 *
 *   TWO RECORDS FOR TWO READERS. The usage row is the operator's own accountability record, in the
 *   same stream and shape admin-usage.ts already writes (`actorKind: 'operator'`, the inspected owner
 *   as counterparty), so the operator's access history folds into the rollups like everything else.
 *   The account event is for the person: it is the one place they read about their own account, and
 *   the operator's second-factor reset already tells its target there.
 *
 *   BEFORE THE ANSWER. Both are written before the door responds, so an inspection cannot be served
 *   and then have its record fail to exist because the connection dropped. Neither can fail the
 *   door: the usage buffer and the account-event writer each swallow their own failure and log it.
 *
 *   NOT FOR THE OPERATOR'S OWN DATA. An operator opening an entry of their own account has nobody to
 *   tell, and a principal that is not a person (no `owner@node` behind it) has no feed to tell.
 * @structure OperatorAccess · recordOperatorAccess(storage, config, access)
 * @usage
 *   await recordOperatorAccess(storage, config, {
 *     operatorGhii, actorGaii: operatorGhii, ownerOf: rec.ownerGaii, action: 'read', key: rec.key,
 *   });
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (security audit A8-2), for the four admin memory doors.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf, isValidGHII } from '../utils/gaii.js';
import { recordUsageCall } from './usage/usage-buffer.js';
import { recordAccountEvent } from './account-events.js';

/** What the operator did, as the person's feed names it. */
export type OperatorAccessAction = 'read' | 'search' | 'delete' | 'restore';

export interface OperatorAccess {
  /** The operator's GHII: whose usage stream the row lands in. */
  operatorGhii: string;
  /** The exact principal that acted. For the operator's browser session it is their GHII. */
  actorGaii: string;
  /** Any principal of the account whose data it was: an entry's owner, an agent's GAII. */
  ownerOf: string;
  action: OperatorAccessAction;
  /** The one entry, when there is one. */
  key?: string;
  /** How many of this person's entries a search showed. */
  count?: number;
}

/**
 * Record one operator access to another person's data, on both records. Never throws.
 *
 * The usage coordinate is `memory.<action>`: the memory doors are the only callers today, and the
 * coordinate is what the operator's own usage view groups by.
 */
export async function recordOperatorAccess(
  storage: Storage,
  config: Pick<AimeatConfig, 'accountEventWindow'>,
  access: OperatorAccess,
): Promise<void> {
  const ownerGhii = ownerGhiiOf(access.ownerOf);
  if (!isValidGHII(ownerGhii) || ownerGhii === ownerGhiiOf(access.operatorGhii)) return;

  recordUsageCall({
    ownerGhii: access.operatorGhii,
    actorGaii: access.actorGaii,
    actorKind: 'operator',
    surface: 'operator',
    coordinate: `memory.${access.action}`,
    counterpartyGhii: ownerGhii,
    outcome: 'ok',
    meta: {
      inspected: ownerGhii,
      ...(access.key !== undefined ? { key: access.key } : {}),
      ...(access.count !== undefined ? { returned: access.count } : {}),
    },
  });

  await recordAccountEvent(storage, {
    ownerGhii,
    kind: 'memory_accessed_by_operator',
    actorGaii: access.actorGaii,
    data: {
      operator: access.operatorGhii,
      action: access.action,
      ...(access.key !== undefined ? { key: access.key } : {}),
      ...(access.count !== undefined ? { count: String(access.count) } : {}),
    },
    subject: access.key ?? `memory.${access.action}`,
  }, config);
}
