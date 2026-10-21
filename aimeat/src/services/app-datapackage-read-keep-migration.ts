/**
 * @file src/services/app-datapackage-read-keep-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every app published before it whose code reads data packages,
 *   and whose sign-in does not ask for storage:read, keeps reading its owner's private packages: the
 *   word joins the app's allowance and its live grants.
 *
 *   WHY. secaudit 2026-10 v41 (services/datapackage/audience.ts) made a principal of the owner other
 *   than the owner in person read the owner's PRIVATE data package only with storage:read, the word
 *   GET /v1/datapackages and /v1/pub ask for the same bytes. Before, any token carrying the owner's
 *   name read every row. An app grant holds the words its app's aimeat-scopes asks for and its owner
 *   cannot add one, so an app published before the change that reads its owner's private packages,
 *   and declares its scopes without storage:read, would have been refused from that day. The
 *   developer's rule for the round: every use that worked before keeps working, and the fix makes it
 *   safe without removing it.
 *
 *   WHICH APPS. The code reading of services/app-scope-needs.ts, rule 'datapackage-read' only:
 *   AIMEAT.datapackage.open, rows, versions, exportAs or list, or a /v1/datapackages/... or
 *   /v1/odata/... literal. An app on the default set already has storage:read and gets nothing. An
 *   app that needs storage:read only for another call gets nothing here.
 *
 *   HOW. The same as services/app-on-done-keep-migration.ts: services/app-scope-allowance.ts
 *   keepWorkingAppsOnce with `only: ['storage:read']` and `rules: ['datapackage-read']` (a word its
 *   owner removed is never put back), the owner's feed line, one incident on the operator's Security
 *   page.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (APP_DATAPACKAGE_READ_KEEP_KEY), on any version: the
 *   gate it answers is not tied to a release. It runs before the /v1/pub step
 *   (services/app-storage-read-keep-migration.ts), so on a node where neither has run an app that
 *   reads packages is told the right reason. An app published after the step gets the publish warning
 *   (services/app-artifact-lint.ts) naming storage:read.
 * @structure APP_DATAPACKAGE_READ_KEEP_KEY · keepDatapackageReadForAppsOnce(storage, config, opts?)
 * @usage
 *   await keepDatapackageReadForAppsOnce(storage, config, { existedBefore: before });
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10 v41, capability-loss review).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { recordSecurityIncident } from './security-incident.js';
import { keepWorkingAppsOnce, type KeptApp } from './app-scope-allowance.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { tellAppOwners } from './rest-scope-keep-working-migration.js';
import { DATAPACKAGE_READ_RULE } from './app-scope-needs.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const APP_DATAPACKAGE_READ_KEEP_KEY = 'migrations.secaudit-2026-10.app-allowance-storage-read-datapackage';

const WORD = 'storage:read';

export interface DatapackageReadKeepResult {
  /** False on a node that ran it before: nothing was read or written. */
  ran: boolean;
  apps: KeptApp[];
}

/**
 * Give storage:read to every app published before `existedBefore` whose code reads data packages and
 * whose sign-in does not ask for the word, tell each owner and the operator, and record the run.
 * Throws when a write fails, and then leaves no record, so the next start tries again.
 */
export async function keepDatapackageReadForAppsOnce(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
  opts: { existedBefore?: string } = {},
): Promise<DatapackageReadKeepResult> {
  const result: DatapackageReadKeepResult = { ran: false, apps: [] };
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, APP_DATAPACKAGE_READ_KEEP_KEY);
  if (!claim) return result;
  const cutoff = Date.parse(opts.existedBefore ?? new Date().toISOString());
  try {
    result.apps = await keepWorkingAppsOnce(storage, config, cutoff, {
      only: [WORD], rules: [DATAPACKAGE_READ_RULE],
      reason: 'kept working: its code reads data packages, and its owner\'s private packages ask storage:read of an app since 2026-10-21',
    });
    if (result.apps.length) {
      await tellAppOwners(storage, config, result.apps, APP_DATAPACKAGE_READ_KEEP_KEY);
      await tellOperator(storage, config, result.apps);
    }
    await claim.finish({ at: new Date().toISOString(), apps: result.apps.map(a => ({ id: a.appId, words: a.words, grants: a.grants })) });
  } catch (err) {
    await claim.release();
    throw err;
  }
  result.ran = true;
  if (result.apps.length) {
    logger.info(`storage:read: ${result.apps.length} published app(s) that read data packages kept the word`,
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
      + 'Since 2026-10-21 an app reads its owner\'s private data packages only with that word. These apps, published before it, '
      + 'read data packages and do not ask for it. '
      + `${grants} live app grant(s) got the word. An app's owner removes it with aimeat_app_manage scope_allowance_remove, `
      + 'and the app\'s change log in the App Catalog says why it was kept.',
  });
}
