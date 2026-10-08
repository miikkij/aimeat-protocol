/**
 * @file src/services/workspace-doc-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance of a workspace document after an in-place edit (an append or a section
 *   replace, services/workspace-doc-edit.ts), when the edit mixes a person's writing and a model's.
 *
 *   The edit stores the WHOLE document, so its record describes the whole document. Minting from the
 *   editor alone got both mixed cases wrong (aiprov E11):
 *     - an agent appending one line to a person's document stamped the whole document ai-generated,
 *       so a person's page read as model-written;
 *     - a person appending to an agent's document minted nothing, so the agent's stamp was dropped
 *       and the model's text read as UNSTATED.
 *   Both are now `assisted` (a model's text and a person's in one document, nobody stating a review),
 *   minted by the node with `observed: false`, and `derivedFrom` names the previous record when there
 *   was one, so a reader can follow what the earlier version said.
 *
 *   Unmixed edits keep their answer: a model editing a model's document is provenanceForWrite's stamp
 *   (ai-generated), a person editing a person's document records nothing.
 * @structure isHumanPrincipal · provenanceForDocEdit(storage, config, input)
 * @usage
 *   const id = await provenanceForDocEdit(storage, config, {
 *     principal: caller.principal, previousId: source.aiProvenanceId, content, pipeline, held });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E11).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import { mintProvenance, provenanceForWrite } from './ai-provenance.js';
import { isGEAI, parseGAII, ownerGhiiOf } from '../utils/gaii.js';

/** A person (a GHII), as opposed to an agent (GAII) or an ecosystem app (GEAI). */
function isHumanPrincipal(principal: string): boolean {
  return !isGEAI(principal) && parseGAII(principal) === null;
}

/**
 * The record a document carries after an in-place edit, HELD in `held` until the edit's swap lands.
 * `previousId` is the record the document carried before the edit, null or absent for none.
 */
export async function provenanceForDocEdit(
  storage: Storage,
  config: Pick<AimeatConfig, 'aiProvenance' | 'aiLabelPublic' | 'nodeId' | 'baseUrl'>,
  input: { principal: string; previousId?: string | null; content: string; pipeline: string; held: AiProvenanceRecordRow[] },
): Promise<string | undefined> {
  if (config.aiProvenance === false) return undefined;
  const previous = input.previousId ? await storage.getAiProvenance(input.previousId) : undefined;
  const writerIsHuman = isHumanPrincipal(input.principal);
  // What the document held before the edit. No record reads as a person's text (an owner's write is
  // never stamped); `assisted` holds both a person's text and a model's.
  const level = previous?.record.level;
  const hadHumanText = !previous || level === 'original' || level === 'assisted';
  const hadModelText = !!previous && level !== 'original';
  const mixed = writerIsHuman ? hadModelText : hadHumanText;
  const surface = { visibility: 'private' as const, humanAudience: true };

  if (!mixed) {
    return provenanceForWrite(storage, {
      principal: input.principal, content: input.content, pipeline: input.pipeline, surface,
      labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
      enabled: config.aiProvenance, held: input.held,
    });
  }

  const before = previous
    ? `whose previous version was recorded as ${previous.record.level} (record ${previous.id})`
    : 'that carried no provenance record, which is how a person\'s own writing is stored';
  const row = await mintProvenance(storage, {
    stampedBy: 'node',
    observed: false,
    ownerGhii: ownerGhiiOf(input.principal),
    principal: input.principal,
    level: 'assisted',
    humanInvolvement: 'none',
    content: input.content,
    generator: { pipeline: input.pipeline },
    ...(previous ? { derivedFrom: [previous.id] } : {}),
    notes: `Mixed authorship: ${writerIsHuman ? 'a person' : 'a non-human principal'} edited a document ${before}. `
      + 'The document now holds both a person\'s text and a model\'s, and nobody stated a review of the model\'s part. '
      + 'The node did not witness the generation.',
    surface,
    labelPolicy: config.aiLabelPublic,
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
  }, input.held);
  return row.id;
}
