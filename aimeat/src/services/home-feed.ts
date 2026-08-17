/**
 * @file src/services/home-feed.ts
 * @description The home's feed (aimeat_remake/06-koti-feed-suostumus.md): what has happened on this
 *   account, newest first.
 *
 *   IT READS ONE STORE. Until 2026-08-17 the six onboarding rows were DERIVED here by reading the
 *   funnel's own markers back, so the numbers an operator saw and the screen a person saw could not
 *   disagree. The reasoning was right and its scope was six events; it stopped being right the day
 *   the feed described everything, because then some rows were complete and others were not and a
 *   reader had no way to know why.
 *
 *   The guarantee is kept and MOVED. Those events are recorded at the moment their marker is
 *   written (services/onboarding-funnel.ts), from the same fact in the same act, so the funnel and
 *   the feed still cannot drift. What is gone is the second source, not the promise.
 *
 *   ONE ROW IS STILL NOT RECORDED, and never should be: "an agent is knocking" is LIVE state. It is
 *   the row that disappears again once the person answers, so it is not history and does not belong
 *   in a store of things that happened.
 *
 *   K1: the feed is the account holder's own. Not public, so nothing here needs moderation,
 *   visibility rules or a way to take a row back. Making it public is a separate decision and a
 *   separate piece of work.
 * @structure readHomeFeed(storage, config, owner, opts) → FeedItem[]
 * @usage
 *   import { readHomeFeed } from '../services/home-feed.js';
 * @version-history
 *   v2.0.0 — 2026-08-17 — The derived path is gone. Every row but the live one comes from
 *     AccountEvent; onboarding records its own at the marker. backfillHomeFeed() converts an
 *     existing account's markers once, so nobody's history disappears on deploy.
 *   v1.1.0 — 2026-08-17 — The feed is derived rows PLUS recorded ones.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AccountEventKind } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { ONBOARDING_KEYS } from './onboarding-funnel.js';
import { readAccountEvents, recordAccountEvent } from './account-events.js';

/**
 * One thing that happened. `kind` is a stable key the UI translates — never a sentence built here,
 * because the node has no business deciding which language the person reads.
 */
export interface FeedItem {
    /** A recorded event's kind, or `agent_knocking`, which is live state rather than history. */
    kind: AccountEventKind | 'agent_knocking';
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
 * live state, not a record — it is the one row that disappears again, and it is the one the person
 * most needs to see.
 */
export async function readHomeFeed(
    storage: Storage, config: AimeatConfig, owner: string,
    opts: { pendingAgents?: number; limit?: number } = {},
): Promise<FeedItem[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const ghii = `${owner}@${config.nodeId}`;

    let recorded: FeedItem[] = [];
    try {
        recorded = (await readAccountEvents(storage, ghii, { limit }, config)).map(e => ({
            kind: e.kind,
            at: e.at,
            link: e.link || null,
            ...(Object.keys(e.data).length ? { data: e.data } : {}),
        }));
    } catch (err) {
        // An unreadable store leaves the live row, which is the one that needs acting on anyway.
        logger.warn('home-feed: could not read the account record', { owner, error: String(err) });
    }

    const items: FeedItem[] = [...recorded];

    // Live, not recorded: this row is here only while someone is actually waiting at the door.
    if ((opts.pendingAgents ?? 0) > 0) {
        items.push({
            kind: 'agent_knocking',
            at: new Date().toISOString(),
            link: '/v1/home',
            data: { count: String(opts.pendingAgents) },
        });
    }

    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Which marker becomes which row, for an account that predates the recorded feed. */
const BACKFILL: Array<{ key: string; kind: AccountEventKind; data?: (v: Record<string, unknown>) => Record<string, string> }> = [
    { key: ONBOARDING_KEYS.welcomeMatPasted, kind: 'welcome_mat' },
    {
        key: ONBOARDING_KEYS.firstAgentConnected, kind: 'agent_connected',
        data: v => (typeof v.agentName === 'string' ? { name: v.agentName } : {} as Record<string, string>),
    },
    { key: ONBOARDING_KEYS.homeInitialized, kind: 'home_initialized' },
    {
        key: ONBOARDING_KEYS.roomEntered, kind: 'room_entered',
        data: v => (typeof v.room === 'string' ? { room: v.room } : {} as Record<string, string>),
    },
];

/**
 * Convert one account's onboarding markers into recorded events, once.
 *
 * WHY THIS EXISTS. Deleting the derived path without this would erase every existing account's
 * history at deploy time — their home would go from three rows to none, and the only evidence they
 * had ever set the place up would be gone from the screen that shows it.
 *
 * IDEMPOTENT, and the check is the point: it reads what is already recorded and skips any kind
 * already present. Run it twice and the second run does nothing. It also stamps each row with the
 * marker's OWN timestamp, so a five-month-old account reads as five months old rather than as
 * having been created the day this shipped.
 *
 * Returns how many rows it wrote, so a maintenance route can report something true.
 */
export async function backfillHomeFeed(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<{ written: number }> {
    const ghii = `${owner}@${config.nodeId}`;
    const [existing, ghiiRecord, markers] = await Promise.all([
        readAccountEvents(storage, ghii, { limit: 200 }, config),
        storage.getGHIIByOwner(owner),
        storage.listMemoryForOwners([ghii], { prefix: 'onboarding.' }),
    ]);

    const already = new Set(existing.map(e => e.kind));
    const byKey = new Map<string, Record<string, unknown>>();
    for (const m of markers) {
        byKey.set(m.key, (m.value && typeof m.value === 'object' ? m.value : {}) as Record<string, unknown>);
    }

    let written = 0;
    const write = async (kind: AccountEventKind, at: string, data?: Record<string, string>, link?: string) => {
        if (already.has(kind)) return;
        await recordAccountEvent(storage, {
            ownerGhii: ghii, kind, at, link: link ?? '/v1/home', ...(data ? { data } : {}),
        }, config);
        already.add(kind);
        written++;
    };

    // The account itself. Its timestamp is the GHII's, which is the real one.
    if (ghiiRecord?.createdAt) await write('account_created', ghiiRecord.createdAt);

    for (const entry of BACKFILL) {
        const marker = byKey.get(entry.key);
        const at = marker?.at;
        if (typeof at !== 'string') continue;
        // The welcome mat is the one marker that accumulates attempts; only a successful paste made
        // anything, so a failed one is not an event.
        if (entry.key === ONBOARDING_KEYS.welcomeMatPasted && marker?.result !== 'ok') continue;
        const link = entry.key === ONBOARDING_KEYS.welcomeMatPasted
            ? `/v1/portfolio/${encodeURIComponent(owner)}`
            : '/v1/home';
        await write(entry.kind, at, entry.data?.(marker ?? {}), link);
    }

    return { written };
}
