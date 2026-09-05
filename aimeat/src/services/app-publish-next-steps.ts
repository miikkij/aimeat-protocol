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
 *   v1.2.0 — 2026-09-05 — `acceptance`, on an Atelier app only: the app is accepted from
 *     screenshots at 390 and 1440 in both themes, placed beside the genre it forked (the address
 *     is the genre's own template when the register names one, the Book's genre shelf otherwise),
 *     with the seven measured checks under the picture. The other two fields say what an app
 *     LACKS; this one says how anybody can tell it is finished
 *     (wish-atelier-always-excellent, part 4).
 *   v1.1.0 — 2026-08-25 — `size`: how big the app has become, how fast it is growing, and when that
 *     meets the node's ceiling (services/app-size-health.ts). The two things this file already said
 *     are about what the app LACKS; this is the first one about what it has accumulated, and it is
 *     here for the same reason — the publish response is the surface that gets read.
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/apps.ts (buildNextSteps, 2026-07-19) into the shared
 *     publish path so every door returns it, and the agent-face / bound-skill reminder is stated
 *     rather than folded into a hint about template proposals.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { agentFaceKey } from './agent-face.js';
import { getOwnerScopePublicMemory } from './owner-memory.js';
import { listSkillsByBinding } from './skills.js';
import { appSizeHealth, type AppSizeHealth } from './app-size-health.js';
import { logger } from '../utils/logger.js';

/**
 * The post-publish reflection: does this app have its agent face and its bound skill yet, and what
 * to do about each. Returns undefined when the lookups fail — a publish response missing this field
 * is fine, a publish that failed because of it is not.
 */
export async function buildPublishNextSteps(
  storage: Storage, config: AimeatConfig, ownerName: string, filename: string, publishedBytes?: number,
  track?: 'classic' | 'atelier', register?: string,
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

    // How big it has become, and how fast. Best-effort like everything here: an app whose version
    // line cannot be read still gets its face and skill reminder.
    let size: AppSizeHealth | undefined;
    if (typeof publishedBytes === 'number' && publishedBytes > 0) {
      const history = await storage.listAppVersionSizes(`${ownerName}@${config.nodeId}`, filename)
        .catch(err => { logger.warn('buildPublishNextSteps: continuing after a suppressed failure', { error: String(err) }); return []; });
      size = appSizeHealth({
        bytes: publishedBytes,
        ceilingBytes: config.appMaxSizeMb * 1024 * 1024,
        history,
        at: new Date().toISOString(),
      });
    }

    // An Atelier app is judged on a picture, not on a count. The genre it forked is the thing it
    // has to stand next to, and this is the one surface the publisher is guaranteed to read
    // (docs/pitfalls.md §34: element counts, overflow zero and a green matrix all passed on the
    // pages the owner then rejected).
    const genreAddress = register && /^genre-[a-z0-9-]+$/i.test(register)
      ? `/v1/app-templates/${register}`
      : '/v1/designbook?kind=genre';

    return {
      ...(size ? { size } : {}),
      ...(track === 'atelier' ? {
        acceptance: 'Accept this app from screenshots at 390 and 1440, in both themes, placed '
          + `beside the genre it forked (${genreAddress}), and ask while looking: would this pass `
          + 'beside the genre? Measure alongside it: page width equal to the viewport, nothing '
          + 'past the viewport edge (including inside a box that clips), no text under 11 px, no '
          + 'control under 40 px at 390, contrast 4.5 for body text, no animation still running '
          + 'under reduced motion, and a clean console.',
      } : {}),
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
