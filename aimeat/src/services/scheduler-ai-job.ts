/**
 * @file src/services/scheduler-ai-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduled `ai` job: read the named memory records, compose the prompt, ask the
 *   model as whoever made the schedule, and store the answer in the owner's namespace.
 *
 *   WHY IT IS ITS OWN FILE AND A REGISTERED KIND. The answer is written through the shared memory
 *   write service (services/memory-write.ts), so the organism audience check, the publish gate, the
 *   label audience cap and the organism namespace rule run on every fire. That service reaches the
 *   Scheduler through the workflow engine and the ecosystem automation, so a module the Scheduler
 *   imports cannot import it back without a cycle. The `refinery` kind solved the same problem the
 *   same way: boot registers the executor (server-bootstrap/service-init.ts
 *   `scheduler.registerKindExecutor`), and the Scheduler never names this file.
 * @structure runAiJob(storage, config, job)
 * @usage scheduler.registerKindExecutor('ai', (job) => runAiJob(storage, config, job));
 * @version-history
 *   v1.2.0 -- 2026-10-25 -- A schedule an agent made reads its inputs with that agent's reader, so the
 *     agent's clearance applies at the fire and a refusal names it; the owner's, an app's and an
 *     ecosystem app's schedules read as an unattended run as before (secaudit2026oct22, lead 494).
 *   v1.1.0 -- 2026-10-22 -- The inputs are read for the schedule's maker (services/schedule-ai-read.ts
 *     aiScheduleFireViewer): a private record of the owner or of a sibling agent is refused, naming
 *     memory:read-as-owner, to a maker that does not read as the owner, and the maker is asked before
 *     the reads rather than after them. A schedule the once-only step kept reads as before until its
 *     input changes (secaudit 2026-10 wave 3, r49 the scheduled variant).
 *   v1.0.0 — 2026-10-20 — Moved out of services/scheduler-remote-jobs.ts unchanged, except for the
 *     write: the answer goes through writeMemoryRecord as the schedule's maker instead of a raw
 *     storage.setMemory at whatever string the schedule carried as its visibility (secaudit 2026-10,
 *     runAiJob:raw-setMemory-unvalidated-outputVisibility). Its own history before the move is in
 *     services/scheduler-remote-jobs.ts.
 */
import type { AimeatConfig } from '../config.js';
import type { MemoryRecord, Storage, ScheduledJobRecord } from '../storage/interface.js';
import type { JobRunResult } from './scheduler.js';
import { recordMemoryTouch } from './data-map/write-tally-buffer.js';
import { completeForOwner } from './ai/completion.js';
import { isSameOwner, localAccountName } from '../utils/gaii.js';
import { readerForCaller } from './classification/reader.js';
import { aiJobKeyRefusal } from './ai-job-keys.js';
import { readAiRecords } from './ai-inputs.js';
import { unattendedReader } from './ai-jobs/starter.js';
import { scheduleActor } from './schedule-actor.js';
import { writeMemoryRecord } from './memory-write.js';
import { scopeIsCovered, READ_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';
import { AiInputHiddenError } from './ai-read-viewer.js';
import { aiScheduleFireViewer } from './schedule-ai-read.js';
import { noteAgentRefusal } from './agent-refusals.js';
import { agentSessionCaller, callerFromAuth } from './caller-context.js';

/**
 * `ai` kind: gather predefined input memory keys, compose the prompt, run a
 * server-side completion on the owner's OpenRouter key, and store the result
 * to the owner's output key. Zero agent involvement; runs even when offline.
 */
export async function runAiJob(storage: Storage, config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
  const owner = job.ownerScope;
  if (!owner) throw new Error(`AI job "${job.id}" missing ownerScope`);
  const cfg = (job.input ?? {}) as {
    inputKeys?: string[]; inputNamespaces?: string[]; prompt?: string;
    systemPrompt?: string; model?: string; outputKey?: string;
    outputVisibility?: MemoryRecord['visibility'];
  };
  if (!cfg.prompt || typeof cfg.prompt !== 'string') {
    throw new Error(`AI job "${job.id}" missing prompt`);
  }
  // Before the first read: every input goes to the provider and the answer lands at the output key,
  // so neither may name a record the node keeps for itself. The doors refuse it at create and edit;
  // this holds a schedule stored before they did to the same rule.
  const kept = aiJobKeyRefusal({ inputKeys: cfg.inputKeys, outputKey: cfg.outputKey });
  if (kept) throw new Error(`AI job "${job.id}": ${kept.message}`);

  const inputKeys = Array.isArray(cfg.inputKeys) ? cfg.inputKeys : [];
  const reads: string[] = [];
  const parts: string[] = [cfg.prompt];
  const named: Array<{ key: string; namespace: string }> = [];
  for (let i = 0; i < inputKeys.length; i++) {
    const key = inputKeys[i];
    const ns: string = cfg.inputNamespaces?.[i] || owner;
    // SECURITY (C-2): the read below is the raw composite-key lookup — it applies no visibility or
    // consent check — and the value is pasted into a prompt whose output the job owner keeps. A
    // namespace belonging to anyone else is therefore a verbatim read of their private memory. The
    // create and patch routes refuse one, and this refuses it again at run time, which is what
    // covers jobs stored before that gate existed.
    if (ns !== owner && !isSameOwner(ns, owner)) {
      throw new Error(`AI job "${job.id}" names an input namespace outside its owner: ${ns}`);
    }
    named.push({ key, namespace: ns });
    reads.push(ns === owner ? key : `${ns}::${key}`);
  }
  // As whoever made the schedule, asked now (services/schedule-actor.ts): an agent's cap and the
  // owner's rules for that agent or app apply, and a maker that is gone or lost ai:use stops it.
  // Until 2026-10-05 it asked as the owner in person (secaudit 2026-10, AI-3). Asked before the
  // reads since 2026-10-22, because the maker is also who the inputs are read for.
  const actor = await scheduleActor(storage, job);
  if (!actor.ok) throw new Error(actor.reason);
  if (!actor.isOwner && !scopeIsCovered(actor.scopes, 'ai:use')) {
    throw new Error('What made this schedule no longer holds ai:use, so it does not run. Approve it again, or delete this schedule.');
  }

  // The one loader of what a model reads (services/ai-inputs.ts): the credential mask and the
  // classification check. A schedule fires with nobody present, so it reads as an AI (TARGET-082 V4,
  // decided 2026-09-29): an agent's schedule as that agent, any other as an unattended run (below).
  // And it hands the model only the
  // same-owner records its maker may read (services/schedule-ai-read.ts): a private record of the
  // owner or of a sibling agent is refused to an agent without memory:read-as-owner before any model
  // is called (secaudit 2026-10 wave 3, r49 the scheduled variant). A schedule kept by the once-only
  // step reads as before until its input changes.
  const viewer = await aiScheduleFireViewer(storage, config, job, actor);
  // A schedule an agent made reads its inputs as that agent, so the clearance its owner set on it
  // applies at the fire as it does on the agent's immediate AI job (ai-jobs/starter.ts jobReader),
  // and a refusal names that clearance (classification/reader.ts useForAi). The owner's own
  // schedules, an app's and an ecosystem app's read as an unattended run, as before (secaudit2026oct22,
  // scheduler-ai-job.ts:runAiJob:background-ai-input-read-as-owner-reader; developer decision 2026-10-25).
  // What kind of principal made the schedule is asked of its caller object (caller-context.ts).
  const maker = callerFromAuth({ sub: actor.principal, owner: '', roles: actor.roles, scopes: actor.scopes }, config.nodeId, storage);
  const reader = maker.kind === 'agent'
    ? readerForCaller({ storage, config }, { gaii: actor.principal, owner: localAccountName(owner), roles: [...actor.roles], scopes: [...actor.scopes] })
    : unattendedReader({ storage, config }, owner);
  let inputs: Awaited<ReturnType<typeof readAiRecords>>;
  try {
    inputs = await readAiRecords({ storage, config }, reader, owner, named, { capability: 'text' }, viewer);
  } catch (err) {
    // On the agent's card and in the owner's bell, once while the refusal stays open, as a fire
    // refused for a missing word is (services/schedule-fire-refusal.ts).
    if (err instanceof AiInputHiddenError) {
      if (maker.kind === 'agent') {
        noteAgentRefusal(agentSessionCaller(actor.principal, '', actor.scopes, config.nodeId, storage).auth, [READ_AS_OWNER_SCOPE], false, `schedule ${job.id}`);
      }
    }
    throw err;
  }
  for (const { key, value } of inputs) {
    const valueText = value === undefined
      ? '(empty)'
      : (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    parts.push(`\n--- INPUT: ${key} ---\n${valueText}`);
  }
  const composedPrompt = parts.join('\n');

  const result = await completeForOwner(storage, config, owner, {
    prompt: composedPrompt,
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    appId: `schedule:${job.id}`,
    caller: actor.ai.caller,
    ...(actor.ai.agent ? { agent: actor.ai.agent } : {}),
    ...(actor.ai.verifiedApp ? { verifiedApp: actor.ai.verifiedApp } : {}),
  });

  const outputKey = cfg.outputKey || `scheduler.${job.id}.output`;
  // THROUGH THE SHARED MEMORY WRITE SERVICE, as the schedule's maker. A raw storage.setMemory here
  // skipped every audience rule a memory write has: an agent's schedule stored the answer at
  // `organism:<id>` for an organism the owner is not a member of, with no publish gate, no label
  // audience cap and no organism namespace rule for an `organism.*` output key (secaudit 2026-10).
  // The create and edit paths refuse a bad output_visibility; this holds a schedule stored before
  // they did to the same rule, and a refusal fails the run rather than storing anything.
  //
  // TARGET-058. A scheduled AI job is the purest autonomous path there is: it fires on a clock,
  // writes, and nobody is present. The completion above already minted an observed record (the node
  // watched the model produce these bytes), so it is CARRIED here rather than re-derived — same
  // bytes, same statement.
  //
  // THE RULE, in the words it must keep: only a step where a person reads the substance and can
  // reject it upgrades humanInvolvement. Clicking publish is not that step. A workflow human-input
  // step that reviews substance MAY upgrade it. Nothing else may. There is no such step anywhere on
  // this path, which is why nothing here touches the record's `humanInvolvement: 'none'`.
  const written = await writeMemoryRecord({ storage, config }, {
    principal: actor.principal,
    targetGaii: owner,
    scopes: [...actor.scopes],
    roles: [...actor.roles],
    ...(actor.appRef ? { app: actor.appRef } : {}),
  }, {
    key: outputKey,
    value: result.content,
    visibility: cfg.outputVisibility || 'private',
    tags: ['scheduler', 'ai-output'],
    ttlHours: null,
    // The word this write answers to is the one the schedule's own gate asks (schedule-gate.ts
    // SCHEDULE_KIND_SCOPE ai), already checked against the maker a few lines above.
    authorisingScope: 'ai:use',
    gatePublic: true,
    ownerScoped: true,
    pipeline: `schedule:${job.id}`,
    ...(result.provenance ? { declaredProvenanceId: result.provenance.id } : {}),
  });
  if (!written.ok) throw new Error(`AI job "${job.id}": ${written.message}`);

  // The highest-volume single writer on this node: a per-minute schedule is one tally row and a
  // rising count, where an append log would have been one row per fire. `schedule:{id}` is the same
  // identity string the AI ledger already uses for this job, so the two agree about whose hand it was.
  recordMemoryTouch({ ownerGaii: owner, key: outputKey, writerPrincipal: `schedule:${job.id}`, kind: 'write' });

  return { reads, writes: [outputKey] };
}
