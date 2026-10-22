/**
 * @file src/services/schedule-ai-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which same-owner records a scheduled `ai` job may hand its model: the records the
 *   schedule's maker may read, asked at create, at edit and at every fire. And the once-only step that
 *   keeps the `ai` schedules stored before this rule reading as they did, until they are changed.
 *
 *   WHY. A scheduled ai job reads each input key from a namespace of the owner scope (the owner GHII
 *   by default, or a namespace `input_namespaces` names: the owner, an agent or an ecosystem app of the
 *   same owner) with no visibility check, and puts the value in the prompt. An agent holding ai:use but
 *   not memory:read-as-owner, whose own memory read of its owner's or a sibling's private record is
 *   refused, set up a schedule over that record and read it back in the answer (secaudit 2026-10, r49,
 *   the scheduled variant). The AI job start closed the same read with the viewer of
 *   services/ai-read-viewer.ts; a fired schedule now reads with the same viewer, built from its maker
 *   as services/schedule-actor.ts finds it at the fire.
 *
 *   WHO READS EVERYTHING. The owner in person, an app grant of the owner, and a maker holding
 *   memory:read-as-owner (aiReadViewerOf). Everyone else reads its own records and the owner's and
 *   siblings' records at visibility owner, members or public, as GET /v1/memory?owner_scope=true does.
 *
 *   WHAT EXISTS AT THE UPDATE KEEPS WORKING (purpose rule 6). Every `ai` schedule an agent or an
 *   ecosystem app made before this node first started with the rule is listed once, with a fingerprint
 *   of its input. While the stored input still has that fingerprint, the schedule fires without the
 *   viewer, as before. An edit that changes the input (new keys, namespaces or prompt) is a new
 *   instruction, and from then on the maker's reach applies. A pause, a rename or a new cron changes
 *   nothing the schedule reads, and the schedule stays kept.
 *
 *   WHERE. One record under `system@<nodeId>`, AI_SCHEDULE_READ_KEEP_KEY: { at, kept: [{ id, input }] }.
 *   It is never swept; a deleted schedule only leaves an entry that matches nothing.
 * @structure AI_SCHEDULE_READ_KEEP_KEY · aiScheduleInputFingerprint(input) · keepAiScheduleReadsOnce(storage, config) ·
 *   isKeptAiScheduleRead(storage, nodeId, job) · aiScheduleFireViewer(storage, config, job, actor) ·
 *   aiScheduleInputRefusal(storage, caller, ownerGhii, input)
 * @usage
 *   await keepAiScheduleReadsOnce(storage, config);                         // server-bootstrap/once-only-keep-steps.ts
 *   const viewer = await aiScheduleFireViewer(storage, config, job, actor);  // services/scheduler-ai-job.ts
 *   const bad = await aiScheduleInputRefusal(storage, caller, owner, input); // services/schedule-write.ts
 * @version-history
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10 wave 3, r49 the scheduled variant).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { localAccountName, parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { aiReadViewerOf, hiddenRecordError, type AiReadViewer } from './ai-read-viewer.js';
import { callerFromAuth } from './caller-context.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { visibleToSameOwnerReader } from './owner-scope-read.js';
import { agentPageUrl } from './permission-ask.js';
import { makerOf, type ScheduleActor } from './schedule-actor.js';

/** The record under `system@<nodeId>` that lists the kept schedules and says the step has run. */
export const AI_SCHEDULE_READ_KEEP_KEY = 'migrations.schedule-ai-read-as-owner-keep';

/** JSON with its object keys sorted and undefined members left out, so equal inputs give equal text on both backends. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A fingerprint of a schedule's input: a changed key, namespace or prompt gives another one. */
export function aiScheduleInputFingerprint(input: unknown): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

/**
 * Record, once per node, every `ai` schedule an agent or an ecosystem app made, with the fingerprint
 * of its input. Throws when a read or a write fails, and then leaves no record, so the next start
 * tries again.
 */
export async function keepAiScheduleReadsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; ids: string[] }> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, AI_SCHEDULE_READ_KEEP_KEY);
  if (!claim) return { ran: false, ids: [] };
  try {
    const kept: Array<{ id: string; input: string }> = [];
    for (const job of await storage.listScheduledJobs({ type: 'ai' })) {
      const maker = makerOf(job);
      if (maker === 'unknown-app' || (maker.kind !== 'agent' && maker.kind !== 'ecosystem')) continue;
      kept.push({ id: job.id, input: aiScheduleInputFingerprint(job.input) });
    }
    await claim.finish({ at: new Date().toISOString(), kept });
    if (kept.length) logger.info(`AI schedules: ${kept.length} made by an agent keep reading as before until they are changed`, { ids: kept.map(k => k.id) });
    return { ran: true, ids: kept.map(k => k.id) };
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/** True when the step above kept `job` and its input has not changed since. */
export async function isKeptAiScheduleRead(
  storage: Storage, nodeId: string, job: Pick<ScheduledJobRecord, 'id' | 'input'>,
): Promise<boolean> {
  const record = await storage.getMemory(`system@${nodeId}`, AI_SCHEDULE_READ_KEEP_KEY);
  const kept = (record?.value as { kept?: unknown } | undefined)?.kept;
  if (!Array.isArray(kept)) return false;
  const entry = kept.find((k): k is { id: string; input: string } => !!k && typeof k === 'object' && (k as { id?: unknown }).id === job.id);
  return !!entry && entry.input === aiScheduleInputFingerprint(job.input);
}

/**
 * The viewer a fired `ai` schedule reads its inputs as: its maker as found at this fire. Undefined
 * (reads as before) for a schedule the once-only step kept whose input is unchanged. A refusal names
 * memory:read-as-owner and, for an agent, its page where the owner ticks it.
 */
export async function aiScheduleFireViewer(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'baseUrl'>,
  job: Pick<ScheduledJobRecord, 'id' | 'input' | 'ownerScope'>,
  actor: Extract<ScheduleActor, { ok: true }>,
): Promise<AiReadViewer | undefined> {
  if (await isKeptAiScheduleRead(storage, config.nodeId, job)) return undefined;
  const { kind } = callerFromAuth({ sub: actor.principal, owner: '', roles: actor.roles, scopes: actor.scopes }, config.nodeId, storage);
  const agentName = kind === 'agent' ? (parseGaiiLoose(actor.principal).agent || actor.principal) : '';
  const note = `This schedule reads what ${actor.principal}, which made it, may read.`
    + (agentName ? ` The agent's page: ${agentPageUrl(config.baseUrl, agentName)}` : '');
  return aiReadViewerOf({
    principal: actor.principal, owner: localAccountName(job.ownerScope ?? actor.principal),
    roles: actor.roles, scopes: actor.scopes,
  }, note);
}

/** Who is saving an `ai` schedule, in the terms services/schedule-write.ts ScheduleWriteCaller carries. */
export interface AiScheduleSaver {
  identity: string;
  owner: string;
  isOwnerSession: boolean;
  scopes: string[];
  roles?: string[];
  isApp?: boolean;
  appGrant?: string;
}

/** The input keys and namespaces a stored `ai` schedule reads, in both spellings an edit may use. */
function namedInputs(input: Record<string, unknown>, ownerGhii: string): Array<{ key: string; namespace: string }> {
  const out: Array<{ key: string; namespace: string }> = [];
  for (const [keys, spaces] of [[input.inputKeys, input.inputNamespaces], [input.input_keys, input.input_namespaces]] as const) {
    if (!Array.isArray(keys)) continue;
    const ns = Array.isArray(spaces) ? spaces : [];
    keys.forEach((key, i) => {
      if (typeof key !== 'string' || !key) return;
      out.push({ key, namespace: typeof ns[i] === 'string' && ns[i] ? ns[i] as string : ownerGhii });
    });
  }
  return out;
}

/**
 * The refusal when an `ai` schedule's input names a same-owner record that exists now and that the
 * saver may not read, or null. Asked at create and at edit, where somebody reads the answer; the fire
 * asks the maker again (aiScheduleFireViewer), which also covers a record written or made private later.
 */
export async function aiScheduleInputRefusal(
  storage: Storage, saver: AiScheduleSaver, ownerGhii: string, input: Record<string, unknown>,
): Promise<{ status: 403; code: 'SCOPE_DENIED'; message: string } | null> {
  if (saver.isOwnerSession || saver.isApp || saver.appGrant) return null;
  const viewer = aiReadViewerOf({ principal: saver.identity, owner: saver.owner, roles: saver.roles ?? [], scopes: saver.scopes },
    `A schedule reads what ${saver.identity}, which saves it, may read.`);
  if (!viewer || viewer.readsAll) return null;
  for (const { key, namespace } of namedInputs(input, ownerGhii)) {
    const rec = await storage.getMemory(namespace, key);
    if (rec && !visibleToSameOwnerReader(rec, viewer.principal)) {
      return { status: 403, code: 'SCOPE_DENIED', message: hiddenRecordError(key, viewer).message };
    }
  }
  return null;
}
