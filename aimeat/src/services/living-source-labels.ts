/**
 * @file src/services/living-source-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A living document's source copy inherits the strictest classification of its sources
 *   (TARGET-082 V4, approved by Jouni 2026-09-29). A living document copies snippets of stored items
 *   into its own `living-src` records; without this a copy of a confidential note would carry only
 *   the default label of the organism it was copied into.
 *
 *   HOW. For each copy: when classification is active for the copy's scope, read the effective label
 *   of every source (each in the policy of its own scope), take the highest rank, and pick the copy
 *   policy's lowest active label at or above that rank. When that label ranks above the copy's
 *   current label, set it with a rule actor (`system@<node>`). setLabel's rules then hold: a rule
 *   never lowers a label and never changes a person's locked label (it leaves a suggestion instead).
 *   With the switch off nothing is read and nothing is written.
 *
 *   NEVER FAILS THE WRITE. The copy is already stored when this runs; a failure logs a warning.
 *
 *   KNOWN LIMIT. A source whose label rises later does not raise its copies here: a background pass
 *   raises copies when a source rises (V4, later).
 * @structure SourceCopy · inheritSourceLabels()
 * @usage await inheritSourceLabels({ storage, config }, ownerGaii, [{ key, sources: [memoryTarget(o, k)] }]);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { Storage, ContentLabelTarget } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { labelsFor, memoryTarget, setLabel, targetId, type LabelActor } from './classification/labels.js';
import { classificationActiveFor, policyFor } from './classification/policy.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './classification/defaults.js';

/** One written source copy (a memory key of the copy's owner) and the stored items its text came from. */
export interface SourceCopy {
  key: string;
  sources: ContentLabelTarget[];
}

interface Deps {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;
}

export const INHERIT_REASON = 'inherits the strictest classification of its sources';

/** The copy policy's lowest active label at or above `rank`; the highest active one when none is. */
function labelAtLeast(policy: ClassificationPolicy, rank: number): ClassificationLabel | null {
  const active = policy.labels.filter(l => l.status === 'active').sort((a, b) => a.rank - b.rank);
  return active.find(l => l.rank >= rank) ?? active.at(-1) ?? null;
}

/**
 * Label each copy with the strictest classification of its sources. Policies and the switch are read
 * once per scope for the whole batch. Never throws.
 */
export async function inheritSourceLabels(deps: Deps, ownerGaii: string, copies: readonly SourceCopy[]): Promise<void> {
  const active = new Map<string, Promise<boolean>>();
  const policies = new Map<string, Promise<ClassificationPolicy>>();
  const isActive = (scope: string) => {
    if (!active.has(scope)) active.set(scope, classificationActiveFor(deps.storage, deps.config, scope));
    return active.get(scope)!;
  };
  const policyOf = (scope: string) => {
    if (!policies.has(scope)) policies.set(scope, policyFor(deps.storage, deps.config, scope));
    return policies.get(scope)!;
  };
  const actor: LabelActor = {
    principal: `system@${deps.config.nodeId}`, ownerGhii: ownerGhiiOf(ownerGaii), ownerName: null, kind: 'rule',
  };

  for (const copy of copies) {
    if (!copy.sources.length) continue;
    const target = memoryTarget(ownerGaii, copy.key);
    try {
      if (!(await isActive(target.scope))) continue;
      // Each source's effective label, ranked in the policy of the source's own scope.
      const byScope = new Map<string, ContentLabelTarget[]>();
      for (const s of copy.sources) byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), s]);
      let strictest = -1;
      for (const [scope, targets] of byScope) {
        const policy = await policyOf(scope);
        const labels = await labelsFor(deps.storage, policy, targets);
        for (const t of targets) {
          const id = labels.get(targetId(t))?.label ?? policy.defaultLabel;
          strictest = Math.max(strictest, labelById(policy, id)?.rank ?? -1);
        }
      }
      if (strictest < 0) continue;
      const copyPolicy = await policyOf(target.scope);
      const next = labelAtLeast(copyPolicy, strictest);
      if (!next) continue;
      const current = (await labelsFor(deps.storage, copyPolicy, [target])).get(targetId(target))?.label ?? copyPolicy.defaultLabel;
      if (next.rank <= (labelById(copyPolicy, current)?.rank ?? -1)) continue;   // already as strict: write nothing
      await setLabel(deps, actor, target, { label: next.id, reason: INHERIT_REASON });
    } catch (err) {
      logger.warn('living source copy: the inherited label was not set; the copy stays written', { key: copy.key, error: String(err) });
    }
  }
}
