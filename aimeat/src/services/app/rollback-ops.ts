/**
 * @file src/services/app/rollback-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Put an earlier version of an app back in one call: POST
 *   /v1/apps/:owner/:filename/rollback and aimeat_app_manage { action: "rollback" } both call
 *   rollbackAppFor(). The old version's bytes are published again as a new version, so the history
 *   only grows and a rollback can itself be rolled back.
 *
 *   WHY. A release that broke an app was undone in two calls (seed a draft from the old version,
 *   publish the draft), and the second call passed today's owed-documents gate, so an app whose
 *   design spec went missing could not be rolled back until somebody wrote one. The paper this was
 *   asked from (Google, "The New SDLC With Vibe Coding", May 2026) expects a release that goes wrong
 *   to be rolled back by the pipeline; DORA counts how often that happens as the change-failure rate.
 *
 *   WHAT STILL HOLDS. The publish right (a builder of another account needs the publish rung), the
 *   package lock, and the byte checks: a version that would not publish today because of what is in
 *   its bytes (a key in the page, a script that does not parse) is refused, because publishing it
 *   again is a publish. What does NOT hold is the owed-documents gate (services/app/owed-gate.ts):
 *   those documents sit beside the app and do not change with its bytes, so the answer lists what the
 *   app owes and the rollback goes through. The catalogue name and description stay as they are; the
 *   display version is the restored version's own.
 *
 *   THE RECORD. Each rollback writes `version.rollback` to the app's audit log with the version it
 *   replaced, the version it put back, the new version number and the reason, which the caller must
 *   give. The audit answer counts them over 90 days beside the changes they undid (changeRecord in
 *   services/app/audit.ts).
 * @structure rollbackAppFor(storage, config, caller, ref, body)
 * @usage const out = await rollbackAppFor(storage, config, req.auth!, { owner, filename }, req.body);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-app-rollback-in-one-call-and-a-count-of-failed-changes-per-a).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName, resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { recordAppAudit } from './audit.js';
import { resolveAppTarget } from './dev-grant.js';
import { owedMissing } from './owed-gate.js';
import { readAppDesignSpec } from './design-spec.js';
import { publishApp } from './publish.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome } from './op-outcome.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
/** The longest reason a rollback records. */
const REASON_MAX = 400;

interface RollbackRef { owner: string; filename: string }

/** POST .../rollback { version, note }: publish version `version` again as the newest version. */
export async function rollbackAppFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: RollbackRef, body: unknown,
): Promise<AppOpOutcome> {
  if (!FILENAME_RE.test(ref.filename)) return refuse(400, 'INVALID_INPUT', 'Invalid filename.');
  const b = (body && typeof body === 'object' ? body : {}) as { version?: unknown; note?: unknown };
  const version = typeof b.version === 'number' ? b.version : Number.NaN;
  const reason = typeof b.note === 'string' ? b.note.trim() : '';
  if (!Number.isInteger(version) || version < 1) {
    return refuse(400, 'INVALID_INPUT', 'version is the published version number to put back (a whole number, from the versions list).');
  }
  if (!reason) return refuse(400, 'INVALID_INPUT', 'note says why the version is rolled back, in one line: it goes into the app\'s audit log.');
  if (reason.length > REASON_MAX) return refuse(400, 'INVALID_INPUT', `note is at most ${REASON_MAX} characters.`);

  const t = await resolveAppTarget(storage, config, {
    callerOwner: localAccountName(caller.owner),
    requestedOwner: ref.owner === 'me' ? '' : ref.owner,
    filename: ref.filename,
    act: 'publish',
  });
  if (!t.ok) return refuse(t.status, t.code, t.message);

  const latest = await storage.getLatestVersionNumber(t.ownerGhii, ref.filename);
  if (!latest) return refuse(404, 'NOT_FOUND', 'No such app.');
  if (version >= latest) {
    return refuse(400, 'INVALID_INPUT', `version ${version} is not earlier than the live version ${latest}: name an earlier one from the versions list.`);
  }
  const old = await storage.getApp(t.ownerGhii, ref.filename, version);
  if (!old) return refuse(404, 'VERSION_NOT_FOUND', `Version ${version} of ${ref.filename} is not kept any more; the versions list names the ones that are.`);
  const live = await storage.getApp(t.ownerGhii, ref.filename);
  if (live && Buffer.isBuffer(live.data) && live.data.equals(old.data)) {
    return refuse(409, 'ALREADY_LIVE', `The live version ${latest} already has the bytes of version ${version}; nothing was published.`);
  }

  const principal = resolveIdentity(caller, config.nodeId);
  const out = await publishApp(storage, config, {
    ownerName: t.ownerName,
    ownerGhii: t.ownerGhii,
    callerGaii: principal,
    filename: ref.filename,
    data: old.data,
    mimeType: old.mimeType,
    requested: { version: old.manifest.version || undefined },
    accessCode: { mode: 'carry' },
    source: 'rollback',
    publishGate: null,
    roadmap: `Rolled back to version ${version}: ${reason}`,
  });
  if ('refusal' in out) return refuse(out.refusal.status, out.refusal.code, out.refusal.message, out.refusal.details);

  await recordAppAudit(storage, {
    ownerGhii: t.ownerGhii, filename: ref.filename, by: principal, action: 'version.rollback',
    detail: { from: latest, to: version, new_version: out.versionNumber, reason },
  });
  emitChange('apps');

  // What the app owes beside its bytes: named, never refused (see the file header).
  const html = /html/i.test(old.mimeType) ? old.data.toString('utf8') : '';
  const owes = html
    ? await owedMissing(storage, config, {
      ownerName: t.ownerName, ownerGhii: t.ownerGhii, filename: ref.filename, html,
      hasDesignSpec: !!await readAppDesignSpec(storage, `${t.ownerName}/${ref.filename}`), roadmapLine: 'rollback',
    })
    : [];

  return done({
    filename: ref.filename,
    rolled_back_to: version,
    replaced_version: latest,
    version_number: out.versionNumber,
    version: out.manifest.version,
    reason,
    url: out.downloadUrl,
    owes: owes.map(o => ({ item: o.item, how: o.how })),
    app_hints: out.artifactWarnings,
    meaning: `Version ${version} is live again as version ${out.versionNumber}; version ${latest} stays in the history and can be put back the same way.`
      + (owes.length ? ` The app still owes ${owes.map(o => o.item.replace('_', ' ')).join(', ')}: the next ordinary publish is refused until it has them.` : ''),
  }, 201);
}
