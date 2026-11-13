/**
 * @file src/services/onboarding/markers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The remake funnel's marker keys and the one write-once marker writer every phase uses:
 *   ONBOARDING_KEYS, the track, branch and room types, writeMarkerOnce() and recordOnboardingEvent()
 *   with the home-feed line a marker writes.
 *
 *   WHY A MODULE OF ITS OWN. services/home-state.ts and services/inactivity-nudge.ts read these keys,
 *   and services/onboarding-funnel.ts loads both of them in its rescue pass. While the keys lived in
 *   onboarding-funnel.ts the files imported each other, two run-time import cycles. They moved here
 *   unchanged; onboarding-funnel.ts re-exports every name, so no other importer changed.
 * @structure ONBOARDING_KEYS · OnboardingTrack / OnboardingBranch / OnboardingRoom · writeMarkerOnce ·
 *   recordOnboardingEvent (with FEED_KIND_FOR_MARKER, FEED_LINK_FOR_MARKER, feedDataFor)
 * @usage await recordOnboardingEvent(storage, config, owner, ONBOARDING_KEYS.roomEntered, { room });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved unchanged from services/onboarding-funnel.ts (its history stays there),
 *     which ends the import cycles with home-state.ts and inactivity-nudge.ts (structure programme
 *     2026-11, unit 4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AccountEventKind } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { recordAccountEvent } from '../account-events.js';

/**
 * EVERY remake funnel key, in one place (05-mittaus.md). Nothing outside this module spells one of
 * these strings: a key typed twice is a marker that silently stops being counted the day one of
 * the two is edited, and a funnel that undercounts reads as a product that does not work.
 */
export const ONBOARDING_KEYS = {
    /** Which path the account was created on. Written ONCE at account creation. */
    track: 'onboarding.track',
    /** The welcome mat paste. The ONE non-write-once marker: attempts accumulate. */
    welcomeMatPasted: 'onboarding.welcome_mat_pasted',
    /** What the model claimed about itself, or what the person answered when asked. */
    aiModelDetected: 'onboarding.ai_model_detected',
    /** A = MCP-capable client, B = needs a better one first, agent = the front-page agent door. */
    branchTaken: 'onboarding.branch_taken',
    firstAgentConnected: 'onboarding.first_agent_connected',
    /**
     * The first turn the person ever sent in the node's own chat, with which starter button fired
     * it (if one did). Before this the chat cohort was invisible between "landed on /v1/chat" and
     * "activated": an account that landed, talked and left wrote no marker at all.
     */
    firstChatTurn: 'onboarding.first_chat_turn',
    homeInitialized: 'onboarding.home_initialized',
    /** The FIRST of the four rooms entered. Later ones do not overwrite it. */
    roomEntered: 'onboarding.room_entered',
    /** Agent door (12-ai-rekisteroi.md): the POST landed and the mail went out. */
    inviteSentByAgent: 'onboarding.invite_sent_by_agent',
    inviteCompleted: 'onboarding.invite_completed',
    /** Durable mark on the account: an agent started this, with which model. */
    startedByAgent: 'onboarding.started_by_agent',
    agentDoorStarted: 'onboarding.agent_door_started',
    agentDoorResult: 'onboarding.agent_door_result',
    /**
     * The friendly nudge to an account nobody has seen for a fortnight. Accumulating, not
     * write-once: someone can go quiet more than once in a lifetime, and a write-once marker would
     * mean the second silence is never noticed. `sentAt` carries the last send, which is what the
     * cooldown is measured from.
     */
    inactivityNudge: 'onboarding.inactivity_nudge',
} as const;

/** Which onboarding path an account was created on. Cohorts are meaningless without it. */
export type OnboardingTrack = 'legacy' | 'remake';

export type OnboardingBranch = 'A' | 'B' | 'agent';

// A room id is FROZEN once anyone enters it: `onboarding.room_entered` is written with
// writeMarkerOnce, which has no update path. Renaming one later is a data migration, not an edit.
export type OnboardingRoom = 'create' | 'organise' | 'monetise' | 'company' | 'messages';

export const ownerGhii = (config: AimeatConfig, owner: string): string => `${owner}@${config.nodeId}`;

/**
 * Write a marker key once; returns false when it already existed.
 *
 * Exported so a sibling job (the inactivity nudge) uses THIS implementation rather than a
 * second copy: the ttlHours:null matters — a marker with a TTL is swept by the memory cleanup
 * job, and an idempotency marker that expires turns a one-off email into a recurring one.
 */
export async function writeMarkerOnce(
    storage: Storage, ownerGaii: string, key: string, value: Record<string, unknown>,
): Promise<boolean> {
    const existing = await storage.getMemory(ownerGaii, key);
    if (existing) return false;
    const now = new Date().toISOString();
    const marker = {
        key,
        ownerGaii,
        value,
        visibility: 'private' as const,
        tags: ['onboarding-funnel'],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };
    // Created only if still absent (createMemoryIfAbsent): of two callers at once, one writes the
    // marker and is answered true, and the other is answered false.
    return !!await storage.createMemoryIfAbsent(marker);
}

/**
 * The generic write-once remake marker. Every phase writes through this rather than reaching for
 * storage directly, so all of them share the same never-throw contract: funnel bookkeeping must
 * never be able to fail the thing it is measuring. Returns whether this call was the one that wrote.
 */
export async function recordOnboardingEvent(
    storage: Storage, config: AimeatConfig, owner: string,
    key: typeof ONBOARDING_KEYS[keyof typeof ONBOARDING_KEYS],
    value: Record<string, unknown>,
): Promise<boolean> {
    if (!owner) return false;
    try {
        const wrote = await writeMarkerOnce(storage, ownerGhii(config, owner), key, {
            at: new Date().toISOString(), ...value,
        });
        // The home feed used to DERIVE its rows by reading these markers back, so that the funnel
        // the operator reads and the screen the person reads could not disagree. That guarantee is
        // kept and moved: the event is recorded HERE, from the same fact in the same act, the
        // moment the marker is written. What it buys is a feed that reads one store instead of two,
        // which matters now that everything after onboarding is recorded rather than derived.
        //
        // Guarded on `wrote`, because these markers are write-once: a second attempt is not a second
        // event, and an owner who pasted the welcome mat twice did one thing.
        if (wrote) {
            const kind = FEED_KIND_FOR_MARKER[key];
            if (kind) {
                void recordAccountEvent(storage, {
                    ownerGhii: ownerGhii(config, owner),
                    kind,
                    subject: key,
                    link: FEED_LINK_FOR_MARKER[key]?.(owner) ?? '/v1/home',
                    data: feedDataFor(key, value),
                }, config);
            }
        }
        return wrote;
    } catch (err) {
        logger.warn('onboarding-funnel: marker failed', { owner, key, error: String(err) });
        return false;
    }
}

/**
 * Which markers are worth a line in the person's own record, and which are measurement only.
 *
 * Most of this funnel exists to tell an OPERATOR how onboarding is going — which branch was taken,
 * what model was detected, whether an invite went out. Those are not events in someone's life. The
 * four here are: your home exists, you made your mat, your agent arrived, your home is ready.
 */
const FEED_KIND_FOR_MARKER: Partial<Record<string, AccountEventKind>> = {
    [ONBOARDING_KEYS.welcomeMatPasted]: 'welcome_mat',
    [ONBOARDING_KEYS.firstAgentConnected]: 'agent_connected',
    [ONBOARDING_KEYS.homeInitialized]: 'home_initialized',
    [ONBOARDING_KEYS.roomEntered]: 'room_entered',
};

/** Where each row goes when clicked. Straight to the thing that was made, not to a page about it. */
export const FEED_LINK_FOR_MARKER: Partial<Record<string, (owner: string) => string>> = {
    [ONBOARDING_KEYS.welcomeMatPasted]: (owner) => `/v1/portfolio/${encodeURIComponent(owner)}`,
};

/** Only the values the translated line interpolates — never the whole marker. */
function feedDataFor(key: string, value: Record<string, unknown>): Record<string, string> {
    const pick = (k: string): string => (typeof value[k] === 'string' ? value[k] as string : '');
    if (key === ONBOARDING_KEYS.firstAgentConnected) return { name: pick('agentName') };
    if (key === ONBOARDING_KEYS.roomEntered) return { room: pick('room') };
    return {};
}
