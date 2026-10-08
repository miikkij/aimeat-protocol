/**
 * @file message-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance of direct messages: which model wrote a message, resolved for a page
 *   of messages in one query, and the record a send mints.
 *
 *   READING. Every message already carries `aiProvenanceId` (TARGET-058), and the record behind it
 *   holds the generator — but the messaging surfaces returned only the id, so reading a thread told
 *   you an AI had written something and never which AI. That is the fact a person actually wants
 *   when an agent answers them, and the one an operator wants when triaging a support thread: a
 *   report from a capable model and a report from a weak one need different amounts of trust, and
 *   until now nothing on the screen distinguished them. `getAiProvenanceMany` means a thread costs
 *   ONE extra query rather than one per message.
 *
 *   SENDING. Every route and MCP tool that sends a message (POST /v1/messages, POST
 *   /v1/messages/broadcast, aimeat_dm_send, aimeat_dm_send_as_owner, aimeat_dm_ask,
 *   aimeat_dm_broadcast) mints through the two functions below, so two rules are written once:
 *     - WHAT IS HASHED. The body, and when the message asks structured questions, the questions as
 *       well, because the framing and the options are what a person reads and chooses between. The
 *       REST send hashed the body alone while aimeat_dm_ask hashed body and questions, so the same
 *       question sent through two routes carried two different hashes (aiprov D14).
 *     - WHEN IT IS STORED. The record is minted held and stored only when the send lands. The send
 *       routes minted it before the send's own refusals (an unknown recipient, a blocked contact, a
 *       missing attachment), and the store is append-only, so each refusal left a record about a
 *       message nobody received (aiprov D11). The scope refusal is still heard before anything.
 * @structure
 *   withMessageProvenance(storage, messages) → the same messages, each with `ai` attached
 *   messageProvenanceContent(body, interactive) → the text a message's record describes
 *   mintMessageProvenance(deps, input) → { id, held, store() }
 * @usage
 *   const enriched = await withMessageProvenance(storage, thread.messages);
 *   const prov = await mintMessageProvenance({ storage, config }, { principal, body, interactive, pipeline: 'rest.messages_send' });
 *   const sent = await sendDirectMessage(ctx, { ..., aiProvenanceId: prov.id });
 *   if (sent.ok) await prov.store();
 * @version-history
 *   v1.1.0 — 2026-10-08 — messageProvenanceContent() and mintMessageProvenance(): one hash rule and a
 *     held mint for every message send (aiprov D5, D11, D14). withMessageProvenance() also attaches
 *     the reader's item block when it is given the config (aiprov D6): a private message's record
 *     answers 404 at /v1/provenance/:id for everyone but its owner, so the recipient reads it here.
 *   v1.0.0 — 2026-08-11 — Initial: surface the writing model on messaging reads.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord, AiProvenanceRecordRow } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { provenanceForWrite, storeHeldProvenance, type DeclaredProvenance } from './ai-provenance.js';
import { servedProvenanceOf, provenanceItemBlock, type AiProvenanceItemBlock } from './ai-provenance-marks.js';

/**
 * What a reader is told about how a message was written.
 *
 * `model` is SELF-REPORTED by the agent (identify_platform) unless the write declared its own, and
 * `observed` says which: false means the node inferred "an AI wrote this" from who was holding the
 * pen and took the model's name on trust. Rendering it without that distinction would turn a claim
 * into a measurement.
 */
export interface MessageAiSummary {
  level: string;
  model?: string;
  provider?: string;
  observed: boolean;
}

type WithAi<T> = T & { ai?: MessageAiSummary } & Partial<AiProvenanceItemBlock>;

/**
 * Attach the provenance summary to each message that has one. Messages without an id come back
 * untouched: absent provenance is UNSTATED, never "a human wrote it", so inventing a summary for
 * them would be the one false statement this whole subsystem exists to prevent.
 *
 * With `config`, each message also gets `ai_provenance` ({ id, record, record_url }), the block every
 * other read surface carries. Whoever may read the message may know how it was made, and the record
 * of a private message resolves nowhere else for its recipient.
 *
 * Best-effort by design — a provenance read that fails must not fail the inbox.
 */
export async function withMessageProvenance<T extends Pick<DirectMessageRecord, 'aiProvenanceId'>>(
  storage: Storage,
  messages: T[],
  config?: AimeatConfig,
): Promise<WithAi<T>[]> {
  const ids = [...new Set(messages.map(m => m.aiProvenanceId).filter((id): id is string => !!id))];
  if (!ids.length) return messages;

  let byId = new Map<string, MessageAiSummary>();
  const rowsById = new Map<string, AiProvenanceRecordRow>();
  try {
    const rows = await storage.getAiProvenanceMany(ids);
    for (const row of rows) rowsById.set(row.id, row);
    byId = new Map(rows.map(row => {
      const record = row.record as { level?: string; generator?: { model?: string; provider?: string }; attestation?: { observed?: boolean } };
      const summary: MessageAiSummary = {
        level: record.level ?? 'ai-generated',
        observed: record.attestation?.observed === true,
      };
      if (record.generator?.model) summary.model = record.generator.model;
      if (record.generator?.provider) summary.provider = record.generator.provider;
      return [row.id, summary] as const;
    }));
  } catch (err) {
    logger.warn('withMessageProvenance: continuing without provenance', { error: String(err) });
    return messages;
  }

  return messages.map(m => {
    const summary = m.aiProvenanceId ? byId.get(m.aiProvenanceId) : undefined;
    if (!summary) return m;
    const row = config && m.aiProvenanceId ? rowsById.get(m.aiProvenanceId) : undefined;
    return { ...m, ai: summary, ...(row && config ? provenanceItemBlock(servedProvenanceOf(config, row)) : {}) };
  });
}

/** The questions a message asks, whatever shape the caller holds them in. */
type QuestionsCarrier = { role: string; questions?: readonly unknown[] } | undefined | null;

/** The exact text a message's record describes: the body, plus the questions when it asks any. */
export function messageProvenanceContent(body: string | undefined, interactive?: QuestionsCarrier): string {
  const questions = interactive?.role === 'questions' ? interactive.questions : undefined;
  return questions?.length ? `${body ?? ''}\n\n${JSON.stringify(questions)}` : (body ?? '');
}

export interface MessageProvenanceInput {
  /** The resolved identity that wrote the words (for send-as-owner, the acting agent). */
  principal: string;
  /** The session's own scopes, when the caller has them. */
  scopes?: readonly string[];
  body?: string;
  interactive?: QuestionsCarrier;
  declaredId?: string;
  declared?: DeclaredProvenance;
  pipeline: string;
}

/**
 * Mint a message's record without storing it. `id` goes on the message; `store()` writes the record
 * once the send has landed, and a refused send simply never calls it. Throws ProvenanceScopeError
 * for a declaration the caller may not make, before anything is written.
 */
export async function mintMessageProvenance(
  deps: { storage: Storage; config: AimeatConfig },
  input: MessageProvenanceInput,
): Promise<{ id: string | undefined; held: AiProvenanceRecordRow[]; store: () => Promise<void> }> {
  const { storage, config } = deps;
  const held: AiProvenanceRecordRow[] = [];
  const id = await provenanceForWrite(storage, {
    principal: input.principal,
    scopes: input.scopes,
    content: messageProvenanceContent(input.body, input.interactive),
    declaredId: input.declaredId,
    declared: input.declared,
    pipeline: input.pipeline,
    // A message is never public, but it IS delivered to a person, which is what decides whether a
    // label is owed.
    surface: { visibility: 'private', humanAudience: true },
    labelPolicy: config.aiLabelPublic,
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
    enabled: config.aiProvenance,
    held,
  });
  return { id, held, store: () => storeHeldProvenance(storage, held) };
}
