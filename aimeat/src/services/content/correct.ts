/**
 * @file src/services/content/correct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person, or their AI, corrects what the pipeline concluded about one item (Jouni,
 *   2026-10-21: "että voisin vaikuttaa siihen itse sen jälkeen, tai tekoälyllä vaikuttaa siihen ja
 *   korjata jos se on väärin"):
 *
 *   - THE CLASSES. `classes` is the item's whole list as the person says it is. A class the model
 *     gave and the person keeps stays as it was; a class the person adds is theirs (by 'owner',
 *     certainty 1); a class left out goes, and its extracted entity with it. The decision that the
 *     model made is then reviewed on the decision record (decide/service.ts reviewDecision):
 *     'confirmed' when the person kept exactly the model's classes, 'overridden' with the person's
 *     list otherwise, so the decision card shows that a person corrected it.
 *   - THE FIELDS. `fields` holds, per class, the property values the person sets (null removes one).
 *     They are merged onto the extracted values, the entity is built again with the class's
 *     properties (classes.ts entityFor), and the entity records which properties a person set
 *     (`corrected`). Extracting the class again keeps those values (pipeline.ts).
 *   - `extract: true` extracts the classes that have no entity yet (a class the person just added),
 *     which calls a model and so needs ai:use (service.ts asks it).
 * @structure CorrectInput · correctFacts
 * @usage const { facts, review } = await correctFacts(deps, caller, source, { classes: ['invoice'] });
 * @version-history
 *   v1.0.1 — 2026-10-31 — The model's decision is reviewed after the fields are checked and the facts
 *     are stored, not as soon as the classes are: a call whose fields were refused left the decision
 *     record saying a person had overridden the classes (secaudit 2026-10-31 inv-16).
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { reviewDecision } from '../decide/service.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { getFacts, putFacts, sourceIdOf } from './facts-store.js';
import { listClasses, entityFor } from './classes.js';
import { ContentError } from './pipeline.js';
import { fieldsOf } from './correct-fields.js';
import type { ContentFacts, ContentSource, ContentClass, ClassMembership } from './types.js';

type Deps = { storage: Storage; config: AimeatConfig };
type FieldValue = string | number | boolean | null;

export interface CorrectInput {
  classes?: string[];
  fields?: Record<string, Record<string, FieldValue>>;
}

const bad = (message: string) => new ContentError('INVALID_INPUT', 400, message);

/** The class list as the person says it, checked against the classes that exist. */
function nextClasses(current: ClassMembership[], asked: unknown, known: Map<string, ContentClass>): ClassMembership[] {
  if (!Array.isArray(asked) || asked.length > 50 || !asked.every((x) => typeof x === 'string')) {
    throw bad('classes is a list of content class ids (at most 50); an empty list says the item is in none.');
  }
  const ids = [...new Set(asked as string[])];
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw bad(`No content class has the id ${unknown.map((x) => `"${x}"`).join(', ')}. aimeat_content_classes { action: "list" } lists them.`);
  return ids.map((id) => current.find((m) => m.id === id) ?? { id, confidence: 1, by: 'owner' as const });
}

/**
 * Review the model's decision after the person changed or kept its classes. Best-effort: the
 * correction stands whether the review could be recorded or not (an agent may not review a decision
 * it asked for itself), and the reason is logged.
 */
async function reviewModelDecision(
  deps: Deps, caller: CallerContext, before: ClassMembership[], after: ClassMembership[],
): Promise<unknown> {
  const decisionId = before.find((m) => m.by === 'model' && m.decisionId)?.decisionId;
  if (!decisionId) return null;
  const modelIds = before.filter((m) => m.by === 'model').map((m) => m.id).sort();
  const nowIds = after.map((m) => m.id).sort();
  const same = modelIds.length === nowIds.length && modelIds.every((id, i) => id === nowIds[i]);
  try {
    return await reviewDecision(deps.storage, caller.ownerGhii, { principal: caller.principal, inPerson: caller.inPerson }, decisionId,
      same ? { outcome: 'confirmed' } : { outcome: 'overridden', override: { classes: nowIds }, note: `The content classes are ${nowIds.join(', ') || 'none'}.` });
  } catch (err) {
    logger.info('contentclass: the correction stands; the decision review was not recorded', { decision: decisionId, error: String((err as Error)?.message ?? err) });
    return null;
  }
}

/**
 * Apply a correction to one item's facts. Answers the facts as stored and the decision record after
 * its review (null when there was none to review).
 */
export async function correctFacts(
  deps: Deps, caller: CallerContext, source: ContentSource, input: CorrectInput,
): Promise<{ facts: ContentFacts; review: unknown }> {
  if (input.classes === undefined && input.fields === undefined) throw bad('Send classes, fields, or both.');
  const sourceId = sourceIdOf(source);
  const found = await getFacts(deps.storage, caller.ownerGhii, sourceId);
  if (!found) throw new ContentError('NOT_FOUND', 404, `Nothing has been read from ${source.kind} "${source.key}" yet. Inspect it first.`);
  const facts = structuredClone(found);
  const known = new Map((await listClasses(deps.storage, caller.ownerGhii)).map((c) => [c.id, c]));
  const now = new Date().toISOString();
  // The classes as the model left them, when this call changes them. The decision is reviewed only
  // after every part of the call is checked and the facts are stored: a call whose fields are
  // refused must not leave a decision record saying a person corrected the classes.
  let classesBefore: ClassMembership[] | null = null;

  if (input.classes !== undefined) {
    const before = facts.classes ?? [];
    classesBefore = before;
    facts.classes = nextClasses(before, input.classes, known);
    const keep = new Set(facts.classes.map((m) => m.id));
    if (facts.entities) for (const id of Object.keys(facts.entities)) if (!keep.has(id)) delete facts.entities[id];
    // A class added without its fields leaves the extract step undone, so the next inspection with
    // the step on picks them out (the values a person corrected stay, pipeline.ts).
    if (facts.classes.some((m) => !facts.entities?.[m.id] && known.get(m.id)?.process && known.get(m.id)!.properties.length)) delete facts.stages.extract;
  }

  if (input.fields !== undefined) {
    if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw bad('fields is an object: per content class id, the property values to set.');
    for (const [classId, values] of Object.entries(input.fields)) {
      const cls = known.get(classId);
      if (!cls || !(facts.classes ?? []).some((m) => m.id === classId)) throw bad(`The item is not in the content class "${classId}"; correct its classes first.`);
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad(`fields.${classId} is an object of property values.`);
      const props = new Set(cls.properties.map((p) => p.name));
      const named = Object.keys(values);
      const unknown = named.filter((n) => !props.has(n));
      if (unknown.length) throw bad(`The class "${classId}" has no property ${unknown.map((x) => `"${x}"`).join(', ')}. Its properties: ${[...props].join(', ')}.`);
      const prev = facts.entities?.[classId];
      const merged = { ...fieldsOf(prev?.entity, classId) };
      for (const [n, v] of Object.entries(values)) {
        if (v === null || v === '') delete merged[n]; else merged[n] = v;
      }
      facts.entities = { ...(facts.entities ?? {}) };
      facts.entities[classId] = {
        entity: entityFor(cls, merged, { sourceId, baseUrl: deps.config.baseUrl }),
        model: prev?.model ?? '', confidence: prev?.confidence ?? 1,
        ...(prev?.provenanceId ? { provenanceId: prev.provenanceId } : {}), at: prev?.at ?? now,
        corrected: { by: caller.principal, at: now, properties: [...new Set([...(prev?.corrected?.properties ?? []), ...named])] },
      };
    }
  }

  facts.updatedAt = now;
  const writer = { principal: caller.ownerGhii, ownerGhii: caller.ownerGhii, scopes: [] as string[], roles: ['owner'] };
  await putFacts(deps, writer, facts);
  const review = classesBefore ? await reviewModelDecision(deps, caller, classesBefore, facts.classes ?? []) : null;
  emitChange('contentclass', caller.ownerGhii);
  return { facts, review };
}
