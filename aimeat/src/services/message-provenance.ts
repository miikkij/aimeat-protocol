/**
 * @file message-provenance.ts
 * @description Which model wrote a message, resolved for a page of messages in one query.
 *
 *   Every message already carries `aiProvenanceId` (TARGET-058), and the record behind it holds the
 *   generator — but the messaging surfaces returned only the id, so reading a thread told you an AI
 *   had written something and never which AI. That is the fact a person actually wants when an agent
 *   answers them, and the one an operator wants when triaging a support thread: a report from a
 *   capable model and a report from a weak one need different amounts of trust, and until now
 *   nothing on the screen distinguished them.
 *
 *   `getAiProvenanceMany` means a thread costs ONE extra query rather than one per message.
 * @structure withMessageProvenance(storage, messages) → the same messages, each with `ai` attached
 * @usage const enriched = await withMessageProvenance(storage, thread.messages);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: surface the writing model on messaging reads.
 */
import type { Storage, DirectMessageRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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

type WithAi<T> = T & { ai?: MessageAiSummary };

/**
 * Attach the provenance summary to each message that has one. Messages without an id come back
 * untouched: absent provenance is UNSTATED, never "a human wrote it", so inventing a summary for
 * them would be the one false statement this whole subsystem exists to prevent.
 *
 * Best-effort by design — a provenance read that fails must not fail the inbox.
 */
export async function withMessageProvenance<T extends Pick<DirectMessageRecord, 'aiProvenanceId'>>(
  storage: Storage,
  messages: T[],
): Promise<WithAi<T>[]> {
  const ids = [...new Set(messages.map(m => m.aiProvenanceId).filter((id): id is string => !!id))];
  if (!ids.length) return messages;

  let byId = new Map<string, MessageAiSummary>();
  try {
    const rows = await storage.getAiProvenanceMany(ids);
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
    return summary ? { ...m, ai: summary } : m;
  });
}
