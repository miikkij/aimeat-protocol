/**
 * @file src/services/classification/clearance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's CLEARANCE as the reader decides on it (plan doc-mvdipuyqraas, L2.2): the
 *   highest classification label the agent may read, stored on its record as a label id
 *   (AgentRecord.clearance). Content whose effective label (effective.ts) ranks above it is hidden
 *   from the agent and counted, as the other classification hiding is. Missing = no limit.
 *
 *   WHO HAS ONE. Only an agent of this node: an AI reader whose principal is a GAII. A personal
 *   access token, an ecosystem app, an unattended run and a visitor from another node have no
 *   agent record here, so nothing limits them on this axis; their other rules still apply.
 *
 *   THE RANK IS READ FROM THE POLICY OF THE CONTENT'S SCOPE, the one the label was decided under, so
 *   an organism that renumbers nothing reads the same rank as the node. A clearance that policy does
 *   not have (an owner's own label, read on organism content) is looked up in the policy of the
 *   agent's owner, where it was validated when it was set. A clearance neither policy has any more
 *   (the label was deleted) hides everything that has a label: the limit fails closed.
 *
 *   COST. One agent read per reader, made on the first decided item and kept, so a list of a
 *   thousand records costs one lookup; nothing at all while classification is off, for a person,
 *   or for an agent without a clearance (the owner's policy is read only for the fallback).
 * @structure ClearanceCheck · clearanceFor()
 * @usage
 *   const clearance = clearanceFor(deps, who);
 *   if (await clearance.refuses(label, policy)) { … hidden, audited 'refused' … }
 * @version-history
 *   v1.1.0 -- 2026-10-25 -- limitName(): the clearance in words, so a refusal names it (secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2.2).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isValidGAII, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './defaults.js';
import { policyFor } from './policy.js';

export interface ClearanceCheck {
  /** True when `label`, decided under `policy`, ranks above this reader's clearance. */
  refuses(label: ClassificationLabel, policy: ClassificationPolicy): Promise<boolean>;
  /**
   * The clearance in words, for a refusal: the English name of the highest label this reader may
   * read, looked up as `refuses` looks it up; 'nothing classified' when the label is gone; null
   * when the reader has no clearance.
   */
  limitName(policy: ClassificationPolicy): Promise<string | null>;
}

const NONE: ClearanceCheck = { refuses: async () => false, limitName: async () => null };

/**
 * The clearance check of one reader. Anything but an AI reader whose principal is an agent of
 * this node never refuses, without a read.
 */
export function clearanceFor(
  deps: { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> },
  who: { kind: string; principal: string },
): ClearanceCheck {
  if (who.kind !== 'ai' || !who.principal || !isValidGAII(who.principal)) return NONE;
  let held: Promise<string | null> | null = null;
  let ownerPolicy: Promise<ClassificationPolicy | null> | null = null;
  const clearance = () => (held ??= deps.storage.getAgent(who.principal)
    .then(a => a?.clearance ?? null)
    // A failed read must not open what the clearance closes: read it as the strictest limit.
    .catch(err => { logger.warn('classification: the agent\'s clearance could not be read; nothing classified is shown', { gaii: who.principal, error: String(err) }); return ''; }));
  // Without the owner's policy the clearance is looked up in the content's alone, which fails closed.
  const fallback = () => (ownerPolicy ??= policyFor(deps.storage, deps.config, ownerGhiiOf(who.principal))
    .catch(err => { logger.warn('classification: the owner\'s policy could not be read for an agent\'s clearance', { gaii: who.principal, error: String(err) }); return null; }));
  return {
    async refuses(label, policy) {
      const id = await clearance();
      if (id === null) return false;
      const limit = labelById(policy, id) ?? (id ? labelById((await fallback()) ?? policy, id) : undefined);
      return !limit || label.rank > limit.rank;
    },
    async limitName(policy) {
      const id = await clearance();
      if (id === null) return null;
      const limit = labelById(policy, id) ?? (id ? labelById((await fallback()) ?? policy, id) : undefined);
      return limit ? limit.name.en : 'nothing classified';
    },
  };
}
