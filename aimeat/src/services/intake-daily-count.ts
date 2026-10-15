/**
 * @file src/services/intake-daily-count.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The daily cap of a public intake form: how many submissions one form has taken
 *   today, and whether it takes one more.
 *
 *   WHY IT EXISTS. A form's config has carried `maxPerDay` since the first version
 *   (routes/organisms/intake.ts), and until 2026-10-13 nothing read it: an owner who set
 *   `max_per_day: 200` had a form that took whatever the per-IP limit let through, from any number
 *   of addresses. The per-IP limit bounds one sender; this bounds the form, which is what protects
 *   the owner's workspace, and the model allowance of an agent that every new record wakes.
 *
 *   ONE RECORD PER FORM, in the node's own namespace, holding the day and the count; a new day
 *   starts the count again in the same record, so the key count does not grow with time. The day is
 *   the UTC date. The read, the compare and the write run one after another per node, so two
 *   submissions that arrive together cannot both take the last slot.
 * @structure takeDailySlot(storage, nodeId, form, max) · releaseDailySlot(storage, nodeId, form) ·
 *   forgetDailyCount(storage, nodeId, form)
 * @usage if (cfg.maxPerDay && !(await takeDailySlot(storage, nodeId, { org, ws, formId }, cfg.maxPerDay))) refuse 429
 * @version-history
 *   2026-10-15 — releaseDailySlot(): a submission whose write failed gives its slot back
 *     (feature-list audit #63).
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { Storage } from '../storage/interface.js';

export interface IntakeFormRef { org: string; ws: string; formId: string }

const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;
const countKey = (f: IntakeFormRef): string => `intake.count.${f.org}.${f.ws}.${f.formId}`;
const today = (): string => new Date().toISOString().slice(0, 10);

/** One chain per node: a count is read, compared and written before the next one is read. */
const chains = new Map<string, Promise<unknown>>();
function inOrder<T>(nodeId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(nodeId) ?? Promise.resolve()).then(fn, fn);
  // The caller gets a failure through `next`. The chain only waits for the step to end, either way.
  const ended = (): void => undefined;
  chains.set(nodeId, next.then(ended, ended));
  return next;
}

/**
 * Take one of the form's submissions for today. True, and the count is one higher; or false when
 * the form has already taken `max` today, and nothing changes.
 */
export function takeDailySlot(storage: Storage, nodeId: string, form: IntakeFormRef, max: number): Promise<boolean> {
  return inOrder(nodeId, async () => {
    const systemGhii = systemGhiiFor(nodeId);
    const key = countKey(form);
    const existing = await storage.getMemory(systemGhii, key);
    const held = existing?.value as { day?: string; n?: number } | undefined;
    const day = today();
    const taken = held?.day === day && typeof held.n === 'number' ? held.n : 0;
    if (taken >= max) return false;
    const now = new Date().toISOString();
    await storage.setMemory({
      key, ownerGaii: systemGhii, value: { day, n: taken + 1 },
      visibility: 'private', tags: ['intake-count'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    return true;
  });
}

/**
 * Give back one of today's slots: the submission that took it was then not stored, so it spends
 * none of the form's day (feature-list audit #63). A count from an earlier day, or already at 0,
 * is left as it is.
 */
export function releaseDailySlot(storage: Storage, nodeId: string, form: IntakeFormRef): Promise<void> {
  return inOrder(nodeId, async () => {
    const systemGhii = systemGhiiFor(nodeId);
    const key = countKey(form);
    const existing = await storage.getMemory(systemGhii, key);
    const held = existing?.value as { day?: string; n?: number } | undefined;
    if (!existing || held?.day !== today() || typeof held.n !== 'number' || held.n <= 0) return;
    await storage.setMemory({
      ...existing, value: { day: held.day, n: held.n - 1 },
      version: existing.version + 1, updatedAt: new Date().toISOString(),
    });
  });
}

/** A deleted form's count goes with it. */
export function forgetDailyCount(storage: Storage, nodeId: string, form: IntakeFormRef): Promise<void> {
  return inOrder(nodeId, async () => {
    await storage.deleteMemory(systemGhiiFor(nodeId), countKey(form));
  });
}
