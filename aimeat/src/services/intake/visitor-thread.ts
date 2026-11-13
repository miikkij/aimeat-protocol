/**
 * @file src/services/intake/visitor-thread.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage side of a conversation through a public intake form: the form that takes
 *   a conversation, the live copy of one of its records, and the conversation a visitor's token opens.
 *   The pure part (the token, the record shapes, the settings) is services/intake-thread.ts.
 *
 *   These were local functions of routes/organisms/intake-thread.ts until 2026-11-05. The visitor's
 *   token is now verified in the auth layer ('intake-visitor', src/auth/credential-strategies.ts), and
 *   the routes and the strategy read the same form and the same record with the functions here
 *   (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 * @structure ThreadFormConfig · ThreadForm · readThreadForm() · latestThreadRecord() · VisitorThread · visitorThread()
 * @usage
 *   const cfg = await readThreadForm(storage, nodeId, org, ws, formId);   // null: unknown, off, or an ordinary form
 *   const opened = await visitorThread(storage, nodeId, { org, ws, formId }, token);   // null: no conversation opens
 * @version-history
 *   v1.1.0 — 2026-11-08 — readThreadForm takes the form's owner from the identity that stored the config
 *     record, so a conversation form writes its thread and signal records as that identity, not as an
 *     account the config value names (./form-owner.ts; secaudit2026nov08b round 15,
 *     routes/organisms/intake:form-config-ownerGhii-trusted-from-stored-value).
 *   v1.0.0 — 2026-11-05 — Moved out of routes/organisms/intake-thread.ts unchanged (codebase analysis
 *     2026-11-03, decision 2 of 2026-11-05).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { readWorkspaceMetaRecord } from '../workspace/meta-read.js';
import { threadIdOf, type IntakeThreadConfig } from '../intake-thread.js';
import { formConfigOfRecord } from './form-owner.js';

/** The part of a form's stored config the conversation routes read (routes/organisms/intake.ts writes it). */
export interface ThreadFormConfig {
  formId: string; namespace: string; ownerGhii: string; enabled: boolean;
  honeypotField: string | null; maxPerDay: number | null; thread?: IntakeThreadConfig | null;
}

/** A form that takes a conversation. */
export type ThreadForm = ThreadFormConfig & { thread: IntakeThreadConfig };

/** A form that takes a conversation, or null: unknown, switched off, or an ordinary form. */
export async function readThreadForm(storage: Storage, nodeId: string, org: string, ws: string, formId: string): Promise<ThreadForm | null> {
  // The form's owner is the identity that stored the config record (./form-owner.ts).
  const cfg = formConfigOfRecord<ThreadFormConfig>(await readWorkspaceMetaRecord(storage, org, ws, `meta.intake.${formId}`, nodeId));
  return cfg && cfg.enabled && cfg.thread ? cfg as ThreadForm : null;
}

/** The live value of one record, the freshest copy when more than one owner holds it. */
export async function latestThreadRecord(storage: Storage, org: string, ws: string, namespace: string, id: string): Promise<MemoryRecord | null> {
  const key = `organism.${org}.w.${ws}.${namespace}.${id}.latest`;
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  return items.filter((r) => r.key === key).reduce<MemoryRecord | null>((best, r) => (!best || r.updatedAt > best.updatedAt ? r : best), null);
}

/** The conversation a visitor's token opens on one form. */
export interface VisitorThread {
  org: string; ws: string; formId: string;
  form: ThreadForm;
  /** The record id, the hash of the token. */
  threadId: string;
  /** The live thread record. */
  thread: MemoryRecord;
}

/**
 * The conversation `token` opens on the form `formId`, or null for an unknown form, a form that takes
 * no conversation, anything that is not a token, an unknown token, and another form's conversation:
 * one answer for all of them, so a token opens nothing but its own conversation.
 */
export async function visitorThread(
  storage: Storage, nodeId: string, at: { org: string; ws: string; formId: string }, token: unknown,
): Promise<VisitorThread | null> {
  const { org, ws, formId } = at;
  const form = await readThreadForm(storage, nodeId, org, ws, formId);
  const threadId = threadIdOf(token);
  const thread = form && threadId ? await latestThreadRecord(storage, org, ws, form.namespace, threadId) : null;
  if (!form || !threadId || !thread || (thread.value as { form_id?: unknown } | null)?.form_id !== formId) return null;
  return { org, ws, formId, form, threadId, thread };
}
