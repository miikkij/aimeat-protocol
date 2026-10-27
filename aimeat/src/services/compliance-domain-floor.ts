/**
 * @file src/services/compliance-domain-floor.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A register's data domains raise the classification of the containers it names (plan
 *   doc-mvlftkh9zmc9, C2, decision 10.7): a register marked "health" keeps each of its workspaces,
 *   organisms and apps at least Highly confidential. Only a raise; the enforcement is the label's, so
 *   the reader, the audience cap, federation and the agent's clearance all follow without new code.
 *
 *   IT RAISES AS A DETECTION RULE DOES (labels.ts setLabel with a `rule` actor): a label nobody set
 *   rises at once, and a label a person set and locked lower is left alone with a suggestion the
 *   person accepts or rejects, which tells them. A label already at or above the floor is not
 *   touched, so a write never asks to lower anything.
 *
 *   WHERE IT DOES NOTHING, IT SAYS SO. With classification off for a container, or the floor's label
 *   missing from the policy, there is nothing to raise; floorStatus() answers why, and the report
 *   lists it as a gap.
 *
 *   WHICH CONTAINERS. The ones a register names in `containers`. A register of an app scope with
 *   none names the app itself. A register of the node or an organism with a domain and no container
 *   raises nothing, and the report says the register names no container.
 * @structure FloorOutcome · domainFloorOf() · containersOfRegister() · applyDomainFloors()
 * @usage const outcomes = await applyDomainFloors({ storage, config }, scope, registers);
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C2, decision 10.7).
 *   v1.0.1 — 2026-10-24 — The label rule writes as system@<node>, as the other label rules do;
 *     compliance@ was an owner name nobody had reserved (unit synthetic-owner-names).
 *   v1.1.0 — 2026-10-27 — An organism or workspace container moves only when it is the register's own
 *     organism or one the register's keeper creates or administers; any other is reported
 *     'not-in-scope', with nothing read or written (secaudit2026oct26,
 *     compliance-docs:register-containers-not-bound-to-scope).
 */
import type { ContentLabelTarget } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { ownerGhiiOf, localAccountOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { complianceDomainById } from '../data/compliance-domains.js';
import { labelById, type ClassificationPolicy } from './classification/defaults.js';
import { classificationActiveFor, ownerOfScope, policyFor } from './classification/policy.js';
import { appTarget, organismTarget, workspaceTarget } from './classification/containers.js';
import { readContentLabel, setLabel, type LabelActor, type ClassificationDeps } from './classification/labels.js';
import type { ComplianceScope } from './compliance-docs.js';
import type { ComplianceRegister } from './compliance-docs-schemas.js';
import { isOrgManager } from './workspace-access.js';

export interface FloorOutcome {
  register: string;
  container: { kind: string; organism_id?: string; ws?: string; app?: string };
  floor: string;
  /** raised: the label rose; held: already at or above; suggested: a person's lower label waits for them;
   *  off: classification is off for it; no-label: the floor's label is not in the policy; failed: could not be read;
   *  not-in-scope: an organism or workspace the register's keeper does not manage, so it is left alone. */
  outcome: 'raised' | 'held' | 'suggested' | 'off' | 'no-label' | 'failed' | 'not-in-scope';
}

/**
 * Whether a register may move the label of the container it names. An app container is bound to the
 * scope already (containersOfRegister). The node's registers are the operator's, and the operator
 * keeps every container. An organism or workspace counts when it is the register's own organism, or
 * one the register's keeper creates or administers: the writer named in `keeperName`, or for an app's
 * register its owner. Anything else is someone else's organism (secaudit2026oct26).
 */
async function containerInScope(
  storage: ClassificationDeps['storage'], scope: ComplianceScope, named: FloorOutcome['container'], keeperName: string | undefined,
): Promise<boolean> {
  if (named.kind === 'app' || scope.kind === 'node') return true;
  const org = named.organism_id;
  if (!org) return false;
  if (scope.kind === 'organism' && org === scope.organismId) return true;
  return isOrgManager(storage, org, keeperName ?? (scope.kind === 'app' ? scope.ownerName : undefined));
}

/** The highest minLabel among a register's known domains that the policy has, or null. */
export function domainFloorOf(domains: readonly string[] | undefined, policy: ClassificationPolicy): string | null {
  let best: { id: string; rank: number } | null = null;
  for (const id of domains ?? []) {
    const d = complianceDomainById(id);
    const l = d ? labelById(policy, d.minLabel) : undefined;
    if (l && (!best || l.rank > best.rank)) best = { id: l.id, rank: l.rank };
  }
  return best?.id ?? null;
}

/** The label addresses of the containers a register names, and the app itself for an app's register. */
export function containersOfRegister(scope: ComplianceScope, reg: ComplianceRegister, nodeId: string): Array<{ target: ContentLabelTarget; named: FloorOutcome['container'] }> {
  const out: Array<{ target: ContentLabelTarget; named: FloorOutcome['container'] }> = [];
  const listed = reg.containers ?? [];
  if (scope.kind === 'app' && !listed.length) {
    out.push({ target: appTarget(`${scope.ownerName}@${nodeId}`, scope.app), named: { kind: 'app', app: scope.app } });
  }
  for (const c of listed) {
    if (c.kind === 'organism' && c.organism_id) out.push({ target: organismTarget(c.organism_id), named: c });
    else if (c.kind === 'workspace' && c.organism_id && c.ws) out.push({ target: workspaceTarget(c.organism_id, c.ws), named: c });
    else if (c.kind === 'app' && c.app && scope.kind === 'app') out.push({ target: appTarget(`${scope.ownerName}@${nodeId}`, c.app), named: c });
  }
  return out;
}

/**
 * Raise the containers of every register with a domain to the domain's floor. `dryRun` reads and
 * answers what it would do, writing nothing: the report uses it to list what is below its floor.
 */
export async function applyDomainFloors(
  deps: { storage: ClassificationDeps['storage']; config: AimeatConfig }, scope: ComplianceScope,
  registers: readonly ComplianceRegister[], opts: { dryRun?: boolean; keeperName?: string } = {},
): Promise<FloorOutcome[]> {
  const out: FloorOutcome[] = [];
  for (const reg of registers) {
    if (!reg.domains?.length) continue;
    for (const { target, named } of containersOfRegister(scope, reg, deps.config.nodeId)) {
      const push = (floor: string, outcome: FloorOutcome['outcome']) => out.push({ register: reg.id, container: named, floor, outcome });
      try {
        // Read nothing of a container the register may not move: its label state is not the writer's to see.
        if (!(await containerInScope(deps.storage, scope, named, opts.keeperName))) { push(reg.domains.join(','), 'not-in-scope'); continue; }
        if (!(await classificationActiveFor(deps.storage, deps.config, target.scope))) { push(reg.domains.join(','), 'off'); continue; }
        const policy = await policyFor(deps.storage, deps.config, target.scope);
        const floor = domainFloorOf(reg.domains, policy);
        if (!floor) { push(reg.domains.join(','), 'no-label'); continue; }
        const owner = ownerOfScope(target.scope);
        const actor: LabelActor = {
          principal: `system@${deps.config.nodeId}`, kind: 'rule',
          ownerGhii: owner ?? ownerGhiiOf(`system@${deps.config.nodeId}`), ownerName: owner ? localAccountOf(owner) : null,
        };
        const view = await readContentLabel(deps, actor, target);
        const now = labelById(policy, view.label);
        const want = labelById(policy, floor)!;
        if (now && now.rank >= want.rank) { push(floor, 'held'); continue; }
        if (opts.dryRun) { push(floor, view.locked ? 'suggested' : 'raised'); continue; }
        const r = await setLabel(deps, actor, target, { label: floor, reason: `register ${reg.id}: data domain ${reg.domains.join(', ')}` });
        push(floor, r.applied ? 'raised' : 'suggested');
      } catch (err) {
        logger.warn('compliance: a register\'s data domain could not raise a container\'s label', { register: reg.id, container: named, error: String(err) });
        push(reg.domains.join(','), 'failed');
      }
    }
  }
  return out;
}
