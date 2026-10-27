/**
 * @file src/services/account-event-task-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every app grant that existed before it, held memory:read and did
 *   not hold task:read keeps reading the title and the decline reason of an agent's task in the
 *   account's event record (GET /v1/account/events, GET /v1/account/events/archive) and the home feed
 *   (GET /v1/home/feed).
 *
 *   WHY. secaudit 2026-10, v89 (services/account-event-view.ts) shows a task row's title and reason
 *   only to the readers the task route admits: the owner in person, an app grant holding task:read and
 *   the task's own agent. Until then an app grant read them on memory:read, and a published app's
 *   permissions change only when its author republishes it. The developer's ruling, 2026-10-22: an app
 *   grant that existed before this update, holding memory:read but not task:read, keeps seeing the
 *   titles and reasons as before; a grant made after the update needs task:read. Ecosystem apps and
 *   agents are not kept: the ruling covers apps only.
 *
 *   WHICH GRANTS. A live (not revoked) app grant made before the step began, of any account except
 *   anonymous mode's shared one (anyone may hold it), whose scopes cover memory:read
 *   (scopeIsCovered, so `*` and `memory:*` count) and do not cover task:read.
 *
 *   THE KEY. An app grant's token names the owner's GHII as its `sub` (routes/app-grants.ts
 *   issueAccessToken), so every app of one owner looks the same by principal. The token also carries
 *   `app_grant`, the grant's id, which a re-consent or a refresh keeps (services/app-grant-upsert.ts
 *   updates the one live row of an owner and an app). The record is keyed by that id. A grant revoked
 *   and given again is a new row with a new id, and follows the new rule.
 *
 *   WHAT IT KEEPS. Nothing is written onto a grant, because task:read also reads every task of every
 *   agent on the task route, which these grants never could. The record lists each kept grant with
 *   the scope list it held at the step, and the reader lets a kept grant through while its token still
 *   covers every word of that list (taskContentKept). A word the owner takes away (PATCH
 *   /v1/app-grants/:grantId) ends the keep at the next token; a word added keeps it.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (TASK_CONTENT_KEEP_KEY), on any version, claimed
 *   before the work (services/once-only-step.ts). Awaited before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts).
 * @structure TASK_CONTENT_KEEP_KEY · KeptTaskReader · keepTaskContentForAppGrantsOnce(storage, config, opts?) ·
 *   taskContentKept(storage, nodeId, auth) · accountEventReader(caller, auth, storage, nodeId)
 * @usage
 *   await keepTaskContentForAppGrantsOnce(storage, config, { existedBefore });     // boot
 *   const reader = await accountEventReader(callerOf(req, …), req.auth!, storage, config.nodeId); // the three reads
 * @version-history
 *   2026-10-27 — secaudit2026oct26: the cutoff is never later than the rule's first try (keptBefore).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89; the developer's ruling of 2026-10-22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { claimOnceOnlyStep, keptBefore } from './once-only-step.js';
import { isSharedAnonymous } from './rest-scope-gates-migration.js';
import type { CallerContext } from './caller-context.js';
import type { AccountEventReader } from './account-event-view.js';

/** The record under `system@<nodeId>` that lists the kept app grants. */
export const TASK_CONTENT_KEEP_KEY = 'migrations.account-event-task-content.keep';

/** The word a reader holds to see a task's content; the word it could already read the record with. */
const TASK_WORD = 'task:read';
const READ_WORD = 'memory:read';

/** One app grant the step kept, and the scope list it held then. */
export interface KeptTaskReader { grantId: string; owner: string; app: string; scopes: string[] }

export interface TaskContentKeepResult { ran: boolean; kept: KeptTaskReader[] }

/** Created before `cutoff`; a record without a readable time is taken as existing. */
function existed(createdAt: string | undefined, cutoff: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isNaN(t) || t < cutoff;
}

/**
 * List every live app grant made before the step that reads the record on memory:read without
 * task:read, once. Throws when the read or the record write fails, and then leaves no record, so the
 * next start tries again.
 */
export async function keepTaskContentForAppGrantsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, opts: { existedBefore?: string } = {},
): Promise<TaskContentKeepResult> {
  const result: TaskContentKeepResult = { ran: false, kept: [] };
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, TASK_CONTENT_KEEP_KEY);
  if (!claim) return result;
  const cutoff = keptBefore(claim, opts.existedBefore);   // never later than the rule's first try (secaudit2026oct26)
  try {
    for (const grant of await storage.listAppGrants()) {
      if (grant.revoked || !existed(grant.createdAt, cutoff) || isSharedAnonymous(grant.owner)) continue;
      const scopes = grant.scopes ?? [];
      if (!scopeIsCovered(scopes, READ_WORD) || scopeIsCovered(scopes, TASK_WORD)) continue;
      result.kept.push({ grantId: grant.grantId, owner: grant.owner, app: grant.app, scopes: [...scopes] });
    }
    await claim.finish({ at: new Date().toISOString(), word: TASK_WORD, grants: result.kept });
  } catch (err) {
    await claim.release();
    throw err;
  }
  result.ran = true;
  if (result.kept.length > 0) {
    logger.info(`Task content: ${result.kept.length} app grant(s) made before the update keep reading task titles and decline `
      + `reasons in the event record without ${TASK_WORD}`, { grants: result.kept.map(g => g.grantId) });
  }
  return result;
}

/** The token facts the keep reads: the roles, the scopes, the owner and the grant id of an app token. */
export interface TaskKeepAuth { roles: readonly string[]; scopes: readonly string[]; owner: string; app_grant?: string }

/**
 * True when `auth` is an app grant the step kept, of the same owner, and its token still covers every
 * word the grant held at the step. A read failure answers false, so the row is projected as it would
 * be without the keep.
 */
export async function taskContentKept(storage: Storage, nodeId: string, auth: TaskKeepAuth): Promise<boolean> {
  if (!auth.roles.includes('app') || auth.roles.includes('ecosystem') || typeof auth.app_grant !== 'string' || !auth.app_grant) return false;
  const rec = await storage.getMemory(`system@${nodeId}`, TASK_CONTENT_KEEP_KEY).catch((err: unknown) => {
    logger.warn('task content: the keep record could not be read; the row follows the task route\'s rule', { error: String(err) });
    return null;
  });
  const listed = (rec?.value as { grants?: unknown } | undefined)?.grants;
  if (!Array.isArray(listed)) return false;
  const kept = listed.find((g): g is KeptTaskReader => !!g && typeof g === 'object' && (g as KeptTaskReader).grantId === auth.app_grant);
  if (!kept || kept.owner !== auth.owner || !Array.isArray(kept.scopes)) return false;
  return kept.scopes.every(w => scopeIsCovered(auth.scopes, w));
}

/**
 * The reader the three reads project rows for: the caller, and for an app grant without task:read
 * whether the step kept it. Only that one kind of caller costs a record read.
 */
export async function accountEventReader(
  caller: CallerContext, auth: TaskKeepAuth, storage: Storage, nodeId: string,
): Promise<AccountEventReader> {
  const reader: AccountEventReader = { principal: caller.principal, kind: caller.kind, inPerson: caller.inPerson, has: caller.has };
  if (caller.kind !== 'app' || caller.has(TASK_WORD)) return reader;
  return { ...reader, taskContentKept: await taskContentKept(storage, nodeId, auth) };
}
