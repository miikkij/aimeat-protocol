/**
 * @file src/services/publish-requests/content-digests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content a skill or cortex publish request binds beside its version, as one digest.
 *   The version alone does not name one content: a deleted skill created again under the same name
 *   starts at 1.0.0 again, and a cortex takes a new manifest under the same version and, uninstalled
 *   and installed again, other libraries too. So the request carries the digest of what the owner was
 *   asked about (ask.ts, at filing), and the applier compares it with what stands now (apply-skill.ts,
 *   apply-cortex.ts). The memory kind does the same with memoryValueDigest (store.ts).
 *
 *   A skill's content is its files, path to text: every manifest field a reader sees is parsed from
 *   SKILL.md. A cortex's content is its manifest (the YAML every record field comes from) and the
 *   library files it serves. Canonical JSON (memoryValueDigest), so both backends give the same
 *   digest for the same content.
 * @structure userSkillContent · cortexContentDigest
 * @usage
 *   const now = await userSkillContent(ctx, owner, name);   // { version, digest } | null
 *   const digest = await cortexContentDigest(storage, record);
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate
 *     and apply-cortex.ts:applyCortexPublish:version-not-bound-to-manifest-or-reinstalled-libs).
 */
import type { CortexExtensionRecord, Storage } from '../../storage/interface.js';
import { resolveSkillRef, formatSkillRef } from '../skills.js';
import { SkillAccessError } from '../skill-types.js';
import { SkillValidationError } from '../skill-md.js';
import { servedCortexLibs } from '../component-versions.js';
import { memoryValueDigest, type PublishStoreCtx } from './store.js';

/** A user skill's version and the digest of its files now, read as its owner; null when there is none. */
export async function userSkillContent(ctx: PublishStoreCtx, owner: string, name: string): Promise<{ version: string; digest: string } | null> {
  try {
    const skill = await resolveSkillRef(ctx.storage, ctx.config, formatSkillRef({ scope: 'user', owner, name }), { ownerName: owner });
    return { version: skill.version, digest: memoryValueDigest(skill.fileContents) };
  } catch (err) {
    // No such skill (or a name that is not one): there is nothing to bind or to publish.
    if (err instanceof SkillAccessError || err instanceof SkillValidationError) return null;
    throw err;
  }
}

/** The digest of a cortex's manifest and the library files it serves now. */
export async function cortexContentDigest(storage: Storage, record: CortexExtensionRecord): Promise<string> {
  return memoryValueDigest({ manifest: record.manifest, libs: await servedCortexLibs(storage, record) });
}
