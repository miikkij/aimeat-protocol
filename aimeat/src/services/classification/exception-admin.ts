/**
 * @file src/services/classification/exception-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Making, reading and withdrawing a classification exception (TARGET-082, decided by
 *   Jouni 2026-09-30). REST and MCP call these functions, so who may do what is decided once; the
 *   list itself is exceptions.ts.
 *
 *   MAKE: a person in their own session, or an app, lets one item leave ('leave', any destination) or
 *   lets an AI send it out ('ai-send') despite its classification, with a written reason and an
 *   optional expiry. Not an AI: "jos ... tekoäly tekee päätöksen lähettää tietoa jonnekin ulospäin
 *   ... siitä pitäisi antaa kuitenkin käyttäjälle mahdollisuus tehdä poikkeus", so the exception is
 *   the person's to make, and an agent, an ecosystem app or a personal access token is refused with
 *   PERSON_REQUIRED. Whoever makes one must be allowed to change the item's label and be inside the
 *   audience of the label it carries (labels.ts labelForException).
 *   READ: the same authorization as the audit log (policy-admin.ts auditSubjectFor): level owner is
 *   the caller's owner's content, organism is its creator's or an admin's, node is the operator's
 *   and lists the whole node.
 *   WITHDRAW: the principal who made it, or the level's person (the owner for their own content, an
 *   organism's creator or admin, the node's operator). A withdrawn exception stays on the list.
 * @structure PERSON_MAKES_EXCEPTION · ExceptionRequest · makeException() · readExceptions() ·
 *   removeException()
 * @usage const e = await makeException(deps, actor, { key, action: 'leave', reason });
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (Jouni's decisions of 2026-09-30).
 */
import {
  ClassificationError, isAppActor, isOwnerPerson, labelForException, targetOf,
  type ClassificationDeps, type LabelActor, type TargetInput,
} from './labels.js';
import { auditSubjectFor } from './policy-admin.js';
import type { PolicyLevel } from './policy.js';
import {
  addException, EXCEPTION_ACTIONS, ExceptionError, findException, levelOfScope, listExceptions, PERSON_EXCEPTION_ACTIONS,
  withdrawException,
  type ClassificationException,
} from './exceptions.js';

/** What an AI is told when it tries to make an exception. */
export const PERSON_MAKES_EXCEPTION = 'An exception is the person\'s decision: they make it signed in themselves, in their Data Wallet, with a written reason. An AI cannot make one. Tell the person what you wanted to send and why.';

export interface ExceptionRequest extends TargetInput {
  action?: unknown;
  reason?: unknown;
  until?: unknown;
}

/** Run a list operation, turning its own error into the classification one the surfaces map. */
async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (err) {
    if (err instanceof ExceptionError) throw new ClassificationError(err.code, err.status, err.message);
    throw err;
  }
}

const nowOf = (deps: ClassificationDeps) => (deps.now ?? (() => new Date().toISOString()))();

/** A person or an app makes an exception for one item. */
export async function makeException(deps: ClassificationDeps, actor: LabelActor, input: ExceptionRequest): Promise<ClassificationException> {
  const app = isAppActor(actor);
  if (!app && !isOwnerPerson(actor)) throw new ClassificationError('PERSON_REQUIRED', 403, PERSON_MAKES_EXCEPTION);
  const action = input.action as ClassificationException['action'];
  if (!PERSON_EXCEPTION_ACTIONS.includes(action)) {
    throw new ClassificationError('INVALID_INPUT', 400, 'action is leave (the item may leave despite its classification) or ai-send (an AI may send it out).');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new ClassificationError('INVALID_INPUT', 400, 'reason is required: why this item may go out despite its classification.');
  if (reason.length > 1000) throw new ClassificationError('INVALID_INPUT', 400, 'reason is at most 1000 characters.');
  let until: string | null = null;
  if (input.until !== undefined && input.until !== null && input.until !== '') {
    const d = typeof input.until === 'string' ? new Date(input.until) : new Date(NaN);
    if (Number.isNaN(d.getTime())) throw new ClassificationError('INVALID_INPUT', 400, 'until is an ISO date and time.');
    until = d.toISOString();
    if (until <= nowOf(deps)) throw new ClassificationError('INVALID_INPUT', 400, 'until is in the future.');
  }
  // Refuse before writing: the target is named and checked first.
  const { target, label } = await labelForException(deps, actor, targetOf(actor, input));
  return mapped(() => addException(deps, {
    by: actor.principal, byKind: app ? 'app' : 'human', app: actor.app ?? null, scope: target.scope,
    target: { kind: target.kind, key: target.key }, label, action, reason, auto: false, until,
  }));
}

/** The exceptions list of a level, newest first. Level node is the whole node. */
export async function readExceptions(
  deps: ClassificationDeps, actor: LabelActor, level: PolicyLevel, organismId: string | null | undefined,
  filter: { action?: string; since?: string; limit?: number } = {},
): Promise<{ level: PolicyLevel; subject: string; exceptions: ClassificationException[] }> {
  const subject = await auditSubjectFor(deps, actor, level, organismId);
  if (filter.action !== undefined && !EXCEPTION_ACTIONS.includes(filter.action as ClassificationException['action'])) {
    throw new ClassificationError('INVALID_INPUT', 400, `action is one of: ${EXCEPTION_ACTIONS.join(', ')}.`);
  }
  if (filter.since !== undefined && Number.isNaN(new Date(filter.since).getTime())) {
    throw new ClassificationError('INVALID_INPUT', 400, 'since is an ISO date and time.');
  }
  const exceptions = await listExceptions(deps, {
    level: level === 'node' ? 'all' : level, subject, action: filter.action, since: filter.since, limit: filter.limit,
  });
  return { level, subject, exceptions };
}

/** Does the authorization check pass? Its refusal is a no; any other failure goes to the caller. */
async function allowed(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err) {
    if (err instanceof ClassificationError) return false;
    throw err;
  }
}

/** Withdraw an exception. Anyone else is told it does not exist. */
export async function removeException(deps: ClassificationDeps, actor: LabelActor, id: string): Promise<ClassificationException> {
  const app = isAppActor(actor);
  if (!app && !isOwnerPerson(actor)) throw new ClassificationError('PERSON_REQUIRED', 403, 'A person withdraws an exception, signed in themselves, in their Data Wallet.');
  const e = await findException(deps, id, { level: 'owner', subject: actor.ownerGhii });
  const notFound = new ClassificationError('NOT_FOUND', 404, 'No such exception, or it is not yours to withdraw.');
  if (!e) throw notFound;
  const { level, subject } = levelOfScope(e.scope);
  const person = !app;
  const mayWithdraw = e.by === actor.principal
    || (person && level === 'owner' && subject === actor.ownerGhii)
    || (person && level === 'organism' && await allowed(() => auditSubjectFor(deps, actor, 'organism', subject)))
    || (person && await allowed(() => auditSubjectFor(deps, actor, 'node', null)));
  if (!mayWithdraw) throw notFound;
  return mapped(() => withdrawException(deps, level, subject, id, actor.principal));
}
