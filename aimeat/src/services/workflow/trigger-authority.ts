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
 * @structure saverOfDef(def) · saverAuthority(storage, saver) · refuseTriggerStart(deps, ownerGhii, def) ·
 *   clearRefusal(storage, nodeId, ownerGhii, workflowId) · runRefusedAsOwner(deps, start, …)
 * @usage
 *   const refused = await refuseTriggerStart({ storage, config }, ownerGhii, def);
 *   if (refused) return { runId: refused.runId, skipped: true, refused: refused.reason };
 * @version-history
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
import { runKey } from './store.js';
import { loc } from './engine-util.js';
import { missingStepScopes } from './step-authority.js';
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

/** Rewrite the list of open refusals, one read-modify-write at a time across every workflow. */
async function editOpen(storage: Storage, nodeId: string, edit: (entries: OpenRefusal[]) => OpenRefusal[] | null): Promise<void> {
  await withLock(OPEN_KEY, async () => {
    const owner = `system@${nodeId}`;
    const existing = await storage.getMemory(owner, OPEN_KEY);
    const entries = Array.isArray(existing?.value) ? existing!.value as OpenRefusal[] : [];
    const next = edit(entries);
    if (!next) return;
    const now = new Date().toISOString();
    await storage.setMemory({
      key: OPEN_KEY, ownerGaii: owner, value: next, visibility: 'private', tags: ['workflow-index'], ttlHours: null,
      version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
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
 */
export async function refuseTriggerStart(
  deps: TriggerAuthorityDeps, ownerGhii: string, def: WorkflowDef,
): Promise<{ runId: string; reason: string } | null> {
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

/** The one notification of a refusal episode, with the owner's two ways on. */
async function tellOwner(storage: Storage, ownerGhii: string, def: WorkflowDef, runId: string, now: SaverNow, missing: string[]): Promise<void> {
  const name = loc(def.title) || def.id;
  const words = missing.join(', ');
  const actions: NotifAction[] = [
    {
      id: 'run-as-me', label: 'Run as me', kind: 'api', method: 'POST', style: 'primary',
      endpoint: `/v1/workflows/${encodeURIComponent(def.id)}/runs/${encodeURIComponent(runId)}/run-as-owner`,
      i18n: { key: 'workflow_run_refused.run_as_me' },
    },
    { id: 'approve-again', label: 'Approve again', kind: 'navigate', link: now.approveLink, i18n: { key: 'workflow_run_refused.approve_again' } },
  ];
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
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REFUSED' | 'ALREADY_STARTED' | 'SKIPPED' | 'START_FAILED'; message: string; runId?: string; errors?: string[] };

/**
 * "Run as me": start the refused run once, on the owner's own authority. The door is the owner's
 * (requireOwnerPrincipal), `start` passes the owner in person as the caller, and the refusal keeps the
 * run it led to, so a second press starts nothing.
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
