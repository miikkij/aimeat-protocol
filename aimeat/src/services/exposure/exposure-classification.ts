/**
 * @file src/services/exposure/exposure-classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification of each exposed item, and whether its level is wider than its
 *   classification allows (plan doc-mvdipuyqraas, L4.1). The exposure report attaches the answer to
 *   each item and lists the CONFLICTS first.
 *
 *   ONE DECISION, read here and never written again. The label is the item's EFFECTIVE one
 *   (classification/effective.ts: its own, raised to its workspace's, organism's, board's or app's).
 *   The cap is that label's `maxAudience`, and the order of levels is audience-levels.ts (capAllows,
 *   storedLevel), the same test the audience cap holds at every write (audience-cap.ts). An item the
 *   owner's 'audience' exception covers (audience-cap.ts audienceExceptionCovers) is no conflict; it
 *   is marked `excepted`.
 *
 *   REPORTED, NEVER CHANGED (decision 10.3). Nothing here writes: a conflict is content that was
 *   already wider than its cap when the cap was set. The report says so, and names the widest level
 *   the item's own setting can take within the cap (`lower_to`), so the page and the person's AI can
 *   lower it through the route that changes that item.
 *
 *   ONLY WHERE CLASSIFICATION IS ON. An item whose scope has classification off gets no answer, and
 *   with the node's switch off nothing is read (reader.ts activePolicies).
 *
 *   COST. The policies once (activePolicies), then per scope one effectiveLabels batch, and the
 *   exceptions only of the scopes where an item is over its cap.
 * @structure ItemClassification · ClassifiedExposure · classifyExposure() · lowerTo()
 * @usage
 *   const cls = await classifyExposure(ctx, ownerGhii, found);
 *   const c = cls.items.get(item);   // undefined: classification is off where the item lives
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L4.1).
 */
import type { ContentLabelTarget } from '../../storage/interface.js';
import { labelById } from '../classification/defaults.js';
import { effectiveLabels, type EffectiveFrom } from '../classification/effective.js';
import { activeExceptionsFor } from '../classification/exceptions.js';
import { targetId } from '../classification/label-rows.js';
import { scopeOrganism } from '../classification/policy.js';
import { activePolicies } from '../classification/reader.js';
import { audienceExceptionCovers } from '../classification/audience-cap.js';
import { capAllows, storedLevel, type AudienceLevel } from '../classification/audience-levels.js';
import type { ExposureContext, ExposureFound, ExposureKind } from './exposure-types.js';

/** What the report says of one item's classification. */
export interface ItemClassification {
  /** The effective label's id. */
  label: string;
  /** Its name in the three languages, and its colour (#rrggbb), as the policy holds them. */
  name: { fi: string; en: string; es: string };
  color: string;
  /** Whether the label is the item's own, or the container's whose label raised it. */
  from: EffectiveFrom;
  /** The widest level the label allows; null: no cap. */
  max_audience: AudienceLevel | null;
  /** The item's level is wider than `max_audience`, and no exception covers it. */
  conflict: boolean;
  /** The item's level is wider than `max_audience`, and the owner's 'audience' exception covers it. */
  excepted?: true;
  /** On a conflict: the widest level this item's own setting can take within the cap. */
  lower_to?: { level: AudienceLevel; organism_id?: string };
}

export interface ClassifiedExposure {
  /** True when classification is on for the owner's own content or for any item's scope. */
  on: boolean;
  /** The answer per item; an item whose scope has classification off has none. */
  items: Map<ExposureFound, ItemClassification>;
  conflicts: number;
  excepted: number;
}

/**
 * The widest level a kind's own setting can take within `cap`, the way each kind stores a level:
 *   a record, a file, a knowledge entry   signed-in for link (no link level), its organism for organism
 *                                         content, private otherwise
 *   a skill                               signed-in for link; private for organism (a skill is personal)
 *   a board                               private (a board has no signed-in level)
 *   an app                                link (unlisted) or signed-in; none for organism or private,
 *                                         which take an access code the owner chooses on the app's page
 *   a workspace share                     signed-in (an account share) for link, the organism, or none
 *   an organism                           private; its member list signed-in, or members only
 * Undefined when the item's setting cannot be lowered from the report (the person opens its page).
 */
export function lowerTo(kind: ExposureKind, id: string, cap: AudienceLevel, scope: string): ItemClassification['lower_to'] {
  const org = scopeOrganism(scope);
  const wide = cap === 'link' || cap === 'signed-in';
  switch (kind) {
    case 'memory':
    case 'file':
    case 'knowledge':
      if (wide) return { level: 'signed-in' };
      return cap === 'organism' && org ? { level: 'organism', organism_id: org } : { level: 'private' };
    case 'skill':
      return wide ? { level: 'signed-in' } : { level: 'private' };
    case 'board':
      return { level: 'private' };
    case 'app':
      return wide ? { level: cap } : undefined;
    case 'workspace_share':
      if (wide) return { level: 'signed-in' };
      return cap === 'organism' && org ? { level: 'organism', organism_id: org } : { level: 'private' };
    case 'organism':
      return id.endsWith('#members') && wide ? { level: 'signed-in' } : { level: 'private' };
    default:
      return undefined;
  }
}

/**
 * The classification of every item that carries a content address, decided under the policy of its
 * scope. `ownerGhii` is the account the report is about: classification counts as on when its own
 * scope has it on, even with nothing exposed.
 */
export async function classifyExposure(ctx: ExposureContext, ownerGhii: string, found: readonly ExposureFound[]): Promise<ClassifiedExposure> {
  const out: ClassifiedExposure = { on: false, items: new Map(), conflicts: 0, excepted: 0 };
  if (ctx.config.classificationMode === 'off') return out;
  const deps = { storage: ctx.storage, config: ctx.config };
  const withContent = found.filter((f): f is ExposureFound & { content: ContentLabelTarget } => !!f.content);
  const policies = await activePolicies(deps, [ownerGhii, ...withContent.map(f => f.content.scope)]);
  out.on = policies.size > 0;
  for (const [scope, policy] of policies) {
    const mine = withContent.filter(f => f.content.scope === scope);
    if (!mine.length) continue;
    const eff = await effectiveLabels(ctx.storage, policy, mine.map(f => f.content));
    const over: Array<{ f: ExposureFound & { content: ContentLabelTarget }; c: ItemClassification }> = [];
    for (const f of mine) {
      const e = eff.get(targetId(f.content));
      const label = labelById(policy, e?.label) ?? labelById(policy, policy.defaultLabel);
      if (!label) continue;
      const cap = label.maxAudience ?? null;
      const c: ItemClassification = {
        label: label.id, name: label.name, color: label.color, from: e?.from ?? 'own', max_audience: cap, conflict: false,
      };
      out.items.set(f, c);
      if (!capAllows(cap, storedLevel(ctx.config, f.level))) over.push({ f, c });
    }
    if (!over.length) continue;
    const rankOf = (id: string) => labelById(policy, id)?.rank ?? -1;
    const exceptions = await activeExceptionsFor(deps, scope, over.map(o => o.f.content));
    for (const { f, c } of over) {
      const label = labelById(policy, c.label)!;
      const covered = (exceptions.get(`${f.content.kind}\u0000${f.content.key}`) ?? []).some(x => audienceExceptionCovers(x, label, rankOf));
      if (covered) {
        c.excepted = true;
        out.excepted++;
        continue;
      }
      c.conflict = true;
      const to = lowerTo(f.kind, f.id, c.max_audience!, scope);
      if (to) c.lower_to = to;
      out.conflicts++;
    }
  }
  return out;
}
