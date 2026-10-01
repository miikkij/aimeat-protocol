/**
 * @file src/services/journey-state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a person stands on the path from "I have an AI" to "others use what I built",
 *   in seven stages, so the home page and the person's own AI tell the same story about it
 *   (wish-ohjattu-k-ytt-j-polku-..., brief doc-mupor242l3cq, P1).
 *
 *   TWO HALVES, AND WHY. Whether a stage is done is DERIVED every time from what the account
 *   really holds: a connected AI, a saved note, an organism, an app, a worker agent. A stored
 *   "done" would drift from the thing it claims, the same reason the home's achievements row is
 *   derived (public/views/home/status-parts.js). What only the person can say is STORED, in one
 *   memory record at `journey.state` in their own scope: what they want to get done, which road
 *   in they took, and the stages they declined with the date. Their AI writes it with
 *   aimeat_memory_write (owner_scope true), the home page writes the road, and nothing else does.
 *
 *   The stages after the first result are not a fixed order: a shop owner goes to apps, a team
 *   lead to an organism. `next` is the first stage that is neither done nor declined, which is a
 *   default for a page; the guided-journey skill picks from what the person said they want.
 * @structure
 *   - JOURNEY_KEY, JOURNEY_STAGES, JOURNEY_ROADS
 *   - deriveJourney(signals, record) — the pure decision, tested without a database
 *   - readJourneySignals(storage, config, owner, home?) — the account's facts
 *   - readJourney(storage, config, owner, home?) — both halves, one answer
 *   - journeyHandbookSection(journey) — what the person's AI reads in its handbook
 * @usage
 *   const journey = await readJourney(storage, config, owner, homeState);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { readHomeState, type HomeState } from './home-state.js';
import { FIRST_MCP_CALL_KEY } from './onboarding-funnel.js';
import { getOwnerUsageSummary } from './usage-summary.js';
import { loadOwnerAgents } from './db/owner-identity.js';
import { logger } from '../utils/logger.js';

/** The one record the person's own words live in. */
export const JOURNEY_KEY = 'journey.state';

/** The note the home's first task saves (public/views/home/journey-prompts.js FIRST_NOTE_KEY). */
export const FIRST_NOTE_KEY = 'home.first-note';

/** In the order a newcomer meets them. */
export const JOURNEY_STAGES = ['ai', 'connect', 'first-result', 'organise', 'apps', 'agents', 'share'] as const;
export type JourneyStageId = typeof JOURNEY_STAGES[number];

/**
 * The three roads in. `subscription`: a paid Claude, ChatGPT or Grok, or an AI coding tool, over
 * MCP. `free`: the free Claude plan with the connector, or the person's own OpenRouter credit.
 * `prompt`: an AI that cannot connect, used through copied prompts whose answer is brought back.
 */
export const JOURNEY_ROADS = ['subscription', 'free', 'prompt'] as const;
export type JourneyRoad = typeof JOURNEY_ROADS[number];

/** What the person said, as stored. Every field is optional; an unknown field is ignored. */
export interface JourneyRecord {
    want?: string;
    road?: JourneyRoad;
    declined?: Array<{ stage: JourneyStageId; at: string }>;
}

/** The account's facts that decide the stages. */
export interface JourneySignals {
    /** An AI of theirs has called this node over MCP, or written the connection proof. */
    connected: boolean;
    /** They keep their own AI key here. */
    ownKey: boolean;
    /** A real first result exists: a shared place, the first note, the welcome page, or an app. */
    firstResult: boolean;
    /** Organisms they belong to. */
    organisms: number;
    /** At least one of those has another person in it. */
    sharedWithSomeone: boolean;
    /** Apps they published, plus extensions and browser libraries a package installed. */
    apps: number;
    /** Agents that are not a chat connection: they work on their own. */
    workers: number;
}

export interface JourneyStage { id: JourneyStageId; done: boolean; declined: boolean }

export interface Journey {
    stages: JourneyStage[];
    /** The first stage neither done nor declined; null when the path is walked. */
    next: JourneyStageId | null;
    want: string | null;
    road: JourneyRoad | null;
}

const isStage = (v: unknown): v is JourneyStageId => typeof v === 'string' && (JOURNEY_STAGES as readonly string[]).includes(v);
const isRoad = (v: unknown): v is JourneyRoad => typeof v === 'string' && (JOURNEY_ROADS as readonly string[]).includes(v);

/** Read a stored value defensively: the record is written by an AI and by a page. */
export function parseJourneyRecord(value: unknown): JourneyRecord {
    if (!value || typeof value !== 'object') return {};
    const v = value as Record<string, unknown>;
    const out: JourneyRecord = {};
    // The want is quoted into the person's AI's handbook, so it stays one plain line: no line
    // breaks, no double quotes to close the quotation with, and short. Anything that may write
    // this person's memory could put words here; the handbook presents them as the person's.
    if (typeof v.want === 'string') {
        const visible = [...v.want].map(ch => { const c = ch.charCodeAt(0); return c < 32 || c === 127 ? ' ' : ch; }).join('');
        const want = visible.replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 200);
        if (want) out.want = want;
    }
    if (isRoad(v.road)) out.road = v.road;
    if (Array.isArray(v.declined)) {
        out.declined = v.declined
            .filter((d): d is { stage: JourneyStageId; at: string } =>
                !!d && typeof d === 'object' && isStage((d as { stage?: unknown }).stage))
            .map(d => ({ stage: d.stage, at: typeof d.at === 'string' ? d.at : '' }));
    }
    return out;
}

/** The pure decision. */
export function deriveJourney(s: JourneySignals, record: JourneyRecord): Journey {
    const done: Record<JourneyStageId, boolean> = {
        // Having a good AI shows itself: it connected, they keep a key here, or they told us which road.
        ai: s.connected || s.ownKey || !!record.road,
        connect: s.connected,
        'first-result': s.firstResult,
        organise: s.organisms > 0,
        apps: s.apps > 0,
        agents: s.workers > 0,
        share: s.sharedWithSomeone,
    };
    const declined = new Set((record.declined ?? []).map(d => d.stage));
    // An AI that cannot connect never will: on the prompt road the connection is not the next step.
    if (record.road === 'prompt') declined.add('connect');
    const stages = JOURNEY_STAGES.map(id => ({ id, done: done[id], declined: !done[id] && declined.has(id) }));
    const next = stages.find(st => !st.done && !st.declined)?.id ?? null;
    return { stages, next, want: record.want ?? null, road: record.road ?? null };
}

/**
 * An agent that works on its own. A device-authorized chat AI is `interactive` by default, the same
 * as a resident front door, so the mode alone cannot tell them apart: a worker either declares how
 * its runtime runs it (`runMode`) or takes work by itself (task-runner, autonomous, coordinator).
 */
export function isWorker(a: { mode?: string; runMode?: string | null }): boolean {
    return !!a.runMode || a.mode === 'task-runner' || a.mode === 'autonomous' || a.mode === 'coordinator';
}

/** The account's facts. `home` is passed when the caller already read it. */
export async function readJourneySignals(
    storage: Storage, config: AimeatConfig, owner: string, home?: HomeState,
): Promise<JourneySignals> {
    const ghii = `${owner}@${config.nodeId}`;
    const [state, usage, agents, organisms, firstCall, firstNote] = await Promise.all([
        home ? Promise.resolve(home) : readHomeState(storage, config, owner),
        getOwnerUsageSummary(config, storage, owner),
        loadOwnerAgents(storage, owner),
        storage.listOrganisms({ member: owner, perPage: 10000 }),
        storage.getMemory(ghii, FIRST_MCP_CALL_KEY),
        getOwnerScopeMemory(storage, config.nodeId, owner, FIRST_NOTE_KEY),
    ]);
    const isMe = (who: string) => who === owner || who === ghii;
    const sharedWithSomeone = organisms.some(o =>
        [...(o.owners ?? []), ...(o.admins ?? []), ...(o.members ?? [])].some(who => !isMe(who)));
    const apps = usage.counts.apps.used + usage.counts.extensions.used + usage.counts.cortexes;
    return {
        connected: state.helloMcp || !!firstCall,
        ownKey: usage.ai.own_key,
        // A shared place is the first result the home now offers first, so it counts as one.
        firstResult: !!firstNote || state.mat.done || usage.counts.apps.used > 0 || organisms.length > 0,
        organisms: organisms.length,
        sharedWithSomeone,
        apps,
        workers: agents.filter(isWorker).length,
    };
}

/** Both halves, one answer. */
export async function readJourney(
    storage: Storage, config: AimeatConfig, owner: string, home?: HomeState,
): Promise<Journey> {
    const [signals, rec] = await Promise.all([
        readJourneySignals(storage, config, owner, home),
        getOwnerScopeMemory(storage, config.nodeId, owner, JOURNEY_KEY),
    ]);
    return deriveJourney(signals, parseJourneyRecord(rec?.value));
}

/** One line per stage, in the words the skill uses for them. */
const STAGE_LINE: Record<JourneyStageId, string> = {
    ai: 'a good AI of their own',
    connect: 'that AI connected to this node',
    'first-result': 'a first real result: a shared place, a note every AI of theirs reads, a page or a small app',
    organise: 'an organism with a workspace, where their work lives between conversations',
    apps: 'an app or an installed package, used once from the chat',
    agents: 'an agent that works on its own while they are away',
    share: 'something shared with another person, published or priced',
};

/**
 * What the person's AI reads at the end of its handbook while the path is not walked. Null when
 * every stage is done or declined: a person who has everything is not reminded of anything.
 */
export function journeyHandbookSection(journey: Journey): string | null {
    if (!journey.next) return null;
    const lines = journey.stages.map(st =>
        `- ${st.done ? '[done]' : st.declined ? '[declined]' : '[open]'} ${STAGE_LINE[st.id]}`);
    return [
        '## Where this person is on their path',
        '',
        'This person has not walked the whole path here yet. Load the skill `aimeat-guided-journey` '
        + 'when they ask what this place is for, what to do next, or how something works, and when a '
        + 'piece of work has just finished. Work on what they asked first.',
        '',
        ...lines,
        '',
        `Next by default: ${STAGE_LINE[journey.next]}.`
        + (journey.want ? ` They said they want: "${journey.want}".` : '')
        + (journey.road ? ` Their road in: ${journey.road}.` : ''),
        `Their own words live at \`${JOURNEY_KEY}\` in their memory (owner scope).`,
    ].join('\n');
}

/** The section for an owner, or null on any trouble: a handbook never fails over it. */
export async function journeyHandbookFor(
    storage: Storage, config: AimeatConfig, owner: string | undefined,
): Promise<string | null> {
    if (!owner) return null;
    try {
        return journeyHandbookSection(await readJourney(storage, config, owner));
    } catch (err) {
        logger.warn('journey-state: handbook section skipped after a failed read', { owner, error: String(err) });
        return null;
    }
}
