/**
 * @file src/services/app/freshness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One answer to "what beside this app has gone stale": GET
 *   /v1/apps/:owner/:filename/freshness and aimeat_app_manage { action: "freshness" } both call
 *   appFreshnessFor(). For each document beside the app it says whether it exists and whether it is
 *   behind the app as it is now:
 *
 *     design spec     written or confirmed against an older version than the live one
 *     criteria        lines evidenced at an older version than the live one, and the open lines
 *     data map        present or not (it has no version of its own to compare)
 *     bound skills    each skill bound to the app, with the calls in it that the app's tools now
 *                     refuse (skill/tool-fields.ts), so a tool change that broke a skill is seen
 *                     without waiting for the skill's next publish
 *
 *   WHY. Each of these had its own signal, or none: the spec said it was stale only when read, a
 *   bound skill was checked against the app's tools only when the skill itself was published, and a
 *   criterion evidenced at version 2 still read as evidenced at version 9. This project's own rule is
 *   that knowledge has a lifecycle and every store that accumulates needs an answer to "how does this
 *   go stale"; this is the answer for an app's documents.
 *
 *   READ ONLY. Nothing is changed; the answer names what to do for each item that is behind. The
 *   publish answer carries the bound-skill part on every publish (`bound_skill_issues`), because a
 *   publish that changed the tools is when a skill breaks.
 * @structure appFreshnessFor(storage, config, caller, ref) · boundSkillIssues(storage, config, ownerName, filename)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-one-freshness-answer-per-app-spec-skill-pitfalls-behind-the-).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { listSkillsByBinding, resolveSkillRef } from '../skills.js';
import { skillToolFieldIssues } from '../skill/tool-fields.js';
import { readAppDataMap } from '../data-map/data-map-store.js';
import { resolveAppTarget } from './dev-grant.js';
import { readAppDesignSpec, isDesignSpecStale } from './design-spec.js';
import { criteriaCounts } from './acceptance-criteria.js';
import { appDataMapId } from './app-ref.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome } from './op-outcome.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export interface BoundSkillFreshness {
  ref: string;
  version: string;
  /** The calls in the skill that the app's tools refuse now: path, tool, field and what is accepted. */
  tool_field_issues: Array<{ path: string; tool: string; field: string; message: string }>;
}

/**
 * Every skill bound to the app, each with the calls the app's tools now refuse. A skill that cannot
 * be read is left out and logged: this is advice beside an answer that stands.
 */
export async function boundSkillIssues(
  storage: Storage, config: AimeatConfig, ownerName: string, filename: string,
): Promise<BoundSkillFreshness[]> {
  const binding = `app:${ownerName}/${filename}`;
  const accessor = { ownerName };
  const out: BoundSkillFreshness[] = [];
  for (const summary of await listSkillsByBinding(storage, config, binding, accessor)) {
    try {
      const skill = await resolveSkillRef(storage, config, summary.ref, accessor);
      const texts = Object.fromEntries(Object.entries(skill.fileContents).filter(([p]) => /\.md$/i.test(p)));
      const issues = await skillToolFieldIssues(storage, config, summary.binding ?? binding, texts);
      out.push({
        ref: summary.ref, version: summary.version,
        tool_field_issues: issues.map(i => ({ path: i.path, tool: i.tool, field: i.field, message: i.message })),
      });
    } catch (err) {
      logger.warn('app freshness: bound skill not read', { ref: summary.ref, error: String(err) });
    }
  }
  return out;
}

/** GET .../freshness: what beside the app is behind the app as it is now. */
export async function appFreshnessFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: { owner: string; filename: string },
): Promise<AppOpOutcome> {
  if (!FILENAME_RE.test(ref.filename)) return refuse(400, 'INVALID_INPUT', 'Invalid filename.');
  const t = await resolveAppTarget(storage, config, {
    callerOwner: localAccountName(caller.owner),
    requestedOwner: ref.owner === 'me' ? '' : ref.owner,
    filename: ref.filename,
    act: 'draft',
  });
  if (!t.ok) return refuse(t.status, t.code, t.message);
  const app = await storage.getAppByOwnerName(t.ownerName, ref.filename);
  if (!app) return refuse(404, 'NOT_FOUND', 'No such app.');
  const live = app.versionNumber;
  const appId = `${t.ownerName}/${ref.filename}`;

  const spec = await readAppDesignSpec(storage, appId);
  const evidencedBefore = (spec?.criteria ?? [])
    .filter(c => c.status === 'evidenced' && typeof c.evidencedVersion === 'number' && c.evidencedVersion < live)
    .map(c => ({ id: c.id, evidenced_version: c.evidencedVersion as number }));
  const counts = criteriaCounts(spec?.criteria);
  const dataMap = await readAppDataMap(storage, t.ownerGhii, appDataMapId(ref.filename));
  const skills = await boundSkillIssues(storage, config, t.ownerName, ref.filename);

  const behind: Array<{ item: string; what: string }> = [];
  if (!spec) behind.push({ item: 'design_spec', what: 'There is no design spec: write one with spec_set.' });
  else if (isDesignSpecStale(spec, live)) behind.push({ item: 'design_spec', what: `Written against version ${spec.version}; the app is at version ${live}. Read it, then confirm it (spec_set with confirm: true) or update it with spec_set.` });
  if (counts.open) behind.push({ item: 'criteria', what: `${counts.open} acceptance criteria are open: evidence them, or ask the owner to waive them, with criteria_set.` });
  if (evidencedBefore.length) behind.push({ item: 'criteria', what: `${evidencedBefore.length} criteria were evidenced at an earlier version (${evidencedBefore.map(c => `${c.id} at v${c.evidenced_version}`).join(', ')}): check that each still holds at version ${live}, and evidence it again or set it open.` });
  if (!dataMap) behind.push({ item: 'data_map', what: 'There is no data map: write one with aimeat_datamap_set, saying where each family of data lives and why.' });
  for (const s of skills) {
    if (s.tool_field_issues.length) behind.push({ item: 'bound_skill', what: `${s.ref} calls the app's tools with ${s.tool_field_issues.length} field(s) the tools refuse now (${s.tool_field_issues.slice(0, 3).map(i => `${i.tool}.${i.field}`).join(', ')}): correct the skill and publish it again.` });
  }

  return done({
    app: appId,
    app_version: live,
    design_spec: spec ? { present: true, version: spec.version, revision: spec.revision, stale: isDesignSpecStale(spec, live) } : { present: false },
    criteria: { ...counts, evidenced_before: evidencedBefore },
    data_map: { present: !!dataMap },
    bound_skills: skills,
    behind,
    meaning: behind.length
      ? `${behind.length} item(s) beside this app are behind version ${live}: ${behind.map(b => b.item.replace('_', ' ')).join(', ')}. Each says what to do.`
      : `Everything beside this app describes version ${live}.`,
  });
}
