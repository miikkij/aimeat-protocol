/**
 * @file src/services/home-feed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 * @structure readHomeFeed(storage, config, owner, opts) → FeedItem[] ·
 *   homeFeedAnswer(storage, config, owner, reader) → { items, total, note? } ·
 *   homeFeedAsShown(storage, config, owner, answer) → the same, as the home shows it
 * @usage
 *   import { readHomeFeed, homeFeedAnswer } from '../services/home-feed.js';
 * @version-history
 *   v2.4.0 — 2026-11-02 — Each row carries `at_local`, its time on the person's clock (their zone, else
 *     the one their browser sent with a chat turn), and on a sold node an agent's short name is replaced
 *     by its shown name (crew72: UTC times and "Aamukatsaus-agentin (morning-digest)").
 *   v2.3.0 — 2026-11-02 — homeFeedAnswer gives the rows as the home shows them (homeFeedAsShown): an agent's shown name in `agent_shown_name`, no row saying a node-resident agent (the chat, a basic agent) joined or left, and no AI cost row on a sold node, which the home already hid.
 *   v2.2.0 — 2026-11-02 — homeFeedAnswer: the answer GET /v1/home/feed and aimeat_home_feed both give, with the live knocking row.
 *   v2.1.0 — 2026-10-22 — readHomeFeed takes the reader and projects each recorded row for them (services/account-event-view.ts): a task row's title and decline reason only for the owner in person, an app grant holding task:read and the task's own agent; every other reader keeps the row and its `withheld` fields are named (secaudit 2026-10, v89).
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
import { projectAccountEvents, TASK_CONTENT_NOTE, type AccountEventReader } from './account-event-view.js';
import { isNodeResidentAgent } from './node-resident-agent.js';
import { displayPrefsFor, formatForPerson } from './display-prefs.js';
import { personZone } from './person-zone.js';

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
    /** The `data` fields this reader may not see and that were taken out (services/account-event-view.ts). */
    withheld?: string[];
    /** `at` on the person's clock and in their format ("2.11. klo 4.10"), when the node knows their zone. */
    at_local?: string;
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
    opts: {
        pendingAgents?: number; limit?: number;
        /**
         * Who reads the feed. Each recorded row is projected for them before it loses its actor
         * (services/account-event-view.ts): a task's title and reason only for the readers the task
         * route admits. GET /v1/home/feed always passes it; absent means a read made by the node for
         * the owner (the unit tests), and the rows are the owner's view.
         */
        reader?: AccountEventReader;
    } = {},
): Promise<FeedItem[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const ghii = `${owner}@${config.nodeId}`;

    let recorded: FeedItem[] = [];
    try {
        const rows = await readAccountEvents(storage, ghii, { limit }, config);
        const shown: Array<(typeof rows)[number] & { withheld?: string[] }> = opts.reader
            ? projectAccountEvents(rows, opts.reader).rows : rows;
        recorded = shown.map(e => ({
            kind: e.kind,
            at: e.at,
            link: e.link || null,
            ...(Object.keys(e.data).length ? { data: e.data } : {}),
            ...(e.withheld ? { withheld: e.withheld } : {}),
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

/**
 * The answer GET /v1/home/feed and aimeat_home_feed give: the feed with the live "an agent is
 * knocking" row, for this reader, and the note when a task row's fields were taken out.
 */
export async function homeFeedAnswer(
    storage: Storage, config: AimeatConfig, owner: string, reader: AccountEventReader,
): Promise<{ items: FeedItem[]; total: number; note?: string }> {
    const pending = await storage.listPendingDeviceAuthByOwner(owner);
    const items = await readHomeFeed(storage, config, owner, { pendingAgents: pending.length, reader });
    const withheld = items.some(i => !!i.withheld);
    return homeFeedAsShown(storage, config, owner, { items, total: items.length, ...(withheld ? { note: TASK_CONTENT_NOTE } : {}) });
}

/**
 * The feed as the person's own home shows it, which homeFeedAnswer gives the page and an AI that
 * answers them (aimeat_home_feed) alike. A row
 * that names an agent gets `agent_shown_name`, the name the Agents page shows ("Aamukatsaus" for
 * morning-digest). A row saying that an agent the node runs itself (the chat, a basic agent) joined or
 * left is left out. On a node the store sold, the day's AI cost row is left out, as the home leaves it
 * out for a buyer (public/views/home/feed.js isBookkeeping). On crew71 the chat answered from the raw
 * rows: '"morning-digest" -agentti' and '0,0078 $ kulunut' (commercial-88, 2.11).
 */
/** The rows that say an agent joined or left. */
const MEMBERSHIP_KINDS: ReadonlySet<string> = new Set(['agent_connected', 'agent_removed']);

export async function homeFeedAsShown(
    storage: Storage, config: AimeatConfig, owner: string, answer: { items: FeedItem[]; total: number; note?: string },
): Promise<{ items: FeedItem[]; total: number; note?: string }> {
    const sold = !!(config.siteLinks?.purchasePlan ?? '').trim();
    const agents = await storage.getAgentsByOwner(owner).catch((err: Error) => {
        logger.warn('home-feed: the agents could not be read for their shown names', { owner, error: err.message });
        return [];
    });
    const shown = new Map(agents.map(a => [a.name, a.displayName?.trim() || a.name]));
    // The agents the node runs itself (the chat, the basic agents) did not join: the person never
    // connected them, and no other page lists them as joined (crew71: "concierge" among the connected).
    const resident = new Set(agents.filter(isNodeResidentAgent).map(a => a.name));
    // Each row's time on the person's clock, in their own format, when the node knows their zone: the
    // one they chose, else the one their browser last sent with a chat turn (services/person-zone.ts).
    // A model asked to convert UTC did not (crew72: "kello 02 : 10" for 04.10).
    const prefs = await displayPrefsFor(storage, owner);
    const zone = prefs.timezone ?? personZone(owner);
    const region = prefs.region ?? prefs.locale ?? config.siteLinks?.defaultLocale ?? undefined;
    const localAt = (at: string) => zone
        ? formatForPerson({ ...prefs, region: region ?? null, timezone: zone }, at, { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })
        : undefined;
    const items = answer.items
        .filter(i => !(sold && i.kind === 'ai_spend_daily'))
        .filter(i => !(MEMBERSHIP_KINDS.has(i.kind) && resident.has(i.data?.name ?? i.data?.agent ?? '')))
        .map(i => {
            const at_local = localAt(i.at);
            const row = at_local ? { ...i, at_local } : i;
            const short = i.data?.agent || i.data?.name;
            const name = short ? shown.get(short) : undefined;
            if (!name || name === short) return row;
            // On a sold node the short name is not a name the buyer has seen, so it goes (crew72: the
            // chat wrote "Aamukatsaus-agentin (morning-digest)"); elsewhere both stay.
            if (sold) return { ...row, data: withShownName(i.data!, short!, name) };
            return { ...row, data: { ...i.data, agent_shown_name: name } };
        });
    return { ...answer, items, total: items.length };
}

/** A row's data with the agent's short name replaced by its shown name, in every field that held it. */
function withShownName(data: Record<string, string>, short: string, name: string): Record<string, string> {
    const out: Record<string, string> = { agent_shown_name: name };
    for (const [k, v] of Object.entries(data)) out[k] = v === short ? name : v;
    return out;
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
