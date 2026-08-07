/**
 * @file src/services/home-rooms.ts
 * @description The four rooms (aimeat_remake/07-nelja-huonetta.md), and the check that decides
 *   whether each one is actually there.
 *
 *   They are ROOMS, not paths. All of them are open at once, the person chooses which to walk into
 *   first, and no door locks behind them. The word "path" is not used for these anywhere — not in
 *   the copy and not in the code.
 *
 *   E11: **a card is shown only when its room exists on THIS node.** Two of the four (monetising
 *   and company) are built but not everywhere deployed, and a door into an empty room breaks the
 *   product's own rule about empty states at the exact moment the person has finally got excited.
 *   So each room states HOW it is checked, and the two that cannot be inferred are operator flags
 *   defaulting to closed — see the note on the monetising room for what happens when you guess.
 * @structure ROOMS (the four, with their destinations) · openRooms(storage, config)
 * @usage
 *   import { openRooms } from '../services/home-rooms.js';
 *   const rooms = await openRooms(storage, config);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 7).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { OnboardingRoom } from './onboarding-funnel.js';
import { logger } from '../utils/logger.js';

export interface RoomDef {
    id: OnboardingRoom;
    /** Where the door leads. */
    url: string;
    /**
     * How to tell whether the room is really there.
     *   'always'  — a core surface every node serves.
     *   'flag'    — an operator has to say so, because "is it usable?" cannot be inferred.
     *   'company' — the company surface has to be usable on this node.
     */
    presence: 'always' | 'flag' | 'company';
}

/**
 * The four, in the order they are offered. The order is the design's, not a ranking: making is
 * first because it is the one with the shortest path to something a person can show someone else.
 */
export const ROOMS: readonly RoomDef[] = [
    // The catalog is a standalone static page, NOT an SPA route. /v1/app-store answers 200 because
    // the server serves the SPA shell there, but the SPA has no route for it and silently falls
    // back to the portal — a door that looks like it works and does not.
    { id: 'create', url: '/app-catalog.html', presence: 'always' },
    { id: 'organise', url: '/v1/profile?tab=organisms', presence: 'always' },
    // Behind an operator flag, default OFF.
    //
    // This began as "is the app published on this node?", which turned out to be the wrong
    // question: on 2026-08-07 that test answered OPEN on a node where walking in landed on a
    // permanent "Loading…" — the isolated app origin (H-2) has no session for someone arriving
    // cold, so the app never rendered. A published file is not a working destination, and no
    // cheap check separates the two. So this is a person's judgement, recorded once, instead of
    // an inference that is confidently wrong. E11: never open a door into a room with nothing.
    { id: 'monetise', url: '/app-catalog.html', presence: 'flag' },
    { id: 'company', url: '/v1/profile?tab=companies', presence: 'company' },
];

/**
 * The rooms that are actually open on this node, each with its destination.
 *
 * Never throws: a failed lookup closes that one door rather than taking down the home. A room that
 * cannot be confirmed is treated as absent, which is the safe direction — showing a door that
 * leads nowhere is the failure this check exists to prevent.
 */
export async function openRooms(
    _storage: Storage, config: AimeatConfig,
): Promise<Array<{ id: OnboardingRoom; url: string }>> {
    const out: Array<{ id: OnboardingRoom; url: string }> = [];
    for (const room of ROOMS) {
        let present = false;
        const url = room.url;
        try {
            if (room.presence === 'always') {
                present = true;
            } else if (room.presence === 'flag') {
                present = !!config.homeRoomMonetise;
            } else if (room.presence === 'company') {
                // The company surface counts as present when this node actually runs companies —
                // the company origin being configured is the node operator saying so.
                present = !!config.coOriginEnabled;
            }
        } catch (err) {
            logger.warn('home-rooms: presence check failed, treating the room as closed', {
                room: room.id, error: String(err),
            });
            present = false;
        }
        if (present && url) out.push({ id: room.id, url });
    }
    return out;
}
