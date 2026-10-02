/**
 * @file src/services/scope-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which permissions an agent holding `*` actually uses, and the narrowing built from it.
 *
 *   WHY (ruling C, Jouni 2026-10-02). "All permissions" must never read as "nothing dangerous", so `*`
 *   puts an agent on the task-start floor (services/agent-task-rules.ts): its tasks wait for the
 *   owner. Not by surprise: first the owner gets a narrowing they accept with one press, the named
 *   permissions the agent actually used. The node recorded no such history before this file: the
 *   usage stream keeps MCP tool calls by name and no REST call at all, and the fleet crews reach the
 *   node through REST. So the record starts the day this ships, and `*` holds an agent only once its
 *   record is OBSERVE_DAYS old and names at least one permission. Until then nothing changes for it.
 *
 *   HOW IT IS FED. requireScope (auth/middleware.ts) notes the words it admitted a `*` agent for, and
 *   the MCP tool wrapper (mcp/tool-usage-wrap.ts) notes the word each tool needs. Both are synchronous
 *   and buffered, as the usage stream is: a call never waits on this, and a write never fails a call.
 *   A route that checks a word inline rather than through requireScope is not seen; an agent narrowed
 *   past such a route is refused once, and its card offers the word with one press
 *   (services/agent-refusals.ts), which is the net under "without loss".
 *
 *   ONE RECORD PER OWNER, `scope-use.agents`: the agents and, per word, when it was last used. A
 *   collection read as a unit, a few dozen words per agent at most. Service-owned
 *   (utils/reserved-keys.ts): no memory route writes, restores or deletes it, so no agent can forge
 *   its own history.
 * @structure SCOPE_USE_KEY · OBSERVE_DAYS · noteScopeUse() · flushScopeUse() · initScopeUse() ·
 *   shutdownScopeUse() · readScopeUse() · writeScopeUse() · wildcardStatus() · withWildcardFacts()
 *   (the narrowing itself is services/scope-narrowing.ts: this file is imported by the auth
 *   middleware and must not reach the connector, which reaches the middleware back)
 * @usage
 *   noteScopeUse(req.auth.sub, ['memory:read']);
 *   const status = wildcardStatus(agent, (await readScopeUse(storage, ownerGhii)).agents[agent.name]);
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Storage, AgentRecord } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { isOutsideWildcard } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

export const SCOPE_USE_KEY = 'scope-use.agents';
/** How long the record must run before `*` holds an agent's tasks: two weeks catches a weekly job twice. */
export const OBSERVE_DAYS = 14;
const FLUSH_INTERVAL_MS = 60_000;
/** A word already on record is rewritten only when its last use is older than this. */
const REFRESH_MS = 6 * 3600_000;
const DAY_MS = 24 * 3600_000;

export interface AgentScopeUse { since: string; words: Record<string, string> }
export interface ScopeUseRecord { agents: Record<string, AgentScopeUse> }

let storageRef: Storage | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
/** ownerGhii → agent name → words noted since the last flush. */
let pending = new Map<string, Map<string, Set<string>>>();

/**
 * Note that `principal` (an agent's GAII) used `words`. Synchronous, never throws, never waits.
 * Whether the agent holds `*` is decided at flush, from its record, so a caller need not know.
 */
export function noteScopeUse(principal: string, words: readonly string[]): void {
    const hash = principal.indexOf('#');
    if (hash <= 0) return;
    const name = principal.slice(0, hash);
    const owner = ownerGhiiOf(principal);
    let agents = pending.get(owner);
    if (!agents) { agents = new Map(); pending.set(owner, agents); }
    let set = agents.get(name);
    if (!set) { set = new Set(); agents.set(name, set); }
    for (const w of words) if (w && w !== '*') set.add(w);
}

export async function readScopeUse(storage: Storage, ownerGhii: string): Promise<ScopeUseRecord> {
    const v = (await storage.getMemory(ownerGhii, SCOPE_USE_KEY))?.value as ScopeUseRecord | undefined;
    return v && typeof v === 'object' && v.agents && typeof v.agents === 'object' ? v : { agents: {} };
}

export async function writeScopeUse(storage: Storage, ownerGhii: string, record: ScopeUseRecord): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key: SCOPE_USE_KEY, ownerGaii: ownerGhii, value: record, visibility: 'private',
        tags: ['scope-use'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
}

/**
 * Write what was noted. Only agents whose record holds `*` are kept; a write happens only on news.
 * A caller that arrives while a write runs waits for it and then writes what came in since, so a
 * reader that flushes first never misses a call caught in the middle.
 */
export async function flushScopeUse(storage: Storage | null = storageRef): Promise<void> {
    while (inFlight) await inFlight;
    if (!storage || pending.size === 0) return;
    const batch = pending;
    pending = new Map();
    inFlight = writeBatch(storage, batch);
    try { await inFlight; } finally { inFlight = null; }
}

async function writeBatch(storage: Storage, batch: Map<string, Map<string, Set<string>>>): Promise<void> {
    try {
        for (const [owner, agents] of batch) {
            const record = await readScopeUse(storage, owner);
            const now = new Date();
            let changed = false;
            for (const [name, words] of agents) {
                const agent = await storage.getAgent(`${name}#${owner}`);
                if (!agent || !(agent.defaultScopes ?? []).includes('*')) continue;
                const use = record.agents[name] ?? (changed = true, record.agents[name] = { since: now.toISOString(), words: {} });
                for (const w of words) {
                    const last = use.words[w];
                    if (!last || now.getTime() - Date.parse(last) > REFRESH_MS) { use.words[w] = now.toISOString(); changed = true; }
                }
            }
            if (changed) await writeScopeUse(storage, owner, record);
        }
    } catch (err) {
        logger.warn('scope-use: the record could not be written; this batch is lost', { error: String(err) });
    }
}

export function initScopeUse(storage: Storage): void {
    storageRef = storage;
    if (timer) return;
    timer = setInterval(() => { void flushScopeUse(); }, FLUSH_INTERVAL_MS);
    timer.unref?.();
}

export async function shutdownScopeUse(): Promise<void> {
    if (timer) { clearInterval(timer); timer = null; }
    await flushScopeUse();
}

export interface WildcardStatus {
    /** The agent's record holds `*`. */
    holds: boolean;
    /** When the record of this agent started; null when nothing is on record. */
    since: string | null;
    daysObserved: number;
    /** Days until `*` holds its tasks; 0 once ready. */
    daysLeft: number;
    /** The record is OBSERVE_DAYS old and names a permission: `*` holds its tasks, and a narrowing is offered. */
    ready: boolean;
    /** The permissions it used, newest knowledge first. */
    used: string[];
    /**
     * What the narrowing gives the agent instead of `*`: the words it used (never one outside every
     * wildcard, which `*` never gave), plus every other word its record already names.
     */
    proposal: string[];
}

export function wildcardStatus(
    agent: Pick<AgentRecord, 'defaultScopes'>, use: AgentScopeUse | undefined, now = Date.now(),
): WildcardStatus {
    const held = agent.defaultScopes ?? [];
    const holds = held.includes('*');
    const used = Object.keys(use?.words ?? {}).sort();
    const daysObserved = use ? Math.floor((now - Date.parse(use.since)) / DAY_MS) : 0;
    const daysLeft = Math.max(0, OBSERVE_DAYS - daysObserved);
    const proposal = [...new Set([...held.filter(s => s !== '*'), ...used.filter(w => !isOutsideWildcard(w))])].sort();
    return {
        holds, since: use?.since ?? null, daysObserved, daysLeft: use ? daysLeft : OBSERVE_DAYS,
        ready: holds && !!use && daysLeft === 0 && used.length > 0, used, proposal,
    };
}

/** The agent as the start rules read it: with `wildcardReady` when it holds `*`. */
export async function withWildcardFacts<T extends Partial<Pick<AgentRecord, 'defaultScopes' | 'name' | 'gaii'>>>(
    storage: Storage, agent: T | null | undefined,
): Promise<(T & { wildcardReady?: boolean }) | null | undefined> {
    if (!agent || !(agent.defaultScopes ?? []).includes('*') || !agent.name || !agent.gaii) return agent;
    const use = (await readScopeUse(storage, ownerGhiiOf(agent.gaii))).agents[agent.name];
    return { ...agent, wildcardReady: wildcardStatus(agent, use).ready };
}
