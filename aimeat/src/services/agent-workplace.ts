/**
 * @file src/services/agent-workplace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an agent's finished work goes: the owner names one workspace, and from then on
 *   the result of each task the agent completes is shared with that workspace's members.
 *
 *   THE DEFAULT IS THE AGENT'S OWN MEMORY. With no workplace set, a result is a record in the
 *   agent's namespace that only the owner reads. Setting a workplace does not move or copy
 *   anything: when a task completes, the node changes the visibility of that task's result records
 *   from private to `workspace`, with the workspace as their `workspaceRef`. The records stay the
 *   owner's, in the agent's namespace, and the members of the workspace may read them.
 *
 *   WHY THE NODE DOES IT AND NOT THE AGENT. An agent told in its prompt to "also publish to the
 *   workspace" does it when its model remembers to. The owner chose a place on a page, and a choice
 *   made on a page has to hold for every task; so the step runs on the evidence of a completed
 *   task, in services/agent-task-fanout.ts, as the open-item close does.
 *
 *   IT ONLY EVER WIDENS PRIVATE TO THIS WORKSPACE. A record the agent already made public, or shared
 *   with a group or another workspace, is left as the agent wrote it. Work finished before the
 *   workplace was set is not touched: the owner chose where work goes from now on.
 *
 *   The stored record and its read are services/agent-ties.ts; this file is the write and the step.
 * @structure setWorkplace · clearWorkplace · shareFinishedWork
 * @usage await setWorkplace({ config, storage }, caller, 'morning-news', { organismId, workspaceId });
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a,
 *     decision "From an agent to an app", ruling 4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { MemoryRecord } from '../storage/types/commerce.js';
import { buildGAII, ownerGhiiOf, localAccountName, isValidAgentName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { listWorkspaces } from './structure-overview.js';
import {
  readWorkplace, workplaceKey, WORKPLACE_SPEC, WORKPLACE_TAG, type WorkplaceRecord,
} from './agent-ties.js';

interface Deps { config: AimeatConfig; storage: Storage }

/** Who is asking, in the terms every door already resolves. */
export interface WorkplaceCaller {
  /** resolveIdentity(req.auth!) over REST, the session principal over MCP. */
  principal: string;
  /** The account the caller acts for: `req.auth.owner` on every principal. */
  ownerName: string;
  roles: string[];
  scopes: string[];
}

export type WorkplaceOutcome =
  | { ok: true; workplace: WorkplaceRecord | null }
  | { ok: false; status: number; code: string; message: string };

const refuse = (status: number, code: string, message: string): WorkplaceOutcome => ({ ok: false, status, code, message });

/** The stored record as every interface answers with it, or null when the work stays with the agent. */
export function workplaceView(record: WorkplaceRecord | null): { organism_id: string; workspace_id: string; since: string } | null {
  return record ? { organism_id: record.organismId, workspace_id: record.workspaceId, since: record.since } : null;
}

/** How many result records one completion shares. A task names one key, or tags a handful. */
const SHARE_LIMIT = 20;

/** The caller's own agent by name, or a refusal. Another account's agent answers as not found. */
async function ownAgent(deps: Deps, caller: WorkplaceCaller, agentName: string): Promise<WorkplaceOutcome | null> {
  // A granted app and an ecosystem app act inside one app's fence. Where an agent's results are
  // shared is the owner's decision, made in person or through an agent of theirs.
  if (caller.roles.includes('app') || caller.roles.includes('ecosystem')) {
    return refuse(403, 'FORBIDDEN', 'An app cannot say where an agent\'s work goes. The owner or one of their agents does.');
  }
  if (!isValidAgentName(agentName)) return refuse(400, 'INVALID_INPUT', 'Name one of your own agents.');
  const agent = await deps.storage.getAgent(buildGAII(agentName, caller.ownerName, deps.config.nodeId));
  if (!agent || agent.owner !== caller.ownerName) {
    return refuse(404, 'AGENT_NOT_FOUND', `You have no agent called "${agentName}".`);
  }
  return null;
}

/**
 * Name the workspace an agent's finished work is shared with.
 *
 * The owner must be an active member of the organism: a person shares their agent's work into a
 * place they are in, never into one they only know the id of.
 */
export async function setWorkplace(
  deps: Deps, caller: WorkplaceCaller, agentName: string,
  place: { organismId: unknown; workspaceId: unknown },
): Promise<WorkplaceOutcome> {
  const refused = await ownAgent(deps, caller, agentName);
  if (refused) return refused;
  const { organismId, workspaceId } = place;
  if (typeof organismId !== 'string' || !organismId || typeof workspaceId !== 'string' || !workspaceId) {
    return refuse(400, 'INVALID_INPUT', 'Name the place with organism_id and workspace_id.');
  }
  const organism = await deps.storage.getOrganism(organismId);
  const membership = organism ? await deps.storage.getMembership(organismId, caller.ownerName) : null;
  // One answer for "no such organism" and "not yours to share into", so an id cannot be probed.
  if (!organism || !membership || membership.status !== 'active') {
    return refuse(404, 'NOT_FOUND', 'You are not a member of an organism with that id.');
  }
  const workspaces = await listWorkspaces(deps.storage, organismId);
  if (!workspaces.some(w => w.id === workspaceId && !w.archived)) {
    return refuse(404, 'NOT_FOUND', 'That organism has no workspace with that id.');
  }

  const ownerGhii = `${caller.ownerName}@${deps.config.nodeId}`;
  const key = workplaceKey(agentName);
  const row = await deps.storage.getMemory(ownerGhii, key);
  const prior = await readWorkplace(deps.storage, ownerGhii, agentName);
  const same = prior?.organismId === organismId && prior?.workspaceId === workspaceId;
  const now = new Date().toISOString();
  const value: WorkplaceRecord = {
    type: 'aimeat.agent.workplace',
    spec: WORKPLACE_SPEC,
    agentName,
    organismId,
    workspaceId,
    // "Since" is when work started going THERE, so naming the same place again keeps the date.
    since: same && prior ? prior.since : now,
    setBy: caller.principal,
  };
  // Straight to storage, as the other service-owned records are written: the prefix is in
  // SERVICE_OWNED_KEY_PREFIXES (utils/reserved-keys.ts), so every memory route refuses it for every
  // principal, and this service is the one writer. The record is a few ids, so the write service's
  // quota and stamping have nothing to count.
  await deps.storage.setMemory({
    key,
    ownerGaii: ownerGhii,
    value: value as unknown as Record<string, unknown>,
    visibility: 'owner',
    tags: [WORKPLACE_TAG],
    ttlHours: null,
    version: (row?.version ?? 0) + 1,
    createdAt: row?.createdAt ?? now,
    updatedAt: now,
  });
  return { ok: true, workplace: value };
}

/** Back to the default: the agent's work stays in its own memory. Work already shared stays shared. */
export async function clearWorkplace(deps: Deps, caller: WorkplaceCaller, agentName: string): Promise<WorkplaceOutcome> {
  const refused = await ownAgent(deps, caller, agentName);
  if (refused) return refused;
  const ownerGhii = `${caller.ownerName}@${deps.config.nodeId}`;
  if (!(await readWorkplace(deps.storage, ownerGhii, agentName))) return { ok: true, workplace: null };
  await deps.storage.deleteMemory(ownerGhii, workplaceKey(agentName), caller.principal);
  return { ok: true, workplace: null };
}

/** The result records of one task: the key its completion named, and what the run tagged with it. */
async function resultRecords(storage: Storage, task: AgentTaskRecord, deliverableKey: string | undefined): Promise<MemoryRecord[]> {
  const byKey = new Map<string, MemoryRecord>();
  if (deliverableKey) {
    const named = await storage.getMemory(task.agentGaii, deliverableKey);
    if (named) byKey.set(named.key, named);
  }
  for (const rec of await storage.listMemory(task.agentGaii, { tags: [`task:${task.id}`] })) {
    if (byKey.size >= SHARE_LIMIT) break;
    byKey.set(rec.key, rec);
  }
  return [...byKey.values()];
}

/**
 * The step a completed task sets off: share its result with the agent's workplace, when it has one.
 * Returns how many records it shared. Never throws into a completion that already happened.
 */
export async function shareFinishedWork(
  deps: Deps, task: AgentTaskRecord, deliverableKey: string | undefined,
): Promise<number> {
  const { storage, config } = deps;
  try {
    const ownerGhii = ownerGhiiOf(task.agentGaii);
    const ownerName = localAccountName(ownerGhii);
    const agentName = task.agentGaii.split('#')[0];
    const place = await readWorkplace(storage, ownerGhii, agentName);
    if (!place) return 0;
    // The owner may have left the organism since they chose it; then nothing more is shared there.
    const membership = await storage.getMembership(place.organismId, ownerName);
    if (!membership || membership.status !== 'active') return 0;

    const ref = `${place.organismId}/${place.workspaceId}`;
    let shared = 0;
    for (const rec of await resultRecords(storage, task, deliverableKey)) {
      if (rec.visibility !== 'private' && rec.visibility !== 'owner') continue;
      // A visibility change of a record that exists: the value, its provenance and its size are
      // untouched, so this is not a new write and does not go through the write service's quota
      // and stamping. The version moves, so a reader's compare-and-swap sees it.
      const next: MemoryRecord = {
        ...rec, visibility: 'workspace', workspaceRef: ref,
        version: rec.version + 1, updatedAt: new Date().toISOString(),
      };
      const done = storage.setMemoryIfVersion
        ? await storage.setMemoryIfVersion(next, rec.version)
        : await storage.setMemory(next);
      if (done) shared += 1;
    }
    return shared;
  } catch (err) {
    logger.error('sharing a finished task with the agent\'s workplace failed', { taskId: task.id, error: String(err), node: config.nodeId });
    return 0;
  }
}
