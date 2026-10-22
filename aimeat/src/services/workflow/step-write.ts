/**
 * @file src/services/workflow/step-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The write a step's answer makes: an extension step's and an ai step's `result_to_key`,
 *   a human-input step's `answer_to_key`.
 *
 *   WHY THIS FILE EXISTS. The three writers stored the value with a raw storage write under the
 *   workflow owner, whatever the key was. For a key of the owner's own that is the design: the engine
 *   is the owner's automation, and the next step's signal reads it back. For an `organism.*` key it
 *   skipped the organism namespace rule that every other writer asks (services/memory-write.ts,
 *   ai-jobs/service.ts since wave 2): an owner who is not a member of an organism saved a workflow
 *   whose answer_to_key named a published record of that organism's workspace, answered it, and the
 *   members' workspace read served that value in place of the record (secaudit 2026-10, r66).
 *
 *   WHAT CHANGED. An `organism.*` key is written through writeMemoryRecord, as the principal the run
 *   acts for, so the organism namespace rule, the workspace's declared spaces, the schema lock, the
 *   archive guard and the memory ceilings apply to it as they do on POST /v1/memory. A member's
 *   workflow that writes into a workspace the member contributes to still lands. A refusal throws
 *   StepWriteRefused: the engine fails the answer of an extension or ai step (engine-answer.ts
 *   writeResult), and a human-input step keeps the person's answer pinned in the run and goes red.
 *
 *   WHAT DID NOT. Every other key is written exactly as before, byte for byte: the owner's own
 *   results, a sandbox run's `wf-test.<run>.` keys (a sandbox prefix never starts with `organism.`),
 *   and no workflow trigger, push or recipe starts from any of them (`noTriggers`), as none did.
 *
 *   WHO WRITES. The run's principal (run.principal): an agent, an app or an ecosystem app with the
 *   permissions it holds now, or the owner. A run started before runs recorded a principal acts for
 *   the owner. A human-input answer given by the owner in person is written as the owner, because
 *   the person's answer is not the agent's work. The scope the write answers to is the one the step's
 *   kind costs (step-authority.ts): ext:invoke, ai:use, and workflow:write for an answer, which the
 *   principal held when the run started or was asked again before the step (dispatch-authority.ts).
 * @structure StepWriteRefused · StepWriter · StepMemoryWrite · setStepMemoryWrite(fn) ·
 *   stepWriter(storage, ownerGhii, run, opts) · writeStepValue(deps, ownerGhii, run, write)
 * @usage
 *   await writeStepValue(deps, ownerGhii, run, { key, value, visibility: 'private', tags: ['workflow-extension-result'],
 *     authorisingScope: 'ext:invoke', pipeline: `workflow:${run.workflowId}/${stepId}` });
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, r66).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';
import { saverAuthority } from './trigger-authority.js';

/** The writer, in the shape services/memory-write.ts MemoryWriteCaller takes. */
export interface StepWriter {
  principal: string;
  targetGaii: string;
  scopes: string[];
  roles: string[];
  app?: string;
}

/**
 * services/memory-write.ts writeMemoryRecord, in the part of its shape this file uses. SET AT BOOT
 * (setStepMemoryWrite, server-bootstrap/service-init.ts), as the workflow engine is: memory-write.ts
 * imports the engine, so a static import from here would close an import cycle.
 */
export type StepMemoryWrite = (
  deps: { storage: Storage; config: AimeatConfig },
  caller: StepWriter,
  input: {
    key: string; value: unknown; visibility: MemoryRecord['visibility']; tags?: string[]; ttlHours?: number | null;
    authorisingScope?: string; noTriggers?: boolean; pipeline: string; declaredProvenanceId?: string;
  },
) => Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;

let sharedWrite: StepMemoryWrite | null = null;

/** Set the shared memory write. Called once at boot. */
export function setStepMemoryWrite(fn: StepMemoryWrite | null): void {
  sharedWrite = fn;
}

/** A step's answer that the shared memory write refused. The message names the rule. */
export class StepWriteRefused extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'StepWriteRefused';
  }
}

/**
 * The writer of a step's answer: the principal the run acts for, with the permissions it holds now.
 * `answeredInPerson`: a human-input answer the owner gave in person, which is the owner's own.
 */
export async function stepWriter(
  storage: Storage, ownerGhii: string, run: Pick<WorkflowRun, 'principal'>, opts: { answeredInPerson?: boolean } = {},
): Promise<StepWriter> {
  const owner: StepWriter = { principal: ownerGhii, targetGaii: ownerGhii, roles: ['owner'], scopes: [] };
  const p = run.principal;
  if (opts.answeredInPerson || !p || p.kind === 'owner') return owner;
  const now = await saverAuthority(storage, p);
  const scopes = now.gone ? [] : [...now.scopes];
  if (p.kind === 'app') {
    const grant = p.id ? await storage.getAppGrant(p.id) : null;
    return { principal: ownerGhii, targetGaii: ownerGhii, roles: ['app'], scopes, ...(grant?.app ? { app: grant.app } : {}) };
  }
  return { principal: p.id, targetGaii: ownerGhii, roles: [p.kind], scopes };
}

export interface StepValueWrite {
  key: string;
  value: unknown;
  visibility: MemoryRecord['visibility'];
  tags: string[];
  /** The record the model call minted, carried onto the written answer (an ai step). */
  provenanceId?: string;
  /** The word the step's kind costs (step-authority.ts STEP_KIND_SCOPES), which this write answers to. */
  authorisingScope: string;
  /** For the provenance record: `workflow:<id>/<step>`. */
  pipeline: string;
  /** A human-input answer the owner gave in person. */
  answeredInPerson?: boolean;
}

/**
 * Store a step's answer in the owner's namespace. An `organism.*` key goes through the shared memory
 * write and its rules; any other key is written as the engine always wrote it. Throws
 * StepWriteRefused when the shared write refuses.
 */
export async function writeStepValue(
  deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, run: Pick<WorkflowRun, 'principal'>, w: StepValueWrite,
): Promise<void> {
  const { storage, config } = deps;
  if (!w.key.startsWith('organism.')) {
    const existing = await storage.getMemory(ownerGhii, w.key);
    const now = new Date().toISOString();
    await storage.setMemory({
      key: w.key, ownerGaii: ownerGhii, value: w.value,
      ...(w.provenanceId ? { aiProvenanceId: w.provenanceId } : {}),
      visibility: w.visibility, tags: w.tags, ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    return;
  }
  // Never the raw write for an organism key: without the shared write (a process that did not set it
  // at boot) the answer is refused rather than stored past the organism rule.
  if (!sharedWrite) throw new StepWriteRefused('NOT_AVAILABLE', 503, `"${w.key}" was not written: the shared memory write is not set up in this process.`);
  const writer = await stepWriter(storage, ownerGhii, run, { answeredInPerson: w.answeredInPerson });
  const out = await sharedWrite({ storage, config }, writer, {
    key: w.key,
    value: w.value,
    visibility: w.visibility,
    tags: w.tags,
    ttlHours: null,
    authorisingScope: w.authorisingScope,
    // As before: a step's answer starts no workflow trigger, Tracked Response, connector push,
    // ecosystem push or automation recipe.
    noTriggers: true,
    pipeline: w.pipeline,
    ...(w.provenanceId ? { declaredProvenanceId: w.provenanceId } : {}),
  });
  if (!out.ok) {
    throw new StepWriteRefused(out.code, out.status, `"${w.key}" was not written for ${writer.principal}: ${out.message}`);
  }
}
