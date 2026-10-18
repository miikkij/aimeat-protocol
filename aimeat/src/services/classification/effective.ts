/**
 * @file src/services/classification/effective.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The EFFECTIVE label of content (plan doc-mvdipuyqraas, L1.3): the highest-ranked of
 *   the content's own label (or the policy's default when it has none) and the labels of the
 *   containers it sits in, with where it came from.
 *     organism or workspace content, a row, a file shared into a workspace:
 *                       own, its workspace's, its organism's
 *     a workspace:      own, its organism's
 *     a board post:     the default raised to its board's (a post has no label of its own)
 *     an app's data:    own, its app's (containers.ts, AN APP'S DATA)
 *     an organism, a board, an app: own
 *   A container counts only with a label someone or something set on it: a container with no row,
 *   or a row that only carries a suggestion over the default, raises nothing, so content labelled
 *   Public stays Public in a workspace nobody classified.
 *
 *   ONE FUNCTION. effectiveLabels() is what the reader (reader.ts: show, useForAi, leave, the
 *   audit and the audience), the federation exit (egress.ts, through leave) and the exposure report
 *   (through show) decide on, and what the label read (labels.ts readContentLabel) reports as
 *   `effective`. effectiveLabel() is the same for one target.
 *
 *   COST. One batch per call: the content's own labels as labelsFor reads them (one query per kind
 *   and scope), then every distinct container of the whole list in one query per container kind and
 *   scope. A page of a thousand records in one workspace reads two container rows' worth of queries,
 *   not a thousand.
 * @structure EffectiveFrom · EffectiveLabel · effectiveLabels() · effectiveLabel()
 * @usage
 *   const eff = await effectiveLabels(storage, policy, targets);   // Map by targetId()
 *   const { label, from } = await effectiveLabel(deps, target);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L1.3).
 */
import type { Storage, ContentLabelRow, ContentLabelTarget, ContentLabelKind } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { labelById, type ClassificationPolicy } from './defaults.js';
import { labelsFor, targetId } from './label-rows.js';
import { containersOf, type ContainerFrom } from './containers.js';
import { policyFor } from './policy.js';

/** Where an effective label came from: the content itself, or one of its containers. */
export type EffectiveFrom = 'own' | ContainerFrom;

export interface EffectiveLabel {
  label: string;
  from: EffectiveFrom;
}

/** The effective label, with the content's own stored row (null when it has none). */
export interface EffectiveRead extends EffectiveLabel {
  row: ContentLabelRow | null;
}

/** The stored labels of containers, by targetId: one query per kind and scope; defaults left out. */
async function storedContainerLabels(storage: Storage, targets: readonly ContentLabelTarget[]): Promise<Map<string, string>> {
  const groups = new Map<string, { kind: ContentLabelKind; scope: string; keys: string[] }>();
  for (const t of targets) {
    const g = `${t.kind}\u0000${t.scope}`;
    const cur = groups.get(g) ?? { kind: t.kind, scope: t.scope, keys: [] };
    cur.keys.push(t.key);
    groups.set(g, cur);
  }
  const out = new Map<string, string>();
  await Promise.all([...groups.values()].map(async g => {
    for (const row of await storage.getContentLabels(g.kind, g.scope, g.keys)) {
      // A row that only carries a waiting suggestion holds the default label: nobody set it.
      if (row.source !== 'default') out.set(targetId(row), row.label);
    }
  }));
  return out;
}

/**
 * The effective label of each target under `policy` (the policy of the targets' scope; a target's
 * containers share it: the organism's for organism content, the owner's for personal content). A
 * row with no label of its own takes its row space's (decided 2026-09-29), addressed as the row key
 * without the row id, and that is its own label here.
 */
export async function effectiveLabels(
  storage: Storage, policy: ClassificationPolicy, targets: readonly ContentLabelTarget[],
): Promise<Map<string, EffectiveRead>> {
  const out = new Map<string, EffectiveRead>();
  if (!targets.length) return out;
  const own = await labelsFor(storage, policy, [...targets]);
  const spaceOf = (t: ContentLabelTarget): ContentLabelTarget => ({ ...t, key: t.key.split('/').slice(0, 2).join('/') });
  const orphanRows = targets.filter(t => t.kind === 'row' && !own.get(targetId(t))?.row);
  const spaces = orphanRows.length ? await labelsFor(storage, policy, orphanRows.map(spaceOf)) : new Map<string, { label: string }>();

  const floors = targets.map(t => containersOf(t));
  const distinct = new Map<string, ContentLabelTarget>();
  for (const list of floors) for (const c of list) distinct.set(targetId(c.target), c.target);
  const stored = distinct.size ? await storedContainerLabels(storage, [...distinct.values()]) : new Map<string, string>();

  const rank = (id: string) => labelById(policy, id)?.rank ?? -1;
  targets.forEach((t, i) => {
    const mine = own.get(targetId(t));
    const ownId = mine?.row ? mine.label
      : t.kind === 'row' ? (spaces.get(targetId(spaceOf(t)))?.label ?? policy.defaultLabel)
        : (mine?.label ?? policy.defaultLabel);
    let best: EffectiveLabel = { label: ownId, from: 'own' };
    for (const c of floors[i]!) {
      const id = stored.get(targetId(c.target));
      if (id && rank(id) > rank(best.label)) best = { label: id, from: c.from };
    }
    out.set(targetId(t), { ...best, row: mine?.row ?? null });
  });
  return out;
}

/** The effective label of one target, under the policy of its scope. */
export async function effectiveLabel(
  deps: { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> }, target: ContentLabelTarget,
): Promise<EffectiveLabel> {
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const e = (await effectiveLabels(deps.storage, policy, [target])).get(targetId(target))!;
  return { label: e.label, from: e.from };
}
