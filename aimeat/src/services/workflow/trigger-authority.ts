/**
 * @file src/services/workflow/trigger-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A run the workflow's own trigger starts, and the principal it answers to.
 *
 *   Nobody sits at the screen when a schedule fires or an event matches, so the run acts on the
 *   authority of whoever saved the workflow. The save checked that principal's words
 *   (step-authority.ts). This asks again at every start, because the owner can narrow an agent,
 *   revoke an app or delete an agent at any time after the save, and a run that went on acting on
 *   words its saver no longer holds would outlive the owner's decision.
 *
 *   When the saver is gone, or lacks a word a step needs, the run does not start. The refusal is a
 *   run record with status `refused`, so the owner reads it where they read every other run: the
 *   Workflows page, and in chat. It is ONE record and ONE notification until the workflow runs
 *   again, however often the trigger fires meanwhile, because an hourly schedule must fill neither
 *   the owner's memory nor their bell. The notification carries two ways on: "Run as me" starts this
 *   run once on the owner's own authority, and "Approve again" opens the saver's permissions.
 *
 *   The owner in person as saver is not checked, as no door checks them. A definition saved before
 *   2026-09-25 carries no savedBy, and its first author stands in.
 *
 *   "Run as me" is bound to the definition the refusal pinned (`defSnapshot`). The owner approves one
 *   object, not a workflow id, so a save that replaced the definition after the refusal is refused
 *   with DEFINITION_CHANGED and nothing starts.
 *
 *   A run already going is asked again before every step it dispatches (dispatch-authority.ts). A run
 *   refused that way is opened here as the workflow's refusal, with the same notification naming the
 *   step that did not start (openInFlightRefusal).
 * @structure saverOfDef(def) · saverAuthority(storage, saver) · refuseTriggerStart(deps, ownerGhii, def) ·
 *   openInFlightRefusal(deps, ownerGhii, run, now, missing, stepId) ·
 *   clearRefusal(storage, nodeId, ownerGhii, workflowId) · runRefusedAsOwner(deps, start, …)
 * @usage
 *   const refused = await refuseTriggerStart({ storage, config }, ownerGhii, def);
 *   if (refused) return { runId: refused.runId, skipped: true, refused: refused.reason };
 * @version-history
 *   v1.5.0 -- 2026-10-25 -- refuseTriggerStart skips the start for a deactivated account, whoever saved
 *     the workflow, with a log sentence and no refusal record (secaudit2026oct22,
 *     owner-deactivation:background-work-keeps-acting).
 *   v1.4.0 — 2026-10-20 — openInFlightRefusal: a run refused before a step is dispatched becomes the
 *     workflow's open refusal and the owner is told once, with "Run as me" and "Approve again" and the
 *     step named (secaudit 2026-10, v64).
 *   v1.3.0 — 2026-10-20 — runRefusedAsOwner compares the current definition with the one the refusal
 *     pinned and answers DEFINITION_CHANGED when they differ, starting nothing: the press started the
 *     CURRENT definition by id, so a save by another principal after the refusal spent the owner's
 *     one-press approval on a definition they were never shown, as the owner in person and with no
 *     step-permission check (secaudit 2026-10, wf-run-as-owner-not-bound-to-refused-snapshot).
 *   v1.2.0 — 2026-10-18 — The open-refusal list is written on its version (editOpen over record-cas.ts
 *     updateRecord), since the lock holds within one process only (atomic-write round).
 *   v1.1.1 — 2026-09-26 — An agent saver's account comes from localAccountOf, so a saver of another
 *     node never has its tokens looked up under the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-09-26 — "Run as me" and "Approve again" carry their own locale keys, so the bell and
 *     the Notifications page say them in the reader's language.
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { isGEAI, parseGaiiLoose, localAccountOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { notify, type NotifAction } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { runKey, getWorkflow } from './store.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { loc } from './engine-util.js';
import { missingStepScopes } from './step-authority.js';
import { deactivatedAccountSkip } from '../account-deactivated.js';
import type { WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowSaver } from '../../models/workflow-schemas.js';

export interface TriggerAuthorityDeps { storage: Storage; config: AimeatConfig }

/**
 * The principal a trigger's run answers to: whoever saved the definition last, or, for one saved
 * before 2026-09-25, its first author. A name with no `#` is the owner's own GHII.
 */
export function saverOfDef(def: Pick<WorkflowDef, 'savedBy' | 'createdBy'>): WorkflowSaver {
  if (def.savedBy?.kind) return def.savedBy;
  const id = def.createdBy ?? '';
  if (isGEAI(id)) return { kind: 'ecosystem', id };
  if (id.includes('#')) return { kind: 'agent', id };
  return { kind: 'owner', id };
}

/** Who the saver is now: its name, whether it is still there, its words, and where they are approved. */
export interface SaverNow { name: string; gone: boolean; scopes: string[]; approveLink: string }

/**
 * The saver as the node holds it today. An agent's words are its record's, which is what the owner
 * edits; a scoped access token has no agent record and is found among the owner's live tokens; an
 * ecosystem app counts while approved; a hosted app while its grant is not revoked.
 */
export async function saverAuthority(storage: Storage, saver: WorkflowSaver): Promise<SaverNow> {
  if (saver.kind === 'agent') {
    const name = parseGaiiLoose(saver.id).agent;
    // The account whose tokens are searched: this node's, never the namesake of another node's saver.
    const owner = saver.id.includes('@') ? localAccountOf(saver.id) : null;
    const record = saver.id ? await storage.getAgent(saver.id) : null;
    if (record) {
      return { name: record.name, gone: false, scopes: record.defaultScopes ?? [], approveLink: `/v1/profile?tab=agents&agent=${encodeURIComponent(record.name)}` };
    }
    const pat = owner
      ? (await storage.listPats(owner)).find(p => p.gaii === saver.id && !p.revoked && (!p.expiresAt || Date.parse(p.expiresAt) > Date.now()))
      : undefined;
    if (pat) return { name: pat.label || name, gone: false, scopes: pat.scopes, approveLink: '/v1/profile?tab=access' };
    return { name: name || saver.id, gone: true, scopes: [], approveLink: '/v1/profile?tab=agents' };
  }
  if (saver.kind === 'ecosystem') {
    const app = saver.id ? await storage.getEcosystemApp(saver.id) : null;
    const live = !!app && (app.status === 'approved' || app.status === 'active');
    return {
      name: app?.displayName || app?.app || parseGaiiLoose(saver.id).agent || saver.id,
      gone: !live, scopes: live ? app!.scopes : [], approveLink: '/v1/profile?tab=ecosystem',
    };
  }
  if (saver.kind === 'app') {
    const grant = saver.id ? await storage.getAppGrant(saver.id) : null;
    const live = !!grant && !grant.revoked;
    return { name: grant?.appName || grant?.app || saver.id, gone: !live, scopes: live ? grant!.scopes : [], approveLink: '/v1/profile?tab=access' };
  }
  return { name: saver.id, gone: false, scopes: [], approveLink: '/v1/profile?tab=workflows' };
}

// ── the open refusals: one per workflow until it runs again ─────────────────────────────────────
// Under system@{nodeId}, which no account can register, beside the active-run index, so no principal
// can clear a refusal to have the next one notify again, or plant one to keep the owner from hearing.
const OPEN_KEY = 'workflows.refused';
interface OpenRefusal { ownerGhii: string; workflowId: string; runId: string }

const locks = new Map<string, Promise<void>>();
/** One decision at a time per key: two trigger fires at once make one record and one notification. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const chained = prev.then(() => gate);
  locks.set(key, chained);
  await prev;
  try { return await fn(); } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

async function readOpen(storage: Storage, nodeId: string): Promise<OpenRefusal[]> {
  const value = (await storage.getMemory(`system@${nodeId}`, OPEN_KEY))?.value;
  return Array.isArray(value) ? value as OpenRefusal[] : [];
}

/**
 * Rewrite the list of open refusals, one read-modify-write at a time across every workflow. The lock
 * holds within one process; the write is on the list's version (record-cas.ts updateRecord), so an
 * edit from another node process at the same moment is applied to rather than written over.
 */
async function editOpen(storage: Storage, nodeId: string, edit: (entries: OpenRefusal[]) => OpenRefusal[] | null): Promise<void> {
  await withLock(OPEN_KEY, async () => {
    await updateRecord<OpenRefusal[]>(storage, `system@${nodeId}`, OPEN_KEY,
      (v) => (Array.isArray(v) ? v as OpenRefusal[] : []),
      (entries) => edit(entries) ?? UNCHANGED,
      { tag: 'workflow-index' });
  });
}

/** The workflow ran again, or is gone: the next refusal is a new one, and the owner hears of it. */
export async function clearRefusal(storage: Storage, nodeId: string, ownerGhii: string, workflowId: string): Promise<void> {
  if (!(await readOpen(storage, nodeId)).some(e => e.ownerGhii === ownerGhii && e.workflowId === workflowId)) return;
  await editOpen(storage, nodeId, entries => entries.filter(e => !(e.ownerGhii === ownerGhii && e.workflowId === workflowId)));
}

async function writeRun(storage: Storage, ownerGhii: string, run: WorkflowRun, version: number, createdAt: string): Promise<void> {
  await storage.setMemory({
    key: runKey(run.workflowId, run.runId), ownerGaii: ownerGhii, value: run, visibility: 'private',
    tags: ['workflow-run'], ttlHours: null, version, createdAt, updatedAt: new Date().toISOString(),
  });
}

/** What the run record says, in words: who saved it, what they lack, and the three ways on. */
function refusalReason(saverName: string, missing: string[], gone: boolean): string {
  const yourself = 'save the workflow yourself so its trigger runs on your own permission';
  return gone
    ? `Not started: this workflow was saved by ${saverName}, which is no longer connected to this account. Run it once as yourself, or ${yourself}.`
    : `Not started: this workflow was saved by ${saverName}, which no longer holds ${missing.map(w => `"${w}"`).join(', ')}. `
      + `Run it once as yourself, give ${saverName} the permission again, or ${yourself}.`;
}

/**
 * May the trigger start this run? Null when it may. Otherwise the refusal is recorded (or counted on
 * the one already open) and the owner is told the first time; the answer is that record's id and
 * reason, which is what the caller reports instead of a run.
 *
 * A deactivated account's trigger starts nothing, whoever saved the workflow: the start is skipped
 * with a log sentence that names the deactivation, no refusal record is written and the owner is not
 * told (they cannot sign in), and `runId` is empty. Reactivation lets the next event start it
 * (services/account-deactivated.ts; secaudit2026oct22).
 */
export async function refuseTriggerStart(
  deps: TriggerAuthorityDeps, ownerGhii: string, def: WorkflowDef,
): Promise<{ runId: string; reason: string } | null> {
  const paused = await deactivatedAccountSkip(deps.storage, ownerGhii);
  if (paused) {
    logger.info(`workflow "${def.id}": the trigger's start is skipped. ${paused}`);
    return { runId: '', reason: paused };
  }
  const saver = saverOfDef(def);
  if (saver.kind === 'owner') return null;
  const now = await saverAuthority(deps.storage, saver);
  const missing = now.gone ? [] : missingStepScopes(def, { roles: [saver.kind === 'app' ? 'app' : 'agent'], scopes: now.scopes }, 'full').map(m => m.scope);
  if (!now.gone && missing.length === 0) return null;
  return withLock(`${ownerGhii}|${def.id}`, () => recordRefusal(deps, ownerGhii, def, saver, now, missing));
}

async function recordRefusal(
  deps: TriggerAuthorityDeps, ownerGhii: string, def: WorkflowDef, saver: WorkflowSaver, now: SaverNow, missing: string[],
): Promise<{ runId: string; reason: string }> {
  const { storage, config } = deps;
  const at = new Date().toISOString();
  const reason = refusalReason(now.name, missing, now.gone);
  const open = (await readOpen(storage, config.nodeId)).find(e => e.ownerGhii === ownerGhii && e.workflowId === def.id);
  if (open) {
    const rec = await storage.getMemory(ownerGhii, runKey(def.id, open.runId));
    const run = rec?.value as WorkflowRun | undefined;
    if (rec && run?.status === 'refused' && run.refusal && !run.refusal.ranAsOwner) {
      run.refusal = { ...run.refusal, saver, saverName: now.name, missing, gone: now.gone, attempts: run.refusal.attempts + 1, lastAttemptAt: at };
      run.reason = reason;
      await writeRun(storage, ownerGhii, run, rec.version + 1, rec.createdAt);
      emitChange('workflows');
      logger.info(`workflow "${def.id}": the trigger's start was refused again (${run.refusal.attempts} times since ${run.startedAt})`);
      return { runId: run.runId, reason };
    }
  }
  const steps: Record<string, WorkflowRunStep> = {};
  for (const s of def.steps) steps[s.id] = { state: 'skipped', attempt: 0, reads: [], writes: [], endedAt: at };
  const run: WorkflowRun = {
    runId: randomUUID(), workflowId: def.id, defSnapshot: def, resolved: [], vars: {},
    mode: 'full-live', keyPrefix: '', status: 'refused', steps, startedAt: at, endedAt: at, reason,
    refusal: { saver, saverName: now.name, missing, gone: now.gone, attempts: 1, lastAttemptAt: at },
  };
  await writeRun(storage, ownerGhii, run, 1, at);
  await editOpen(storage, config.nodeId, entries => [
    ...entries.filter(e => !(e.ownerGhii === ownerGhii && e.workflowId === def.id)),
    { ownerGhii, workflowId: def.id, runId: run.runId },
  ]);
  emitChange('workflows');
  logger.warn(`workflow "${def.id}": the trigger's start was refused: ${reason}`);
  await tellOwner(storage, ownerGhii, def, run.runId, now, missing);
  return { runId: run.runId, reason };
}

/** The owner's two ways on from a refusal: start it once as themself, or approve the permissions again. */
function refusalActions(def: WorkflowDef, runId: string, now: SaverNow): NotifAction[] {
  return [
    {
      id: 'run-as-me', label: 'Run as me', kind: 'api', method: 'POST', style: 'primary',
      endpoint: `/v1/workflows/${encodeURIComponent(def.id)}/runs/${encodeURIComponent(runId)}/run-as-owner`,
      i18n: { key: 'workflow_run_refused.run_as_me' },
    },
    { id: 'approve-again', label: 'Approve again', kind: 'navigate', link: now.approveLink, i18n: { key: 'workflow_run_refused.approve_again' } },
  ];
}

/**
 * A run refused in flight (dispatch-authority.ts): its record is already saved as `refused`. It
 * becomes the workflow's open refusal, so a trigger start refused next counts on it rather than
 * telling the owner a second time, and the owner is told once, naming the step that did not start.
 */
export async function openInFlightRefusal(
  deps: TriggerAuthorityDeps, ownerGhii: string, run: WorkflowRun, now: SaverNow, missing: string[], stepId: string,
): Promise<void> {
  await editOpen(deps.storage, deps.config.nodeId, entries => [
    ...entries.filter(e => !(e.ownerGhii === ownerGhii && e.workflowId === run.workflowId)),
    { ownerGhii, workflowId: run.workflowId, runId: run.runId },
  ]);
  emitChange('workflows');
  await tellOwner(deps.storage, ownerGhii, run.defSnapshot, run.runId, now, missing, stepId);
}

/**
 * The one notification of a refusal episode, with the owner's two ways on. `stoppedBefore` names the
 * step a run refused in flight did not start; absent, the run did not start at all.
 */
async function tellOwner(storage: Storage, ownerGhii: string, def: WorkflowDef, runId: string, now: SaverNow, missing: string[], stoppedBefore?: string): Promise<void> {
  const name = loc(def.title) || def.id;
  const words = missing.join(', ');
  if (stoppedBefore !== undefined) {
    await notify(storage, ownerGhii, {
      type: 'workflow_run_refused',
      title: `Workflow "${name}" stopped before step ${stoppedBefore}`,
      body: now.gone
        ? `The run acts for ${now.name}, which is no longer connected to your account. Run it once as yourself, or save the workflow again yourself.`
        : `The run acts for ${now.name}, which no longer holds every permission the step needs: ${words}. Run it once as yourself, or approve the permissions again.`,
      link: '/v1/profile?tab=workflows',
      actions: refusalActions(def, runId, now),
      i18n: { key: now.gone ? 'workflow_run_stopped_gone' : 'workflow_run_stopped', vars: { name, saver: now.name, missing: words, step: stoppedBefore } },
    });
    return;
  }
  const actions = refusalActions(def, runId, now);
  await notify(storage, ownerGhii, {
    type: 'workflow_run_refused',
    title: `Workflow "${name}" did not start`,
    body: now.gone
      ? `${now.name} saved it and is no longer connected to your account. Run it once as yourself, or save the workflow again yourself.`
      : `${now.name} saved it and no longer holds every permission its steps need: ${words}. Run it once as yourself, or approve the permissions again.`,
    link: '/v1/profile?tab=workflows',
    actions,
    i18n: { key: now.gone ? 'workflow_run_refused_gone' : 'workflow_run_refused', vars: { name, saver: now.name, missing: words } },
  });
}

/** What the engine's start answers, as far as "Run as me" needs it. */
export type StartAsOwner = (ownerGhii: string, ownerName: string, workflowId: string) => Promise<
  { runId: string; skipped: boolean; refused?: string } | { error: string[] }>;

export type RunAsOwnerResult =
  | { ok: true; runId: string }
  | {
    ok: false;
    code: 'NOT_FOUND' | 'NOT_REFUSED' | 'ALREADY_STARTED' | 'SKIPPED' | 'START_FAILED' | 'DEFINITION_CHANGED';
    message: string; runId?: string; errors?: string[];
  };

/**
 * The definition as one comparable string, without the two fields a save sets on its own. Two saves
 * of the same content compare equal; a change to a step, a trigger, a variable, a flag or the saver
 * does not. Both sides come from the same stored shape, so the field order is the same.
 */
function definitionFingerprint(def: WorkflowDef): string {
  const rest: Partial<WorkflowDef> = { ...def };
  delete rest.updatedAt;
  delete rest.createdAt;
  return JSON.stringify(rest);
}

/** What the owner is told when the definition under this id is no longer the one they were shown. */
const CHANGED = 'This workflow was saved again after the run was refused, so the definition on this node is not the one '
  + 'this refusal shows. Nothing was started. Read the workflow and start it with "Run" when it is what you want.';
const GONE = 'This workflow was deleted after the run was refused, so there is nothing to start.';

/**
 * "Run as me": start the refused run once, on the owner's own authority. The door is the owner's
 * (requireOwnerPrincipal), `start` passes the owner in person as the caller, and the refusal keeps the
 * run it led to, so a second press starts nothing.
 *
 * The approval is bound to the definition the refusal pinned. `start` works by workflow id and loads
 * the CURRENT definition, so a save by another principal between the refusal and the press would run
 * steps the owner never read, as the owner in person and with no step-permission check. The
 * definitions are compared first, and a difference refuses the press.
 */
export async function runRefusedAsOwner(
  deps: TriggerAuthorityDeps, start: StartAsOwner, ownerGhii: string, ownerName: string, workflowId: string, refusedRunId: string,
): Promise<RunAsOwnerResult> {
  return withLock(`${ownerGhii}|${workflowId}`, async () => {
    const rec = await deps.storage.getMemory(ownerGhii, runKey(workflowId, refusedRunId));
    const run = rec?.value as WorkflowRun | undefined;
    if (!rec || !run) return { ok: false, code: 'NOT_FOUND', message: `Run "${refusedRunId}" not found` };
    if (run.status !== 'refused' || !run.refusal) {
      return { ok: false, code: 'NOT_REFUSED', message: 'This run was not refused, so there is nothing to start in its place.' };
    }
    if (run.refusal.ranAsOwner) {
      return { ok: false, code: 'ALREADY_STARTED', message: `This was already started as you: run ${run.refusal.ranAsOwner.runId}.`, runId: run.refusal.ranAsOwner.runId };
    }
    // Bound to the object, not to the id: the press starts the definition this refusal pinned, or
    // nothing. Refused before the start, so no run record and no AI call is made.
    const current = await getWorkflow(deps.storage, ownerGhii, workflowId);
    if (!current) return { ok: false, code: 'DEFINITION_CHANGED', message: GONE };
    if (definitionFingerprint(current) !== definitionFingerprint(run.defSnapshot)) {
      return { ok: false, code: 'DEFINITION_CHANGED', message: CHANGED };
    }
    const started = await start(ownerGhii, ownerName, workflowId);
    if ('error' in started) return { ok: false, code: 'START_FAILED', message: 'Could not start the run', errors: started.error };
    if (started.skipped) {
      return { ok: false, code: 'SKIPPED', message: 'A run of this workflow is already in flight, so nothing was started. Wait for it and press again.', runId: started.runId };
    }
    run.refusal = { ...run.refusal, ranAsOwner: { runId: started.runId, at: new Date().toISOString() } };
    await writeRun(deps.storage, ownerGhii, run, rec.version + 1, rec.createdAt);
    emitChange('workflows');
    return { ok: true, runId: started.runId };
  });
}
