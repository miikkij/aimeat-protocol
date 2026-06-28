/**
 * @file secretary-clarify.ts
 * @description The Secretary "ask-don't-hallucinate" clarify channel — PRODUCE side. When the Secretary
 *   (or a specialist) needs facts it asks the owner a batch of structured questions in the inbox and
 *   records a `secretary.clarify.<id>` job (status 'asked'; created by routes/secretary.ts). Once the
 *   owner answers, the deliverable is produced grounded ONLY in the stored facts + those answers, filed
 *   into the job's workspace, surfaced in the feed, AND — crucially — replied back into the SAME inbox
 *   thread so the owner sees what happened (no more "I answered and nothing came back"). Shared by the
 *   autonomous tick (scheduler.resumeClarifyJobs) and the live DM responder so both paths behave the same.
 * @structure ClarifyJob · ClarifyAnswers · renderClarifyAnswers() · findPendingClarifyJob() ·
 *   produceClarifyDeliverable()
 * @usage const { writes, produced } = await produceClarifyDeliverable(ctx, { ownerGhii, ownerName, agentGaii, job, answers });
 * @version-history
 *   v1.0.0 — 2026-06-28 — Extracted produce from scheduler + added the in-thread outcome reply (feedback fix).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import { completeForOwner } from './ai-completion.js';
import { sendDirectMessage } from './message-send.js';
import { appendSecretaryFeed } from './secretary-feed.js';

/** A clarify question (subset used for rendering the produce prompt). */
export interface ClarifyQuestion {
  id: string;
  prompt: string;
  options?: Array<{ id: string; label: string }>;
}

/** The owner's answers to a clarify question set (keyed by question id). */
export type ClarifyAnswers = Record<string, { selected?: string[]; other?: string | null }>;

/** A persisted `secretary.clarify.<id>` job. */
export interface ClarifyJob {
  id: string;
  conversationId: string;
  questionId: string;
  questions?: ClarifyQuestion[];
  action?: { summary?: string; why?: string };
  facts?: string;
  contextId?: string;
  contextName?: string;
  organismId?: string;
  wsId?: string;
  status?: string;
  createdAt?: string;
}

/** Render the owner's interactive answers as readable text for the produce prompt. */
export function renderClarifyAnswers(questions: ClarifyQuestion[] | undefined, answers: ClarifyAnswers): string {
  return (questions || []).map((q) => {
    const a = answers[q.id] || {};
    const labels = (a.selected || []).map((sid) => (q.options || []).find((o) => o.id === sid)?.label || sid);
    const parts = [...labels];
    if (a.other) parts.push(String(a.other));
    return `- ${q.prompt} → ${parts.join(', ') || '(no answer)'}`;
  }).join('\n');
}

/** Find the owner's pending ('asked') clarify job for a conversation (optionally a specific questionId). */
export async function findPendingClarifyJob(
  storage: Storage, ownerGhii: string, conversationId: string, questionId?: string,
): Promise<ClarifyJob | null> {
  const recs = await storage.listMemory(ownerGhii, { prefix: 'secretary.clarify.' }).catch(() => []);
  for (const r of recs) {
    const j = (r.value ?? {}) as ClarifyJob;
    if (j.status !== 'asked') continue;
    if (j.conversationId !== conversationId) continue;
    if (questionId && j.questionId !== questionId) continue;
    return j;
  }
  return null;
}

export interface ProduceClarifyParams {
  ownerGhii: string;
  ownerName: string;
  /** The agent that asked (sends the outcome reply back as itself): `secretary#owner@node` / specialist GAII. */
  agentGaii: string;
  job: ClarifyJob;
  answers: ClarifyAnswers;
}

/**
 * Produce the deliverable for an answered clarify job: AI-complete on the owner's key grounded in the
 * facts + answers, file it into the job's workspace (when one is set), append a feed entry, reply the
 * outcome back into the inbox thread, and mark the job done. On AI failure the job is LEFT 'asked' (so the
 * tick retries) and no outcome reply is sent. Returns the memory keys written + whether it produced.
 */
export async function produceClarifyDeliverable(
  ctx: DeliveryCtx, params: ProduceClarifyParams,
): Promise<{ writes: string[]; produced: boolean }> {
  const { storage, config } = ctx;
  const { ownerGhii, ownerName, agentGaii, job, answers } = params;
  const writes: string[] = [];

  const action = job.action ?? {};
  const answersText = renderClarifyAnswers(job.questions, answers);
  const sys = `You are ${ownerName}'s personal Secretary. Produce the deliverable the owner asked for as a usable DRAFT, grounded ONLY in the facts and the owner's answers below. Never invent numbers, metrics, quotes, names, dates, events, or outcomes; if something is still unknown, use a [bracketed placeholder]. Markdown is fine. Output only the deliverable, no preamble.`;
  const prompt = `Task: ${action.summary || ''}${action.why ? `\n(${action.why})` : ''}\n\nFacts:\n${job.facts || '(none)'}\n\nThe owner answered your questions:\n${answersText}`;

  let content = action.summary || '';
  try {
    const r = await completeForOwner(storage, config, ownerGhii, { prompt, systemPrompt: sys, appId: 'secretary-clarify-produce' });
    content = (r?.content || '').trim() || content;
  } catch {
    return { writes, produced: false };   // spending paused / error → leave 'asked' to retry next tick
  }

  const now = new Date().toISOString();
  const organismId = job.organismId;
  const wsId = job.wsId;
  let href: string | undefined;
  if (organismId && wsId) {
    const noteId = 'note-' + randomUUID().slice(0, 8);
    const key = `organism.${organismId}.w.${wsId}.notes.${noteId}`;
    await storage.setMemory({
      key, ownerGaii: ownerGhii, value: { id: noteId, title: String(action.summary || '').slice(0, 80), body: content, createdAt: now, via: 'secretary-clarify' },
      visibility: 'private', tags: ['secretary', 'note', String(job.contextId || '')], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    href = `/v1/profile?tab=organisms&org=${organismId}&ws=${wsId}`;
    await appendSecretaryFeed(storage, ownerGhii, {
      kind: 'act', contextId: String(job.contextId || ''), contextName: String(job.contextName || ''),
      text: `✍️ ${action.summary || ''} — filed after your answers`, href,
    });
    writes.push(key, 'secretary.feed');
  }

  // The feedback the owner was missing: reply the outcome straight back into the inbox thread, so
  // answering a clarify question visibly leads somewhere instead of vanishing.
  const savedLine = href ? `\n\n_Saved to your workspace._` : '';
  await sendDirectMessage(ctx, {
    senderGhii: agentGaii,
    recipientGhii: ownerGhii,
    conversationId: job.conversationId,
    body: `✅ Done — I used your answers to produce **${action.summary || 'the deliverable'}**:\n\n${content}${savedLine}`,
    skipContactGate: true,
  }).catch(() => { /* the note + feed already landed; a failed reply must not roll those back */ });

  const jobKey = `secretary.clarify.${job.id}`;
  await storage.setMemory({
    key: jobKey, ownerGaii: ownerGhii, value: { ...job, status: 'done', producedAt: now },
    visibility: 'private', tags: ['secretary', 'clarify', 'done'], ttlHours: null, version: 1, createdAt: String(job.createdAt || now), updatedAt: now,
  });
  writes.push(jobKey);
  return { writes, produced: true };
}
