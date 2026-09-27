/**
 * @file thread-titles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolve task-linked thread titles for list and overview responses.
 * @structure enrichThreadTitles
 * @version-history 1.0.0 2026-09-27 Extract the existing shared projection.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export async function enrichThreadTitles<T extends { threadId: string }>(
  storage: Pick<Storage, 'getAgentTask'>,
  threads: T[],
): Promise<Array<T & { title: string | null; linkedTaskId: string | null }>> {
  const taskCache = new Map<string, string | null>();
  const resolveTaskTitle = async (threadId: string): Promise<string | null> => {
    if (taskCache.has(threadId)) return taskCache.get(threadId) ?? null;
    const task = await storage.getAgentTask(threadId).catch(err => { logger.warn('resolveTaskTitle: continuing after a suppressed failure', { error: String(err) }); return null; });
    const title = task?.title ?? null;
    taskCache.set(threadId, title);
    return title;
  };
  return Promise.all(threads.map(async (thread) => {
    const title = await resolveTaskTitle(thread.threadId);
    return { ...thread, title, linkedTaskId: title !== null ? thread.threadId : null };
  }));
}

