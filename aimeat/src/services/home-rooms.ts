/**
 * @file src/services/home-rooms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rooms (aimeat_remake/07-nelja-huonetta.md), and the check that decides whether
 *   each one is actually there.
 *
 *   They are ROOMS, not paths. All of them are open at once, the person chooses which to walk into
 *   first, and no door locks behind them. The word "path" is not used for these anywhere — not in
 *   the copy and not in the code.
 *
 *   E11: **a card is shown only when its room exists.** Two of them (monetising
 *   and company) are built but not everywhere deployed, and a door into an empty room breaks the
 *   product's own rule about empty states at the exact moment the person has finally got excited.
 *   So each room states HOW it is checked, and the two that cannot be inferred are operator flags
 *   defaulting to closed — see the note on the monetising room for what happens when you guess.
 * @structure ROOMS (with their destinations) · openRooms(storage, config, ownerGhii?)
 * @usage
 *   import { openRooms } from '../services/home-rooms.js';
 *   const rooms = await openRooms(storage, config, resolveIdentity(req.auth!, config.nodeId));
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 7).
 *   v1.1.0 — 2026-08-07 — The mailbox room, and with it a presence kind that asks about the
 *     ACCOUNT rather than the node ('has-content'). openRooms takes the owner GHII to answer it.
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
     *   'always'      — a core surface every node serves.
     *   'flag'        — an operator has to say so, because "is it usable?" cannot be inferred.
     *   'company'     — the company surface has to be usable on this node.
     *   'has-content' — the room holds THINGS rather than offering an action, so it is only real
     *                   when this account has some. See the note on the messages room.
     */
    presence: 'always' | 'flag' | 'company' | 'has-content';
}

/**
 * The rooms, in the order they are offered. The order is the design's, not a ranking: making is
 * first because it is the one with the shortest path to something a person can show someone else,
 * and the mailbox is last because it is not an ambition anyone arrives with — it fills by itself.
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
    // The mailbox, last — and the only room gated on THIS ACCOUNT rather than on this node.
    //
    // The other four are DOING rooms: you walk in to make something, so finding them empty is the
    // point of going. This one is a CONTENTS room: you walk in to read what arrived, so empty is
    // not a starting state, it is the whole content. E11 forbids exactly that door.
    //
    // In practice a new account is never empty — the operator's welcome is delivered at
    // registration (services/welcome-message.ts), so the card is there from the first render.
    // The check earns its keep on ACCOUNTS THAT ALREADY EXISTED when this shipped: nobody
    // welcomed them, and without the check every one of them would get a door into nothing.
    { id: 'messages', url: '/v1/profile?tab=messages', presence: 'has-content' },
];

/**
 * The rooms that are actually open for this account, each with its destination.
 *
 * Never throws: a failed lookup closes that one door rather than taking down the home. A room that
 * cannot be confirmed is treated as absent, which is the safe direction — showing a door that
 * leads nowhere is the failure this check exists to prevent.
 */
export async function openRooms(
    storage: Storage, config: AimeatConfig, ownerGhii?: string,
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
            } else if (room.presence === 'has-content') {
                // One indexed count, asking only "is there at least one?" — perPage 1 so a busy
                // mailbox costs the same as an empty one. No caller id (a node-level listing with
                // no account to ask about) means the answer is no, which is the safe direction.
                if (ownerGhii) {
                    const { total } = await storage.listInbox(ownerGhii, { perPage: 1 });
                    present = total > 0;
                }
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
