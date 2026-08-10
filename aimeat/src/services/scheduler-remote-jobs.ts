/**
 * @file src/services/scheduler-remote-jobs.ts
 * @description Scheduled `ai`, `workflow`, and `eco-capability` job executors — the non-extension,
 *   non-core, non-agent_task kinds. Extracted from scheduler.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from scheduler.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — Security audit C-2: an `ai` job refuses an input namespace outside its
 *     owner. The namespace came from the create body and went straight into the raw composite-key
 *     lookup, so any registered account could read another owner's private memory verbatim through
 *     a prompt. The routes refuse it now too; this covers jobs stored before that gate existed.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import type { JobRunResult } from './scheduler.js';
import { completeForOwner } from './ai-completion.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { parseGaiiLoose, buildGEAI, isSameOwner } from '../utils/gaii.js';

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
    outputVisibility?: 'private' | 'owner' | 'public';
  };
  if (!cfg.prompt || typeof cfg.prompt !== 'string') {
    throw new Error(`AI job "${job.id}" missing prompt`);
  }

  const inputKeys = Array.isArray(cfg.inputKeys) ? cfg.inputKeys : [];
  const reads: string[] = [];
  const parts: string[] = [cfg.prompt];
  for (let i = 0; i < inputKeys.length; i++) {
    const key = inputKeys[i];
    const ns: string = cfg.inputNamespaces?.[i] || owner;
    // SECURITY (C-2): getMemory is the raw composite-key lookup — it applies no visibility or consent
    // check — and the value below is pasted into a prompt whose output the job owner keeps. A
    // namespace belonging to anyone else is therefore a verbatim read of their private memory. The
    // create and patch routes refuse one, and this refuses it again at run time, which is what
    // covers jobs stored before that gate existed.
    if (ns !== owner && !isSameOwner(ns, owner)) {
      throw new Error(`AI job "${job.id}" names an input namespace outside its owner: ${ns}`);
    }
    const rec = await storage.getMemory(ns, key);
    reads.push(ns === owner ? key : `${ns}::${key}`);
    const valueText = rec == null
      ? '(empty)'
      : (typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value, null, 2));
    parts.push(`\n--- INPUT: ${key} ---\n${valueText}`);
  }
  const composedPrompt = parts.join('\n');

  const result = await completeForOwner(storage, config, owner, {
    prompt: composedPrompt,
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    appId: `schedule:${job.id}`,
  });

  const outputKey = cfg.outputKey || `scheduler.${job.id}.output`;
  const now = new Date().toISOString();
  const existing = await storage.getMemory(owner, outputKey);
  await storage.setMemory({
    key: outputKey,
    ownerGaii: owner,
    value: result.content,
    // TARGET-058. A scheduled AI job is the purest autonomous path there is: it fires on a clock,
    // writes, and nobody is present. The completion above already minted an observed record (the
    // node watched the model produce these bytes), so it is CARRIED here rather than re-derived —
    // same bytes, same statement.
    //
    // THE RULE, in the words it must keep: only a step where a person reads the substance and can
    // reject it upgrades humanInvolvement. Clicking publish is not that step. A workflow human-input
    // step that reviews substance MAY upgrade it. Nothing else may. There is no such step anywhere
    // on this path, which is why nothing here touches the record's `humanInvolvement: 'none'`.
    ...(result.provenance ? { aiProvenanceId: result.provenance.id } : {}),
    visibility: cfg.outputVisibility || 'private',
    tags: ['scheduler', 'ai-output'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return { reads, writes: [outputKey] };
}

/**
 * `workflow` kind: fire one Agent Workflow run. The schedule is just the trigger; the deterministic
 * engine owns the run loop (dispatch + two-sided signal checks + advance). `input.workflowId`
 * names the workflow; `ownerScope` is the owner GHII it belongs to.
 */
export async function runWorkflowJob(job: ScheduledJobRecord): Promise<JobRunResult> {
  const owner = job.ownerScope;
  const workflowId = (job.input as { workflowId?: string } | undefined)?.workflowId;
  if (!owner || !workflowId) throw new Error(`workflow job "${job.id}" missing ownerScope/workflowId`);
  const engine = getActiveWorkflowEngine();
  if (!engine) return { reads: [], writes: [], skipped: true, skipReason: 'workflow engine not started' };
  const result = await engine.startRun(owner, owner.split('@')[0], workflowId, { mode: 'full-live' });
  if ('error' in result) throw new Error(`workflow run failed to start: ${result.error.join('; ')}`);
  return { reads: [], writes: [`workflows.run.${workflowId}.${result.runId}`] };
}

/**
 * `eco-capability` kind: invoke a connected ecosystem app's (GEAI) capability over the
 * connect-tunnel on each fire. `input` is `{ app, capability_id, input? }`; `ownerScope` is the
 * owner GHII whose binding to drive. AIMEAT authenticates the owner as caller; the ecosystem
 * enforces its OWN ACL. When the GEAI is offline at fire time the run is SKIPPED (not an error) so
 * it does not hot-loop — the next scheduled fire retries.
 */
export async function runEcoCapabilityJob(config: AimeatConfig, job: ScheduledJobRecord): Promise<JobRunResult> {
  const owner = job.ownerScope;
  if (!owner) throw new Error(`eco-capability job "${job.id}" missing ownerScope`);
  const cfg = (job.input ?? {}) as { app?: string; capability_id?: string; input?: Record<string, unknown> };
  const app = cfg.app;
  const capabilityId = cfg.capability_id;
  if (!app || !capabilityId) {
    throw new Error(`eco-capability job "${job.id}" missing app/capability_id in input`);
  }

  const ownerName = parseGaiiLoose(owner).owner;
  const geai = buildGEAI(app, ownerName, config.nodeId);
  const caller = `${ownerName}@${config.nodeId}`;

  const mgr = getActiveConnectTunnelManager();
  if (!mgr) {
    // No tunnel server running — skip rather than error (nothing to invoke against).
    return { reads: [], writes: [], skipped: true, skipReason: 'connect-tunnel unavailable' };
  }

  try {
    const reply = await mgr.invokeOnPrincipal(geai, { capability: capabilityId, input: cfg.input ?? {}, caller });
    if (!reply.ok) {
      throw new Error(`Ecosystem app "${app}" refused or failed capability "${capabilityId}"`);
    }
    return { reads: [], writes: [`eco.${app}.${capabilityId}`] };
  } catch (err) {
    // The GEAI being offline at fire time is a SKIP, not an error — don't hot-loop; retry next fire.
    const code = (err as { code?: string }).code;
    if (code === 'ECOSYSTEM_OFFLINE') {
      return { reads: [], writes: [], skipped: true, skipReason: `app "${app}" offline` };
    }
    throw err;
  }
}
