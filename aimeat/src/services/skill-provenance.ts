/**
 * @file src/services/skill-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance record of a published skill. A skill's SKILL.md is prose people and
 *   agents read, a skill can be public (readable from other nodes, listed in the public index), and
 *   an AI is exactly who is asked to write one. It carried no record at all until 2026-10-08, so a
 *   public skill an agent wrote read as a person's (aiprov E12).
 *
 *   The record describes SKILL.md, the body a reader loads. It is set on the SKILL.md file record
 *   and on the manifest, which is what a listing and a resolve read. The decision is
 *   provenanceForWrite's: an id the publisher attaches, a declaration, or the node's stamp for an
 *   agent writer; a person publishing without a declaration is not stamped.
 * @structure SkillPublishProvenance · skillProvenanceId(storage, config, provenance, skillMd, visibility)
 * @usage
 *   const id = await skillProvenanceId(storage, config, opts.provenance, skillMd, visibility);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E12).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { provenanceForWrite, type DeclaredProvenance } from './ai-provenance.js';

/** Who publishes the skill and what they said about how it was written. */
export interface SkillPublishProvenance {
  /** The resolved writer: a GHII, GAII or GEAI. */
  principal: string;
  /** The session's own scopes: a declaration needs provenance:write there as well as on the grant. */
  scopes?: readonly string[];
  declared?: DeclaredProvenance;
  declaredId?: string;
}

/**
 * The record SKILL.md carries, or undefined for none. Called BEFORE the skill's first record is
 * written: a declaration the publisher may not make throws ProvenanceScopeError here, and nothing
 * has been stored by then. Absent provenance (a seed, a package install) records nothing.
 */
export async function skillProvenanceId(
  storage: Storage, config: AimeatConfig, provenance: SkillPublishProvenance | undefined,
  skillMd: string, visibility: MemoryRecord['visibility'],
): Promise<string | undefined> {
  if (!provenance) return undefined;
  return provenanceForWrite(storage, {
    principal: provenance.principal,
    scopes: provenance.scopes,
    content: skillMd,
    declaredId: provenance.declaredId,
    declared: provenance.declared,
    pipeline: 'skill.publish',
    surface: { visibility, humanAudience: true },
    labelPolicy: config.aiLabelPublic,
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
    enabled: config.aiProvenance,
  });
}
