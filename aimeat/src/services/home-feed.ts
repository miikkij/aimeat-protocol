/**
 * @file src/services/home-feed.ts
 * @description The home's feed (aimeat_remake/06-koti-feed-suostumus.md): what has happened on this
 *   account, newest first.
 *
 *   It reads the SAME markers the funnel reads — no second store, no separate write path. That is
 *   deliberate and it is the whole design: a feed fed by its own events would drift from the
 *   numbers, and then the screen and the operator would be telling two different stories about the
 *   same account. Here they cannot: if the funnel counted it, the person sees it, and if the person
 *   sees it, it was counted.
 *
 *   K1: the feed is the account holder's own. Not public, so nothing here needs moderation,
 *   visibility rules or a way to take a row back. Making it public is a separate decision and a
 *   separate piece of work.
 *
 *   The FIRST row exists before the person has done anything: "your home exists". An empty feed on
 *   a brand-new account reads as broken, and the account being created is a real event with a real
 *   timestamp — so it is shown rather than invented.
 * @structure readHomeFeed(storage, config, owner) → FeedItem[]
 * @usage
 *   import { readHomeFeed } from '../services/home-feed.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ONBOARDING_KEYS } from './onboarding-funnel.js';

/**
 * One thing that happened. `kind` is a stable key the UI translates — never a sentence built here,
 * because the node has no business deciding which language the person reads.
 */
export interface FeedItem {
    kind: 'account_created' | 'welcome_mat' | 'agent_knocking' | 'agent_connected'
        | 'home_initialized' | 'room_entered';
    at: string;
    /** Where this row goes when clicked. The return email links straight to it. */
    link: string | null;
    /** Values the translated line interpolates (an agent's name, which room). */
    data?: Record<string, string>;
}

/**
 * Build the feed. Newest first.
 *
 * `pendingAgents` is passed in rather than read here because "an agent is knocking right now" is
 * live state, not a marker — it is the one row that disappears again, and it is the one the person
 * most needs to see.
 */
export async function readHomeFeed(
    storage: Storage, config: AimeatConfig, owner: string,
    opts: { pendingAgents?: number } = {},
): Promise<FeedItem[]> {
    const ghii = `${owner}@${config.nodeId}`;
    const [ghiiRecord, markers] = await Promise.all([
        storage.getGHIIByOwner(owner),
        storage.listMemoryForOwners([ghii], { prefix: 'onboarding.' }),
    ]);

    const byKey = new Map<string, Record<string, unknown>>();
    for (const m of markers) {
        byKey.set(m.key, (m.value && typeof m.value === 'object' ? m.value : {}) as Record<string, unknown>);
    }
    const at = (key: string): string | null => {
        const v = byKey.get(key)?.at;
        return typeof v === 'string' ? v : null;
    };

    const items: FeedItem[] = [];

    // The row that exists before anything else does. An account being created IS an event, and a
    // feed that starts empty tells a new person their home is broken on the first screen they see.
    if (ghiiRecord?.createdAt) {
        items.push({ kind: 'account_created', at: ghiiRecord.createdAt, link: '/v1/home' });
    }

    const matMark = byKey.get(ONBOARDING_KEYS.welcomeMatPasted) ?? {};
    if (matMark.result === 'ok' && typeof matMark.at === 'string') {
        // Straight to the thing they made, not to a settings page about it.
        items.push({ kind: 'welcome_mat', at: matMark.at, link: `/v1/portfolio/${encodeURIComponent(owner)}` });
    }

    // Live, not a marker: this row is here only while someone is actually waiting at the door.
    if ((opts.pendingAgents ?? 0) > 0) {
        items.push({
            kind: 'agent_knocking',
            at: new Date().toISOString(),
            link: '/v1/home',
            data: { count: String(opts.pendingAgents) },
        });
    }

    const firstAgent = byKey.get(ONBOARDING_KEYS.firstAgentConnected) ?? {};
    if (typeof firstAgent.at === 'string') {
        items.push({
            kind: 'agent_connected',
            at: firstAgent.at,
            link: '/v1/home',
            ...(typeof firstAgent.agentName === 'string' ? { data: { name: firstAgent.agentName } } : {}),
        });
    }

    const initAt = at(ONBOARDING_KEYS.homeInitialized);
    if (initAt) items.push({ kind: 'home_initialized', at: initAt, link: '/v1/home' });

    const room = byKey.get(ONBOARDING_KEYS.roomEntered) ?? {};
    if (typeof room.at === 'string' && typeof room.room === 'string') {
        items.push({ kind: 'room_entered', at: room.at, link: '/v1/home', data: { room: room.room } });
    }

    return items.sort((a, b) => b.at.localeCompare(a.at));
}
