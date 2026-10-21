/**
 * @file src/services/app-on-done-keep-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every app published before it whose code starts an AI job with
 *   an `on_done` extension action, and whose sign-in does not ask for ext:invoke, keeps working: the
 *   word joins the app's allowance and its live grants.
 *
 *   WHY. secaudit 2026-10 (services/ai-jobs/service.ts, assertCallbackAllowed:on-done-asks-no-ext-invoke)
 *   made POST /v1/ai/jobs ask ext:invoke of a caller that is not the owner in person when `on_done`
 *   names an extension action, because that action then runs unattended in the owner's name, which
 *   costs ext:invoke on every other code path. An app grant holds the words its app's aimeat-scopes
 *   asks for and its owner cannot add one, so an app published before the change that binds on_done
 *   would have been refused from that day. The developer's rule for the round: every use that worked
 *   before keeps working, and the fix makes it safe without removing it.
 *
 *   WHICH APPS. The code reading of services/app-scope-needs.ts, rule 'ai-job-on-done' only: code
 *   that starts a job (AIMEAT.ai.job.start or a /v1/ai/jobs literal) and writes `on_done` as a
 *   property. An app that needs ext:invoke for another call and does not declare it gets nothing here:
 *   that call never worked without the word.
 *
 *   HOW. The same as services/app-storage-read-keep-migration.ts: services/app-scope-allowance.ts
 *   keepWorkingAppsOnce with `only: ['ext:invoke']` and `rules: ['ai-job-on-done']` (a word its owner
 *   removed is never put back), the owner's feed line, one incident on the operator's Security page.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (APP_ON_DONE_KEEP_KEY), on any version: the gate it
 *   answers is not tied to a release. An app published after the step gets the publish warning
 *   (services/app-artifact-lint.ts) and, at the start of a job, a refusal that tells its author what
 *   to declare (services/ai-jobs/starter.ts onDoneScopeRefusal).
 * @structure APP_ON_DONE_KEEP_KEY · keepOnDoneForAppsOnce(storage, config, opts?)
 * @usage
 *   await keepOnDoneForAppsOnce(storage, config, { existedBefore: before });
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { recordSecurityIncident } from './security-incident.js';
import { keepWorkingAppsOnce, type KeptApp } from './app-scope-allowance.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { tellAppOwners } from './rest-scope-keep-working-migration.js';
import { AI_JOB_ON_DONE_RULE } from './app-scope-needs.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const APP_ON_DONE_KEEP_KEY = 'migrations.secaudit-2026-10.app-allowance-ext-invoke-on-done';

const WORD = 'ext:invoke';

export interface OnDoneKeepResult {
  /** False on a node that ran it before: nothing was read or written. */
  ran: boolean;
  apps: KeptApp[];
}

/**
 * Give ext:invoke to every app published before `existedBefore` whose code binds an AI job's on_done
 * and whose sign-in does not ask for the word, tell each owner and the operator, and record the run.
 * Throws when a write fails, and then leaves no record, so the next start tries again.
 */
export async function keepOnDoneForAppsOnce(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
  opts: { existedBefore?: string } = {},
): Promise<OnDoneKeepResult> {
  const result: OnDoneKeepResult = { ran: false, apps: [] };
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, APP_ON_DONE_KEEP_KEY);
  if (!claim) return result;
  const cutoff = Date.parse(opts.existedBefore ?? new Date().toISOString());
  try {
    result.apps = await keepWorkingAppsOnce(storage, config, cutoff, {
      only: [WORD], rules: [AI_JOB_ON_DONE_RULE],
      reason: 'kept working: its code starts AI jobs with an on_done extension action, which asks ext:invoke since 2026-10-21',
    });
    if (result.apps.length) {
      await tellAppOwners(storage, config, result.apps, APP_ON_DONE_KEEP_KEY);
      await tellOperator(storage, config, result.apps);
    }
    await claim.finish({ at: new Date().toISOString(), apps: result.apps.map(a => ({ id: a.appId, words: a.words, grants: a.grants })) });
  } catch (err) {
    await claim.release();
    throw err;
  }
  result.ran = true;
  if (result.apps.length) {
    logger.info(`ext:invoke: ${result.apps.length} published app(s) that bind an AI job's on_done kept the word`,
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
    detail: `The node gave ext:invoke to ${apps.length} published app(s) of ${owners} owner(s): ${apps.map(a => a.appId).join(', ')}. `
      + 'Since 2026-10-21 an AI job whose on_done names an extension action is started by an app only with that word, because the '
      + 'action then runs unattended in the owner\'s name. These apps, published before it, start such jobs and do not ask for it. '
      + `${grants} live app grant(s) got the word. An app's owner removes it with aimeat_app_manage scope_allowance_remove, `
      + 'and the app\'s change log in the App Catalog says why it was kept.',
  });
}
