/**
 * @file src/services/app-publish-next-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What is still missing from a freshly published app, told in the one place the
 *   publisher is guaranteed to read: the publish response.
 *
 *   WHY IT LIVES HERE RATHER THAN IN THE MCP TOOL. It was written inside mcp/apps.ts, so the two
 *   things every app on this node needs — an agent face and a bound skill — were mentioned only to
 *   agents publishing INLINE over MCP. That excludes the presigned upload, which is the door the
 *   guidance tells everyone to use above ~1 KB, and both REST doors. The skill says all this too;
 *   the response is the surface that gets read.
 *
 *   BEST-EFFORT, ALWAYS. Enrichment must never be able to fail a publish that has already happened,
 *   so every lookup here swallows its own failure and the whole thing returns undefined rather than
 *   throwing.
 * @structure buildPublishNextSteps(storage, config, ownerName, filename) -> record | undefined
 * @usage import { buildPublishNextSteps } from './app-publish-next-steps.js';
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/apps.ts (buildNextSteps, 2026-07-19) into the shared
 *     publish path so every door returns it, and the agent-face / bound-skill reminder is stated
 *     rather than folded into a hint about template proposals.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { agentFaceKey } from './agent-face.js';
import { getOwnerScopePublicMemory } from './owner-memory.js';
import { listSkillsByBinding } from './skills.js';
import { logger } from '../utils/logger.js';

/**
 * The post-publish reflection: does this app have its agent face and its bound skill yet, and what
 * to do about each. Returns undefined when the lookups fail — a publish response missing this field
 * is fine, a publish that failed because of it is not.
 */
export async function buildPublishNextSteps(
  storage: Storage, config: AimeatConfig, ownerName: string, filename: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    // Resolve the face across the owner's whole keyspace (GHII + the owner's agents), matching what
    // the anonymous serve path serves — so an agent that published the face under its own GAII still
    // reports agent_face_present:true here.
    const [faceRec, boundSkills] = await Promise.all([
      getOwnerScopePublicMemory(storage, config.nodeId, ownerName, agentFaceKey(filename))
        .catch(err => { logger.warn('buildPublishNextSteps: continuing after a suppressed failure', { error: String(err) }); return null; }),
      listSkillsByBinding(storage, config, `app:${ownerName}/${filename}`, { ownerName })
        .catch(err => { logger.warn('buildPublishNextSteps: continuing after a suppressed failure', { error: String(err) }); return []; }),
    ]);

    return {
      agent_face_present: !!faceRec,
      bound_skills_count: boundSkills.length,
      // Stated every time, present or not. An app without a face is a page agents have to scrape,
      // and an app without a bound skill teaches nobody how to operate it.
      agent_face: faceRec
        ? `This app has an agent face (${agentFaceKey(filename)}). Update it on the SAME writes that update the visible view, or agents and humans drift apart.`
        : `No agent face yet. Publish one — AIMEATAgentFace.publish({ title, sections }, { app: "${filename}" }) — so an agent can read this app's state as markdown instead of scraping the DOM. One public memory record: ${agentFaceKey(filename)}.`,
      bound_skill: boundSkills.length > 0
        ? `${boundSkills.length} skill(s) bound to this app. Keep them current with what the app does.`
        : `No skill bound yet. Write the operating guide as a skill with metadata.binding "app:${ownerName}/${filename}" (aimeat_skill_publish) — that is how anyone's AI learns to USE this app rather than guess at it.`,
      template_proposal_hint: 'If anything here generalizes, record it: aimeat_app_template_propose (with your model id). Learnings that would bite the next builder go to aimeat_appdev_pitfall_report.',
    };
  } catch (err) {
    logger.warn('buildPublishNextSteps: continuing after a suppressed failure', { error: String(err) });
    return undefined;
  }
}
