/**
 * @file src/services/app-design-spec-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's design spec as operations: read it, write it, remove it. Each one holds
 *   the who-may test (inside the build: the owner, the owner's agents, any development-right rung,
 *   the same test the draft endpoints make; removal is the owner's alone), the refusals, the
 *   manifest stamp, the audit row and the change event its REST route held (GET, PUT and DELETE
 *   /v1/apps/:owner/:filename/design-spec in routes/apps/design-spec.ts), and answers an
 *   AppOpOutcome. The route and the aimeat_app_manage MCP tool (spec, spec_set, spec_clear) both
 *   call these.
 *
 *   The document store itself is services/app-design-spec.ts.
 * @structure readDesignSpecFor · writeDesignSpecFor · clearDesignSpecFor
 * @usage const out = await writeDesignSpecFor(storage, config, caller, { owner, filename }, req.body);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of the handlers of routes/apps/design-spec.ts by extraction;
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { localAccountName, resolveIdentity } from '../utils/gaii.js';
import { accountOf } from './app-members.js';
import { emitChange } from './event-bus.js';
import { recordAppAudit } from './app-audit.js';
import { resolveAppTarget } from './app-dev-grant.js';
import {
  APP_DESIGN_SPEC_TEMPLATE, checkDesignSpecMarkdown, deleteAppDesignSpec, designSpecMeaning, designSpecStamp,
  isDesignSpecStale, readAppDesignSpec, writeAppDesignSpec,
} from './app-design-spec.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome, type AppOpRefusal } from './app-op-outcome.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** The app an operation addresses: the `:owner` (`me` or empty for the caller's own) and `:filename`. */
interface SpecRef { owner: string; filename: string }

/**
 * The app this call names, in the bucket the caller may build in, or the refusal: a filename that
 * is not one, a right the caller does not hold (403, or 404 for an owner that does not exist), or an
 * app that is not there.
 */
async function specTarget(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: SpecRef,
): Promise<{ ok: true; app: AppRecord; appId: string; delegated: boolean } | AppOpRefusal> {
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
  return { ok: true, app, appId: `${app.ownerName}/${app.filename}`, delegated: !!t.delegated };
}

/** GET .../design-spec: the document, and whether the app has moved past it. */
export async function readDesignSpecFor(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: SpecRef): Promise<AppOpOutcome> {
  const found = await specTarget(storage, config, caller, ref);
  if (!found.ok) return found;
  const spec = await readAppDesignSpec(storage, found.appId);
  return done({
    app: found.appId,
    app_version: found.app.versionNumber,
    design_spec: spec,
    stale: isDesignSpecStale(spec, found.app.versionNumber),
    ...(spec ? {} : { template: APP_DESIGN_SPEC_TEMPLATE }),
    meaning: designSpecMeaning(spec, found.app.versionNumber),
  });
}

/**
 * PUT .../design-spec: write the whole document. A write that names `expected_revision` is
 * refused with 409 and the document that is there when another write came first.
 */
export async function writeDesignSpecFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: SpecRef, rawBody: unknown,
): Promise<AppOpOutcome> {
  const found = await specTarget(storage, config, caller, ref);
  if (!found.ok) return found;
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const checked = checkDesignSpecMarkdown(body.markdown);
  if (!checked.ok) return refuse(400, 'INVALID_INPUT', checked.message);
  const expected = body.expected_revision;
  if (expected !== undefined && expected !== null && (!Number.isInteger(expected) || (expected as number) < 0)) {
    return refuse(400, 'INVALID_INPUT', 'expected_revision is the revision you read, a whole number; omit it to replace whatever is there.');
  }
  const principal = resolveIdentity(caller, config.nodeId);
  const out = await writeAppDesignSpec(storage, {
    appId: found.appId, markdown: checked.markdown, by: accountOf(principal), principal,
    appVersion: found.app.versionNumber,
    ...(typeof expected === 'number' ? { expectedRevision: expected } : {}),
  });
  if ('conflict' in out) {
    return refuse(409, 'REVISION_MISMATCH',
      `The design spec is at revision ${out.conflict.revision}, not ${expected}. Read it again and write from that.`,
      { design_spec: out.conflict });
  }
  // The manifest's stamp follows every write, so a listing says when the spec was last written
  // without waiting for the next publish to copy it.
  await storage.updateAppMeta(found.app.ownerGaii, found.app.filename, { designSpec: designSpecStamp(out.spec) });
  await recordAppAudit(storage, {
    ownerGhii: found.app.ownerGaii, filename: found.app.filename, by: principal, action: 'design_spec.set',
    detail: { revision: out.spec.revision, version: out.spec.version, bytes: Buffer.byteLength(out.spec.markdown, 'utf8'), unchanged: out.unchanged },
  });
  emitChange('apps');
  return done({
    app: found.appId,
    app_version: found.app.versionNumber,
    design_spec: out.spec,
    stale: false,
    replaced_revision: out.replacedRevision,
    unchanged: out.unchanged,
    meaning: out.unchanged
      ? `The text is the one that was there; the spec is now marked current for version ${out.spec.version}.`
      : designSpecMeaning(out.spec, found.app.versionNumber),
  }, out.replacedRevision === null ? 201 : 200);
}

/** DELETE .../design-spec: the owner takes the document away. A builder with a right is refused. */
export async function clearDesignSpecFor(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: SpecRef): Promise<AppOpOutcome> {
  const found = await specTarget(storage, config, caller, ref);
  if (!found.ok) return found;
  if (found.delegated) {
    return refuse(403, 'FORBIDDEN', 'Only the app owner removes the design spec. Update it instead: write the document as it should read.');
  }
  const removed = await deleteAppDesignSpec(storage, found.appId);
  if (removed) {
    await storage.updateAppMeta(found.app.ownerGaii, found.app.filename, { designSpec: null });
    await recordAppAudit(storage, {
      ownerGhii: found.app.ownerGaii, filename: found.app.filename,
      by: resolveIdentity(caller, config.nodeId), action: 'design_spec.cleared',
    });
    emitChange('apps');
  }
  return done({ removed });
}
