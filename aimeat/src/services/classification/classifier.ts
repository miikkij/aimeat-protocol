/**
 * @file src/services/classification/classifier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Content Classifier (TARGET-082 V3, spec §7): judges how sensitive a piece of
 *   content is and labels it by the policy's rules.
 *
 *   ORDER. The detection rules run first, with no model (detect.ts), and a match is set as a rule
 *   label. The model runs after, only when the policy lets an AI label (aiMode not off), only when
 *   the content's current label lets an AI read it (reader.useForAi as the node's own reader), and
 *   only within the day's caps. What the model says goes through setLabel as an AI: it never lowers a
 *   label and never changes a person's; the policy's AI mode and confidence threshold decide whether
 *   it applies or waits as a suggestion.
 *
 *   TWO KINDS OF MODEL (decided 2026-09-29). jev: the decision model picks one label, with the
 *   label descriptions as the options' meanings and its probability as the confidence. llm: the
 *   owner's text model answers { label, confidence, reason } in JSON. Both scrub personal data from
 *   the content before it leaves, whatever the owner allows elsewhere (strictScrub), because content
 *   judged for its sensitivity is the content that must not leave as it is.
 *
 *   WHO PAYS. Personal content: its owner. Organism content: the organism's first owner.
 *
 *   CAPS. A counter per day under system@<node> counts calls per owner (or organism) and for the node.
 *   Past a cap nothing is left unclassified in silence: the item keeps the default label and waits in
 *   the queue (classification.queue), which drainQueue works through when the day turns.
 * @structure ClassifyOutcome · classifyText() · enqueue() · drainQueue() · readQueue()
 * @usage const out = await classifyText(deps, target, text);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { decideForOwner } from '../decide/service.js';
import { completeForOwner } from '../ai-completion.js';
import { createScrubber } from '../decide/scrub.js';
import { organismOwners } from '../organism-ownership.js';
import type { ClassificationLabel, ClassificationPolicy } from './defaults.js';
import { matchRules } from './detect.js';
import { classificationActiveFor, policyFor, scopeOrganism, scopeOwner } from './policy.js';
import { ClassificationError, setLabel, type LabelActor, type SetLabelResult } from './labels.js';
import { systemReader } from './reader.js';

type Deps = { storage: Storage; config: AimeatConfig };

export interface ClassifyOutcome {
  /** What set or suggested a label: a rule, the model, both, or nothing yet. */
  by: 'rule' | 'jev' | 'llm' | 'none';
  rule?: { label: string; rules: string[]; result: SetLabelResult };
  model?: { label: string; confidence: number; reason: string; result: SetLabelResult };
  /** Why the model did not run: OFF, AI_LABELLING_OFF, HIDDEN_FROM_AI, CAPPED (queued), FAILED. */
  skipped?: string;
  message?: string;
}

const QUEUE_KEY = 'classification.queue';
const QUEUE_MAX = 5000;
const MAX_CONTENT = 6000;
const usageKey = (day: string) => `classification.classifier.usage.${day}`;
const today = () => new Date().toISOString().slice(0, 10);

function nodeActor(config: AimeatConfig, target: ContentLabelTarget, kind: 'rule' | 'ai'): LabelActor {
  const owner = scopeOwner(target.scope) ?? `system@${config.nodeId}`;
  return { principal: `classifier@${config.nodeId}`, ownerGhii: owner, ownerName: null, kind, nodeOwn: true };
}

async function payerOf(deps: Deps, scope: string): Promise<string | null> {
  const orgId = scopeOrganism(scope);
  if (!orgId) return scope;
  const org = await deps.storage.getOrganism(orgId);
  const first = org ? organismOwners(org)[0] : null;
  return first ? `${first}@${deps.config.nodeId}` : null;
}

async function writeSystem(storage: Storage, owner: string, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(owner, key);
  await storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: ['classification-classifier'], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Take one call from today's caps, or answer false when a cap is reached. */
async function takeCall(deps: Deps, policy: ClassificationPolicy, scope: string): Promise<boolean> {
  const sys = `system@${deps.config.nodeId}`;
  const key = usageKey(today());
  const cur = ((await deps.storage.getMemory(sys, key))?.value ?? { node: 0, by: {} }) as { node: number; by: Record<string, number> };
  const c = policy.classifier;
  if (cur.node >= c.dailyNode || (cur.by[scope] ?? 0) >= c.dailyPerOwner) return false;
  cur.node += 1;
  cur.by[scope] = (cur.by[scope] ?? 0) + 1;
  await writeSystem(deps.storage, sys, key, cur);
  return true;
}

export interface QueuedItem { scope: string; kind: ContentLabelTarget['kind']; key: string; at: string }

export async function readQueue(storage: Storage, nodeId: string): Promise<QueuedItem[]> {
  const v = (await storage.getMemory(`system@${nodeId}`, QUEUE_KEY))?.value;
  return Array.isArray(v) ? v as QueuedItem[] : [];
}

/** Put a target in the queue for the classifier, once. The oldest drop off past the cap. */
export async function enqueue(deps: Deps, target: ContentLabelTarget): Promise<void> {
  const q = await readQueue(deps.storage, deps.config.nodeId);
  if (q.some(i => i.scope === target.scope && i.kind === target.kind && i.key === target.key)) return;
  q.push({ scope: target.scope, kind: target.kind, key: target.key, at: new Date().toISOString() });
  await writeSystem(deps.storage, `system@${deps.config.nodeId}`, QUEUE_KEY, q.slice(-QUEUE_MAX));
}

function criteriaOf(policy: ClassificationPolicy): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of policy.labels) if (l.status === 'active') out[l.id] = `${l.name.en}: ${l.description || 'no description'}`;
  return out;
}

async function askJev(deps: Deps, payer: string, policy: ClassificationPolicy, target: ContentLabelTarget, content: string) {
  const r = await decideForOwner(deps.storage, deps.config,
    { gaii: payer, principal: `classifier@${deps.config.nodeId}`, appId: 'classification', isOwner: false },
    {
      state: { content },
      questions: { label: { type: 'choice', instructions: 'Which classification fits this content? Pick the most sensitive one the content calls for.', criteria: criteriaOf(policy) } } as never,
      subject: `${target.kind}:${target.key}`,
      gates: 'the classification label of a piece of content',
      ...(policy.classifier.provider ? { provider: policy.classifier.provider } : {}),
      strictScrub: true,
    });
  const ans = (r.answers?.label ?? {}) as unknown as { value?: unknown; confidence?: unknown };
  return { label: String(ans.value ?? ''), confidence: typeof ans.confidence === 'number' ? ans.confidence : 0, reason: `decision ${r.decision_id}` };
}

async function askLlm(deps: Deps, payer: string, policy: ClassificationPolicy, content: string) {
  const labels = policy.labels.filter(l => l.status === 'active')
    .map(l => `- ${l.id} (rank ${l.rank}): ${l.name.en}. ${l.description}`).join('\n');
  const rules = policy.rules.filter(r => r.enabled && r.kind === 'classifier').map(r => `- ${r.name}: at least ${r.minLabel}`).join('\n');
  const prompt = `You classify how sensitive a piece of content is. Pick exactly one label id from this list; `
    + `when two could fit, pick the more sensitive one.\n${labels}\n${rules ? `Rules the owner wrote:\n${rules}\n` : ''}`
    + `Personal data in the content has been replaced by placeholders such as [EMAIL_1]; a placeholder is evidence that such data was there.\n`
    + `Answer with one JSON object and nothing else: {"label": "<id>", "confidence": <0..1>, "reason": "<one sentence>"}.\n\nCONTENT:\n${content}`;
  const out = await completeForOwner(deps.storage, deps.config, payer, {
    prompt, capability: 'text', appId: 'classification', maxTokens: 300,
    ...(policy.classifier.provider ? { provider: policy.classifier.provider } : {}),
  });
  const m = out.content.match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) as { label?: unknown; confidence?: unknown; reason?: unknown } : {};
  return {
    label: typeof j.label === 'string' ? j.label : '',
    confidence: typeof j.confidence === 'number' ? j.confidence : 0,
    reason: typeof j.reason === 'string' ? j.reason.slice(0, 500) : '',
  };
}

/**
 * Classify one piece of content from its text. With classification off for its scope, nothing is
 * read and nothing is set. `useModel` false runs the rules alone (the free part, on every write).
 */
export async function classifyText(
  deps: Deps, target: ContentLabelTarget, text: string, opts: { useModel?: boolean; queueWhenCapped?: boolean } = {},
): Promise<ClassifyOutcome> {
  if (!(await classificationActiveFor(deps.storage, deps.config, target.scope))) return { by: 'none', skipped: 'OFF' };
  const policy = await policyFor(deps.storage, deps.config, target.scope);
  const out: ClassifyOutcome = { by: 'none' };

  const hit = matchRules(policy, target, text);
  if (hit) {
    const result = await setLabel(deps, nodeActor(deps.config, target, 'rule'), target, { label: hit.label, reason: `detection rule ${hit.rules.join(', ')}` });
    out.by = 'rule';
    out.rule = { label: hit.label, rules: hit.rules, result };
  }
  if (opts.useModel === false) return out;
  if (policy.aiMode === 'off') return { ...out, skipped: 'AI_LABELLING_OFF' };

  // The model reads the content only when its current label lets an AI read it (spec §7).
  try {
    await systemReader(deps, target.scope).useForAi([target], { capability: 'classify' });
  } catch (e) {
    if (e instanceof ClassificationError) return { ...out, skipped: 'HIDDEN_FROM_AI', message: e.message };
    throw e;
  }
  const payer = await payerOf(deps, target.scope);
  if (!payer) return { ...out, skipped: 'FAILED', message: 'Nobody holds this organism, so nobody pays for its classifier.' };
  if (!(await takeCall(deps, policy, target.scope))) {
    if (opts.queueWhenCapped !== false) await enqueue(deps, target);
    return { ...out, skipped: 'CAPPED', message: "Today's classifier calls are used up; the item waits in the queue with its current label." };
  }

  const scrubbed = createScrubber().text(text.slice(0, MAX_CONTENT));
  let answer: { label: string; confidence: number; reason: string };
  try {
    answer = policy.classifier.type === 'llm'
      ? await askLlm(deps, payer, policy, scrubbed)
      : await askJev(deps, payer, policy, target, scrubbed);
  } catch (e) {
    logger.warn(`[classification] classifier failed for ${target.kind}:${target.key}: ${(e as Error).message}`);
    return { ...out, skipped: 'FAILED', message: (e as Error).message };
  }
  const label: ClassificationLabel | undefined = policy.labels.find(l => l.id === answer.label && l.status === 'active');
  if (!label) return { ...out, skipped: 'FAILED', message: `The classifier answered "${answer.label}", which is not an active label.` };
  const result = await setLabel(deps, nodeActor(deps.config, target, 'ai'), target, {
    label: label.id, confidence: answer.confidence, reason: answer.reason || `${policy.classifier.type} classifier`,
  });
  return { ...out, by: out.by === 'rule' ? 'rule' : policy.classifier.type, model: { label: label.id, confidence: answer.confidence, reason: answer.reason, result } };
}

/**
 * Work through the queue within today's caps. `textOf` loads an item's text (null when it is gone).
 * Answers how many were classified and how many are still waiting.
 */
export async function drainQueue(
  deps: Deps, textOf: (item: QueuedItem) => Promise<string | null>, max = 200,
): Promise<{ done: number; waiting: number }> {
  const q = await readQueue(deps.storage, deps.config.nodeId);
  const keep: QueuedItem[] = [];
  let done = 0;
  for (const item of q) {
    if (done >= max) { keep.push(item); continue; }
    const text = await textOf(item);
    if (text === null) continue;
    const out = await classifyText(deps, { kind: item.kind, scope: item.scope, key: item.key }, text, { queueWhenCapped: false });
    if (out.skipped === 'CAPPED') { keep.push(item); continue; }
    done += 1;
  }
  if (q.length) await writeSystem(deps.storage, `system@${deps.config.nodeId}`, QUEUE_KEY, keep);
  return { done, waiting: keep.length };
}
