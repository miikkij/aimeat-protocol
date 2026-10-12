/**
 * @file src/services/workflow/engine-coalesce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The events that wait for a run to end. A workflow whose trigger sets `coalesce`
 *   starts ONE more run when its in-flight run ends, for every event that arrived meanwhile; this
 *   module keeps what waits.
 *
 *   WHY. One live run per workflow is the default (engine.ts, the overlap guard), and a start that
 *   meets a live run starts nothing. For a schedule that is right: the next tick comes anyway. For
 *   an event it loses work: three messages arrive while the first is handled, and the workflow
 *   never learns of them. `parallel` is the other answer and it is the wrong one for an agent that
 *   reads "everything new": three runs do the same reading three times. Folding gives one run that
 *   knows how many events it stands for and when the first one happened.
 *
 *   ONE ENTRY PER OWNER AND WORKFLOW, in the node's own namespace beside the active-run index
 *   (lifecycle.ts), because the run that ends may end after a restart. The record is read, changed
 *   and written, so every change goes through one chain per node: two events that arrive together
 *   fold into one entry instead of one of them overwriting the other.
 *
 *   IT IS THE AUTHOR'S CHOICE, NOT THE DEFAULT. A workflow whose own step writes what its trigger
 *   matches would start itself again for ever, where today its second start is dropped. So an event
 *   waits only where the definition says `coalesce: true`.
 * @structure
 *   - holdEvent(storage, nodeId, ownerGhii, workflowId, event)
 *   - takeWaitingEvent(storage, nodeId, ownerGhii, workflowId)
 *   - dropWaitingEvents(storage, nodeId, ownerGhii, workflowId)
 *   - readWaitingEvents(storage, nodeId)
 * @usage imported by engine-triggers.ts (hold, take) and lifecycle.ts (drop on delete).
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import { foldEvents, type WorkflowEvent } from './workflow-event.js';

const WAITING_KEY = 'workflows.waitingevents';
const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;

export interface WaitingEvent {
  ownerGhii: string;
  workflowId: string;
  event: WorkflowEvent;
}

/** One chain per node: a change to the record starts when the one before it has finished. */
const chains = new Map<string, Promise<unknown>>();
function inOrder<T>(nodeId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(nodeId) ?? Promise.resolve()).then(fn, fn);
  // The caller gets a failure through `next`. The chain only waits for the change to end, either way.
  const ended = (): void => undefined;
  chains.set(nodeId, next.then(ended, ended));
  return next;
}

export async function readWaitingEvents(storage: Storage, nodeId: string): Promise<WaitingEvent[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), WAITING_KEY);
  const arr = rec?.value as WaitingEvent[] | undefined;
  return Array.isArray(arr) ? arr : [];
}

async function writeWaitingEvents(storage: Storage, nodeId: string, entries: WaitingEvent[]): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, WAITING_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: WAITING_KEY, ownerGaii: systemGhii, value: entries,
    visibility: 'private', tags: ['workflow-index'], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

const same = (e: WaitingEvent, ownerGhii: string, workflowId: string): boolean =>
  e.ownerGhii === ownerGhii && e.workflowId === workflowId;

/** Keep an event until the workflow's run ends. A second one folds into the first. */
export function holdEvent(storage: Storage, nodeId: string, ownerGhii: string, workflowId: string, event: WorkflowEvent): Promise<void> {
  return inOrder(nodeId, async () => {
    const entries = await readWaitingEvents(storage, nodeId);
    const held = entries.find(e => same(e, ownerGhii, workflowId));
    if (held) held.event = foldEvents(held.event, event);
    else entries.push({ ownerGhii, workflowId, event });
    await writeWaitingEvents(storage, nodeId, entries);
  });
}

/** Take what waits for this workflow, so that exactly one caller gets it. */
export function takeWaitingEvent(storage: Storage, nodeId: string, ownerGhii: string, workflowId: string): Promise<WorkflowEvent | null> {
  return inOrder(nodeId, async () => {
    const entries = await readWaitingEvents(storage, nodeId);
    const held = entries.find(e => same(e, ownerGhii, workflowId));
    if (!held) return null;
    await writeWaitingEvents(storage, nodeId, entries.filter(e => !same(e, ownerGhii, workflowId)));
    return held.event;
  });
}

/** A deleted workflow's waiting events go with it. */
export function dropWaitingEvents(storage: Storage, nodeId: string, ownerGhii: string, workflowId: string): Promise<void> {
  return inOrder(nodeId, async () => {
    const entries = await readWaitingEvents(storage, nodeId);
    if (entries.some(e => same(e, ownerGhii, workflowId))) {
      await writeWaitingEvents(storage, nodeId, entries.filter(e => !same(e, ownerGhii, workflowId)));
    }
  });
}
