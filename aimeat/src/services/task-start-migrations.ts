/**
 * @file src/services/task-start-migrations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two one-time changes that follow the task-start rulings of 2026-10-02 (Jouni), each
 *   run once per node at boot and marked done under the node's system identity.
 *
 *   1. BASIC AGENTS START ON THEIR OWN (ruling A). The basic agents an owner got before 2026-10-02
 *      (concierge, workflow manager) still waited for a Start press nobody had told the customer
 *      about. Each one NOBODY HAS SET (`taskStart` null) now starts its tasks by itself; one whose
 *      owner chose "wait" keeps it. Positive evidence only: the template's name AND its `crew.basic`
 *      tag AND no setting. Each owner it touches gets one notification saying what changed and where
 *      the switch is. The floor still holds for spending, sending and deleting, which is why this is
 *      safe (services/agent-task-rules.ts).
 *
 *   2. APPS KEEP DELETING THEIR RECORDS (ruling B). Deleting shared workspace records for good took
 *      its own word, `memory:purge`; until then `memory:delete` reached it. An app grant holding
 *      `memory:delete` gets `memory:purge` once, so an app's delete button keeps working: this keeps
 *      reach an app already had and gives none it did not. Agents are NOT given it: the word holds
 *      every task of an agent that has it, so handing it to every agent with `memory:delete` (the
 *      default) would stop every task-runner. An agent that needs it is refused once, and its card
 *      offers the word with one press (services/agent-refusals.ts).
 * @structure migrateBasicAgentsTaskStartOnce() · grantPurgeToAppGrantsOnce() · basicAgentsStartNotice()
 * @usage
 *   migrateBasicAgentsTaskStartOnce(storage, config).catch(err => logger.error(…));
 *   grantPurgeToAppGrantsOnce(storage, config.nodeId).catch(err => logger.error(…));
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { BASIC_AGENTS } from '../data/basic-agents.js';
import { notify, type NotifyInput } from './notify.js';
import { logger } from '../utils/logger.js';

export const BASIC_AGENTS_START_KEY = 'migrations.basic-agents-task-start';
export const PURGE_WORD_KEY = 'migrations.memory-purge-app-grants';
export const BASIC_AGENTS_START_TYPE = 'basic_agents_start_on';

const BASIC_NAMES = new Set(BASIC_AGENTS.map(t => t.name));

/** A basic agent nobody has set, by positive evidence: its template's name, its tag, no setting. */
export function isUnsetBasicAgent(agent: Pick<AgentRecord, 'name' | 'tags'> & Partial<Pick<AgentRecord, 'taskStart'>>): boolean {
    return BASIC_NAMES.has(agent.name)
        && Array.isArray(agent.tags) && agent.tags.includes('crew.basic')
        && (agent.taskStart === undefined || agent.taskStart === null);
}

/** The one notice an owner gets: which agents changed, what that means, and where the switch is. */
export function basicAgentsStartNotice(names: string[]): NotifyInput {
    const list = names.join(', ');
    return {
        type: BASIC_AGENTS_START_TYPE,
        title: 'Your basic agents now start their tasks by themselves',
        body: `${list} now start a task as soon as it arrives: each proposes its plan and goes on, and you see what it did. `
            + 'A task that spends money, sends mail in your name or deletes something for good still waits for your OK. '
            + 'To change it, open the agent on the Agents page and use the switch "Starts work by itself".',
        link: '/v1/profile?tab=agents',
        i18n: { key: BASIC_AGENTS_START_TYPE, vars: { agents: list } },
        actions: [{
            id: 'open', label: 'Open Agents', kind: 'navigate', link: '/v1/profile?tab=agents',
            i18n: { key: `${BASIC_AGENTS_START_TYPE}.open` },
        }],
    };
}

/** Written after the work, so a boot that stops half way runs it again; never swept. */
async function markDone(storage: Storage, nodeId: string, key: string, value: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key, ownerGaii: `system@${nodeId}`, value: { at: now, ...value },
        visibility: 'private', tags: ['migration'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
}

/**
 * Ruling A, once per node. Returns how many agents and owners it changed. Running it again after a
 * partial run is safe: an agent it set is no longer "nobody has set", so it is neither changed nor
 * announced twice.
 */
export async function migrateBasicAgentsTaskStartOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; agents: number; owners: number }> {
    const system = `system@${config.nodeId}`;
    if (await storage.getMemory(system, BASIC_AGENTS_START_KEY)) return { ran: false, agents: 0, owners: 0 };
    const byOwner = new Map<string, string[]>();
    let agents = 0;
    for (const agent of await storage.listAgents()) {
        if (!isUnsetBasicAgent(agent)) continue;
        await storage.updateAgent(agent.gaii, { taskStart: 'automatic' });
        agents++;
        const names = byOwner.get(agent.owner) ?? [];
        names.push(agent.displayName || agent.name);
        byOwner.set(agent.owner, names);
    }
    for (const [owner, names] of byOwner) {
        // Best-effort per owner: one failed notice must not stop the next owner's.
        await notify(storage, `${owner}@${config.nodeId}`, basicAgentsStartNotice(names))
            .catch(err => logger.warn('basic agents start: the owner could not be told', { owner, error: String(err) }));
    }
    await markDone(storage, config.nodeId, BASIC_AGENTS_START_KEY, { agents, owners: byOwner.size });
    if (agents > 0) logger.info(`Basic agents: ${agents} of ${byOwner.size} owner(s) now start their tasks by themselves`);
    return { ran: true, agents, owners: byOwner.size };
}

/** Ruling B, once per node: an app grant that held `memory:delete` keeps its delete. */
export async function grantPurgeToAppGrantsOnce(storage: Storage, nodeId: string): Promise<{ ran: boolean; grants: number }> {
    const system = `system@${nodeId}`;
    if (await storage.getMemory(system, PURGE_WORD_KEY)) return { ran: false, grants: 0 };
    let grants = 0;
    for (const grant of await storage.listAppGrants()) {
        const held = grant.scopes;
        if (!Array.isArray(held) || !held.includes('memory:delete') || held.includes('memory:purge')) continue;
        await storage.updateAppGrant(grant.grantId, { scopes: [...held, 'memory:purge'] });
        grants++;
    }
    await markDone(storage, nodeId, PURGE_WORD_KEY, { grants });
    if (grants > 0) logger.info(`memory:purge: given to ${grants} app grant(s) that held memory:delete`);
    return { ran: true, grants };
}
