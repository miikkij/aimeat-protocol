/**
 * @file src/services/intake-thread-retention.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The retention of a conversation through a public intake form: the node deletes the
 *   thread, the reply and the signal records of a conversation once the form's keeping time
 *   (`ttl_days`, counted from the visitor's last turn) has passed, on a scheduled job, whatever
 *   state the form is in.
 *
 *   WHY A SCHEDULED JOB AND A REGISTRY. A visitor's conversation is personal data, and the form
 *   promised the visitor a date. Until 2026-10-15 the deletion ran only when a new conversation
 *   started on the same form (routes/organisms/intake-thread.ts), so a form nobody wrote to kept
 *   everything, and a form the owner switched off or deleted could never start a deletion again:
 *   its config, which names the three spaces and the keeping time, was gone with it (feature-list
 *   audit #64). The registry is one record in the node's own namespace that remembers, for every
 *   conversation form, where its records live and how long they are kept. It outlives the form,
 *   and an entry is dropped only when the form is gone and none of its conversations remain.
 *
 *   WHO WRITES THE REGISTRY. Defining a conversation form (POST /v1/intake/forms) and deleting one
 *   (DELETE /v1/intake/forms) upsert its entry; the first run of the scheduled job looks through
 *   every organism's workspaces once for forms defined before the registry existed.
 * @structure
 *   ThreadFormEntry · registerThreadForm() · forgetThreadRecords() · deleteExpiredThreads() ·
 *   runIntakeThreadRetention() (the core:intake-thread-retention scheduled job)
 * @usage
 *   await registerThreadForm(storage, nodeId, { org, ws, formId, namespace, replyNamespace, signalNamespace, ttlDays });
 *   const removed = await runIntakeThreadRetention(storage, nodeId);
 * @version-history
 *   2026-10-15 — Initial: deletion by date on a scheduled job, and the registry that outlives the
 *     form (feature-list audit #64).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { readWorkspaceMetaRecord, workspaceRegistrations } from './workspace-meta-read.js';
import { threadIsExpired, type IntakeThreadConfig } from './intake-thread.js';
import { logger } from '../utils/logger.js';

/** Where one conversation form keeps its records, and for how long. */
export interface ThreadFormEntry {
  org: string; ws: string; formId: string;
  namespace: string; replyNamespace: string; signalNamespace: string;
  ttlDays: number;
}

interface Registry { backfilledAt?: string; forms: Record<string, ThreadFormEntry> }

const REGISTRY_KEY = 'intake.thread-forms';
const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;
/** One entry per form and thread space: a form redefined onto another space keeps the old entry until it empties. */
const entryKey = (e: Pick<ThreadFormEntry, 'org' | 'ws' | 'formId' | 'namespace'>): string => `${e.org}/${e.ws}/${e.formId}/${e.namespace}`;
/** The most conversations one entry deletes in one run; the next run continues. */
const DELETE_MAX_PER_ENTRY = 500;

/** One chain per node: the registry is read, changed and written before the next change reads it. */
const chains = new Map<string, Promise<unknown>>();
function inOrder<T>(nodeId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(nodeId) ?? Promise.resolve()).then(fn, fn);
  const ended = (): void => undefined;
  chains.set(nodeId, next.then(ended, ended));
  return next;
}

async function readRegistry(storage: Storage, nodeId: string): Promise<{ registry: Registry; existing: MemoryRecord | null }> {
  const existing = await storage.getMemory(systemGhiiFor(nodeId), REGISTRY_KEY);
  const value = existing?.value as Partial<Registry> | undefined;
  const forms = value?.forms && typeof value.forms === 'object' ? value.forms : {};
  return { registry: { ...(value?.backfilledAt ? { backfilledAt: value.backfilledAt } : {}), forms: { ...forms } }, existing };
}

async function writeRegistry(storage: Storage, nodeId: string, registry: Registry, existing: MemoryRecord | null): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: REGISTRY_KEY, ownerGaii: systemGhiiFor(nodeId), value: registry as unknown as Record<string, unknown>,
    visibility: 'private', tags: ['intake-thread-retention'], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** The entry a stored form config describes, or null for a form that takes no conversation. */
export function entryOfFormConfig(org: string, ws: string, cfg: { formId?: unknown; namespace?: unknown; thread?: IntakeThreadConfig | null } | null | undefined): ThreadFormEntry | null {
  if (!cfg || !cfg.thread || typeof cfg.formId !== 'string' || typeof cfg.namespace !== 'string') return null;
  return {
    org, ws, formId: cfg.formId, namespace: cfg.namespace,
    replyNamespace: cfg.thread.replyNamespace, signalNamespace: cfg.thread.signalNamespace, ttlDays: cfg.thread.ttlDays,
  };
}

/** Add or refresh a conversation form's entry. Called where a form is defined and where it is deleted. */
export function registerThreadForm(storage: Storage, nodeId: string, entry: ThreadFormEntry): Promise<void> {
  return inOrder(nodeId, async () => {
    const { registry, existing } = await readRegistry(storage, nodeId);
    const key = entryKey(entry);
    if (JSON.stringify(registry.forms[key]) === JSON.stringify(entry)) return;
    registry.forms[key] = entry;
    await writeRegistry(storage, nodeId, registry, existing);
  });
}

const baseKey = (org: string, ws: string, namespace: string, id: string): string => `organism.${org}.w.${ws}.${namespace}.${id}`;

/** Delete one conversation: the thread, the reply and the signal, with every version and copy of each. */
export async function forgetThreadRecords(storage: Storage, entry: Omit<ThreadFormEntry, 'formId' | 'ttlDays'>, id: string): Promise<number> {
  let deleted = 0;
  for (const namespace of [entry.namespace, entry.replyNamespace, entry.signalNamespace]) {
    const base = baseKey(entry.org, entry.ws, namespace, id);
    const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
    for (const row of items.filter((r) => r.key.startsWith(`${base}.`))) {
      await storage.deleteMemory(row.ownerGaii, row.key);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Delete the entry's conversations past its keeping time. Answers how many were deleted and how
 * many of the form's conversations remain, so the caller knows whether an entry of a gone form
 * may be dropped.
 */
export async function deleteExpiredThreads(storage: Storage, entry: ThreadFormEntry, nowMs: number): Promise<{ deleted: number; remaining: number }> {
  const prefix = `organism.${entry.org}.w.${entry.ws}.${entry.namespace}.`;
  const { items } = await storage.listAllMemory({ prefix, limit: 20000, excludeVersionRows: true });
  const ofForm = items.filter((r) => r.key.endsWith('.latest') && (r.value as { form_id?: unknown } | null)?.form_id === entry.formId);
  const expired = ofForm.filter((r) => threadIsExpired(r.value, nowMs, entry.ttlDays)).slice(0, DELETE_MAX_PER_ENTRY);
  // One conversation can have a .latest copy under more than one owner: one id, one deletion.
  const ids = [...new Set(expired.map((r) => r.key.slice(prefix.length, -'.latest'.length)))];
  for (const id of ids) await forgetThreadRecords(storage, entry, id);
  const remainingIds = new Set(ofForm.map((r) => r.key.slice(prefix.length, -'.latest'.length)));
  for (const id of ids) remainingIds.delete(id);
  return { deleted: ids.length, remaining: remainingIds.size };
}

/** Every conversation form on the node, found by reading each organism's workspaces once. */
async function discoverThreadForms(storage: Storage): Promise<ThreadFormEntry[]> {
  const found: ThreadFormEntry[] = [];
  const organisms = await storage.listOrganisms({ perPage: Number.MAX_SAFE_INTEGER, archived: 'include' });
  for (const org of organisms) {
    for (const ws of (await workspaceRegistrations(storage, org.id)).keys()) {
      const prefix = `organism.${org.id}.w.${ws}.meta.intake.`;
      const { items } = await storage.listAllMemory({ prefix, limit: 500 });
      for (const r of items) {
        if (r.key.slice(prefix.length).includes('.')) continue;
        const entry = entryOfFormConfig(org.id, ws, r.value as Parameters<typeof entryOfFormConfig>[2]);
        if (entry) found.push(entry);
      }
    }
  }
  return found;
}

/**
 * The scheduled job core:intake-thread-retention. For every registered conversation form: refresh
 * its entry from the form's config while the form exists, delete its expired conversations, and
 * drop the entry once the form is gone and nothing of it remains. Answers how many conversations
 * were deleted.
 */
export async function runIntakeThreadRetention(storage: Storage, nodeId: string, nowMs = Date.now()): Promise<number> {
  // The first run finds the forms defined before the registry existed.
  const first = await readRegistry(storage, nodeId);
  if (!first.registry.backfilledAt) {
    const discovered = await discoverThreadForms(storage);
    await inOrder(nodeId, async () => {
      const { registry, existing } = await readRegistry(storage, nodeId);
      for (const e of discovered) registry.forms[entryKey(e)] ??= e;
      registry.backfilledAt = new Date(nowMs).toISOString();
      await writeRegistry(storage, nodeId, registry, existing);
    });
  }

  const { registry } = await readRegistry(storage, nodeId);
  let deletedTotal = 0;
  const refreshed: Record<string, ThreadFormEntry> = {};
  const dropped: string[] = [];
  for (const [key, held] of Object.entries(registry.forms)) {
    try {
      // While the form exists with this thread space, its config is what counts: the owner may
      // have changed the keeping time since the entry was written.
      const cfgRec = await readWorkspaceMetaRecord(storage, held.org, held.ws, `meta.intake.${held.formId}`, nodeId);
      const current = entryOfFormConfig(held.org, held.ws, cfgRec?.value as Parameters<typeof entryOfFormConfig>[2]);
      const live = current && current.namespace === held.namespace ? current : null;
      const entry = live ?? held;
      if (live && JSON.stringify(live) !== JSON.stringify(held)) refreshed[key] = live;
      const { deleted, remaining } = await deleteExpiredThreads(storage, entry, nowMs);
      deletedTotal += deleted;
      if (deleted) logger.info('Intake thread retention: expired conversations deleted', { event: 'intake.thread_expired', org: entry.org, ws: entry.ws, form: entry.formId, count: deleted });
      if (!live && remaining === 0) dropped.push(key);
    } catch (err) {
      logger.warn('Intake thread retention: one form was skipped this run', { org: held.org, ws: held.ws, form: held.formId, error: String(err) });
    }
  }
  if (Object.keys(refreshed).length || dropped.length) {
    await inOrder(nodeId, async () => {
      const { registry: now, existing } = await readRegistry(storage, nodeId);
      for (const [key, e] of Object.entries(refreshed)) if (now.forms[key]) now.forms[key] = e;
      // An entry written again since this run read it is a form defined again: it stays.
      for (const key of dropped) if (JSON.stringify(now.forms[key]) === JSON.stringify(registry.forms[key])) delete now.forms[key];
      await writeRegistry(storage, nodeId, now, existing);
    });
  }
  return deletedTotal;
}
