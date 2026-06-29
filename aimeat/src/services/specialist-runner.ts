/**
 * @file specialist-runner.ts
 * @description Node-run executor for specialists. A specialist is a stripped-down Secretary — its own
 *   brain (agent directives) + operating policy — and, like the Secretary, it runs on the NODE using the
 *   owner's OpenRouter key (completeForOwner). This module executes a specialist's QUEUED agent tasks:
 *   it produces the deliverable grounded in the task (which carries the facts + the quality contract from
 *   delegation), writes it to the specialist's memory, and marks the task done. Driven both by the
 *   Secretary tick (the Secretary directs its specialists) and on-demand via POST /v1/specialists/:name/run.
 * @structure
 *   - SPECIALIST_CONTRACT — the quality contract baked into every specialist's system prompt
 *   - executeSpecialistTask(...) -> { ok, deliverableKey? }
 *   - runSpecialistQueue(storage, config, ownerGhii, ownerName, specialist, opts?) -> string[] (writes)
 *   - runAllSpecialists(storage, config, ownerGhii, ownerName) -> string[] (writes)
 * @usage import { runAllSpecialists, runSpecialistQueue } from './specialist-runner.js';
 * @version-history
 *   v0.1.0 — 2026-06-28 — Phase 1: node-run specialist executor (owner-key, quality contract, grounded).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord, AgentTaskRecord } from '../storage/interface.js';
import { completeForOwner } from './ai-completion.js';
import { listSpecialists, specialistRole, specialistOutKey } from './specialist.js';
import { logger } from '../utils/logger.js';

/** The quality contract baked into every specialist run — same standard the Secretary works to. */
export const SPECIALIST_CONTRACT = [
  'WORK TO THIS QUALITY CONTRACT:',
  '- Ground everything ONLY in the facts/context in the task or readable from the workspace. Never invent numbers, metrics, statistics, quotes, testimonials, names, dates, events, deals, or outcomes.',
  '- If a needed fact is missing and only the owner can provide it, say so clearly and use a [bracketed placeholder] rather than guessing.',
  '- Verify your output against the facts before delivering, and flag anything not supported.',
].join('\n');

/** Build a specialist's system prompt from its brain (agent directives) + the quality contract. */
async function specialistSystemPrompt(storage: Storage, specialist: AgentRecord): Promise<string> {
  const role = specialistRole(specialist);
  const dir = await storage.getAgentDirectives(specialist.gaii).catch(() => null);
  const purpose = (dir?.purpose || '').trim();
  const rules = (dir?.rules || []).map((r) => `- ${typeof r === 'string' ? r : (r?.description || '')}`).filter((l) => l.trim() !== '-').join('\n');
  const brain = [
    `You are "${specialist.displayName || specialist.name}", a ${role} specialist working for your owner.`,
    purpose ? `Your purpose: ${purpose}` : '',
    rules ? `Your rules:\n${rules}` : '',
    SPECIALIST_CONTRACT,
    'Output only the deliverable, ready to use. Markdown is fine.',
  ].filter(Boolean).join('\n\n');
  return brain;
}

/**
 * Execute one queued task for a specialist: produce the deliverable (owner's key), write it to the
 * specialist's memory, and mark the task done. Returns ok:false (task left queued) on spending-pause/error.
 */
export async function executeSpecialistTask(
  storage: Storage, config: AimeatConfig, ownerGhii: string,
  specialist: AgentRecord, task: AgentTaskRecord,
): Promise<{ ok: boolean; deliverableKey?: string }> {
  const systemPrompt = await specialistSystemPrompt(storage, specialist);
  const prompt = (task.description || task.title || '').trim();
  if (!prompt) return { ok: false };
  let content: string;
  try {
    const r = await completeForOwner(storage, config, ownerGhii, { prompt, systemPrompt, appId: `specialist:${specialist.name}:${task.id}` });
    content = ((r && r.content) || '').trim();
  } catch (e) {
    logger.info('[specialist-runner] task deferred (spending/err)', { gaii: specialist.gaii, taskId: task.id, err: (e as Error).message });
    return { ok: false };   // leave queued — retry next run
  }
  if (!content) return { ok: false };
  const now = new Date().toISOString();
  const deliverableKey = `specialist.${specialist.name}.deliverable.${task.id}`;
  await storage.setMemory({
    key: deliverableKey, ownerGaii: specialist.gaii,
    value: { taskId: task.id, title: task.title, content, createdAt: now },
    visibility: 'private', tags: ['specialist', 'deliverable'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  // Also write the offer's deliverable location (the latest output) so the specialist's workflow offer
  // (success_signal = nonempty at this key) is satisfied when a workflow step dispatches to it. When the
  // task is a SANDBOX workflow dispatch, the engine passes a `wf-key-prefix` scope — write under it too
  // so the sandbox signal (which reads prefix+key) passes without clobbering production keys.
  const outKey = specialistOutKey(specialist.name);
  const prefix = (task.scope || []).find((sc) => sc.name === 'wf-key-prefix')?.value || '';
  const outVal = { taskId: task.id, title: task.title, content, createdAt: now };
  for (const k of prefix ? [outKey, prefix + outKey] : [outKey]) {
    const prev = await storage.getMemory(specialist.gaii, k);
    await storage.setMemory({
      key: k, ownerGaii: specialist.gaii, value: outVal,
      visibility: 'owner', tags: ['specialist', 'deliverable'], ttlHours: null,
      version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
  }
  await storage.updateAgentTask(task.id, { status: 'done', completedAt: now, deliverableKey, lastEventAt: now });
  logger.info('[specialist-runner] task done', { gaii: specialist.gaii, taskId: task.id, deliverableKey });
  return { ok: true, deliverableKey };
}

/** Execute up to `limit` queued tasks for one specialist. Returns the deliverable keys written. */
export async function runSpecialistQueue(
  storage: Storage, config: AimeatConfig, ownerGhii: string,
  specialist: AgentRecord, opts?: { limit?: number },
): Promise<string[]> {
  const writes: string[] = [];
  const { tasks } = await storage.listAgentTasks(specialist.gaii, { status: 'queued', perPage: opts?.limit ?? 5 });
  for (const task of tasks) {
    const r = await executeSpecialistTask(storage, config, ownerGhii, specialist, task);
    if (r.ok && r.deliverableKey) writes.push(r.deliverableKey);
  }
  return writes;
}

/** Run every specialist's queued tasks for an owner (driven by the Secretary tick). */
export async function runAllSpecialists(
  storage: Storage, config: AimeatConfig, ownerGhii: string, ownerName: string,
): Promise<string[]> {
  const specialists = await listSpecialists(storage, ownerName);
  const writes: string[] = [];
  for (const s of specialists) writes.push(...await runSpecialistQueue(storage, config, ownerGhii, s));
  return writes;
}
