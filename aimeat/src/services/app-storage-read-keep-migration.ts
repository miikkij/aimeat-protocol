/**
 * @file src/services/app-storage-read-keep-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every app published before it whose code reads GET /v1/pub and
 *   whose sign-in does not ask for storage:read keeps that word, so its workspace images load again.
 *
 *   WHY. QA audit S3-03 (2026-10-16) made GET /v1/pub/:gaii/{key} ask storage:read of a signed-in
 *   caller that is not the account holder in person, for a file that is not public. The check is
 *   written inline in routes/storage-files.ts, and the 4.0.x keep-working step
 *   (services/rest-scope-keep-working-migration.ts) took its words only from requireRestScope gates
 *   and MCP tools, so no app kept storage:read. An app whose aimeat-scopes names other words and not
 *   storage:read got 403 SCOPE_DENIED on every workspace image, with nothing to say so. Found on
 *   originalmiskate.com on 2026-10-20 (OM Koti, 55 refusals in a day).
 *
 *   WHICH APPS. The same reading as the keep-working step (services/app-scope-needs.ts): a string
 *   literal that starts with /v1/pub, or the path written escaped in a regex, which is how an app that
 *   finds image addresses in a document holds it. An app without its own aimeat-scopes asks the
 *   default set, which has storage:read, and gets nothing. Ruled by Jouni on 2026-10-20: the scan, not
 *   every old app, because storage:read reads every file of the owner by key, the reach S3-03 closed.
 *
 *   HOW. services/app-scope-allowance.ts keepWorkingAppsOnce with `only: ['storage:read']`: the word
 *   joins the app's allowance (a word its owner removed is never put back) and every live grant of the
 *   app, and the app's change log says why. The owner gets the same feed line as the 4.0.x step, the
 *   operator one incident on the Security page.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (APP_STORAGE_READ_KEEP_KEY), on a node at
 *   REST_SCOPE_GATES_ENFORCED_IN or later. On a node that moves from 3.x now, the keep-working step
 *   before it already gives the word (storage:read is in its list), and this step finds nothing.
 * @structure APP_STORAGE_READ_KEEP_KEY · keepStorageReadForAppsOnce(storage, config, opts?)
 * @usage
 *   await keepStorageReadForAppsOnce(storage, config, { existedBefore: before });
 * @version-history
 *   2026-10-27 — secaudit2026oct26: the cutoff is never later than the rule's first try (keptBefore).
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../utils/rest-scope-release.js';
import { recordSecurityIncident } from './security-incident.js';
import { keepWorkingAppsOnce, type KeptApp } from './app-scope-allowance.js';
import { claimOnceOnlyStep, keptBefore } from './once-only-step.js';
import { tellAppOwners } from './rest-scope-keep-working-migration.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const APP_STORAGE_READ_KEEP_KEY = 'migrations.rest-scope-gates-4-0-x.app-allowance-storage-read';

const WORD = 'storage:read';

export interface StorageReadKeepResult {
  /** False before 4.0.0 and on a node that ran it before: nothing was read or written. */
  ran: boolean;
  apps: KeptApp[];
}

/**
 * Give storage:read to every app published before `existedBefore` whose code reads GET /v1/pub and
 * whose sign-in does not ask for it, tell each owner and the operator, and record the run. Throws when
 * a write fails, and then leaves no record, so the next start tries again.
 */
export async function keepStorageReadForAppsOnce(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
  opts: { version?: string; existedBefore?: string } = {},
): Promise<StorageReadKeepResult> {
  const result: StorageReadKeepResult = { ran: false, apps: [] };
  if (!versionAtLeast(opts.version ?? getSoftwareVersion(), REST_SCOPE_GATES_ENFORCED_IN)) return result;
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, APP_STORAGE_READ_KEEP_KEY);
  if (!claim) return result;
  const cutoff = keptBefore(claim, opts.existedBefore);   // never later than the rule's first try (secaudit2026oct26)
  try {
    result.apps = await keepWorkingAppsOnce(storage, config, cutoff, {
      only: [WORD],
      reason: 'kept working: its code reads files that are not public from /v1/pub, which asks storage:read since 2026-10-16',
    });
    if (result.apps.length) {
      await tellAppOwners(storage, config, result.apps, APP_STORAGE_READ_KEEP_KEY);
      await tellOperator(storage, config, result.apps);
    }
    await claim.finish({ at: new Date().toISOString(), apps: result.apps.map(a => ({ id: a.appId, words: a.words, grants: a.grants })) });
  } catch (err) {
    await claim.release();
    throw err;
  }
  result.ran = true;
  if (result.apps.length) {
    logger.info(`storage:read: ${result.apps.length} published app(s) that read /v1/pub kept the word`,
      { apps: result.apps.map(a => a.appId) });
  }
  return result;
}

/** One incident on the Security page with the apps, so the operator sees the whole node at once. */
async function tellOperator(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, apps: KeptApp[]): Promise<void> {
  const owners = new Set(apps.map(a => a.owner)).size;
  const grants = apps.reduce((n, a) => n + a.grants, 0);
  await recordSecurityIncident(storage, config, {
    type: 'scope_words_kept',
    code: 'SCOPE_WORDS_KEPT',
    actorGhii: `system@${config.nodeId}`,
    actorName: 'node',
    source: 'boot',
    detail: `The node gave storage:read to ${apps.length} published app(s) of ${owners} owner(s): ${apps.map(a => a.appId).join(', ')}. `
      + 'Since 2026-10-16 a signed-in app reads a file that is not public from /v1/pub only with that word, and these apps, '
      + 'published before it, read such files and do not ask for it, so their workspace images were refused. '
      + `${grants} live app grant(s) got the word. An app's owner removes it with aimeat_app_manage scope_allowance_remove, `
      + 'and the app\'s change log in the App Catalog says why it was kept.',
  });
}
