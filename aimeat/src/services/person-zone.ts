/**
 * @file src/services/person-zone.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The time zone a person's browser last sent with a chat turn (routes/chat.ts), so the
 *   node can write a time on their clock when they have chosen no zone of their own: the home feed's
 *   rows for their chat (services/home-feed.ts). In this process only and never written anywhere: it
 *   is a fact about the browser in front of them now, not a setting, and the zone they choose in their
 *   settings always wins. A restart forgets it until their next chat turn, which is what asks for it.
 *
 *   On crew72 the chat read the feed's UTC times and gave them as they were ("kello 02 : 10" for a
 *   run at 04.10 Finnish time), although the turn note asked it to convert them (commercial-88, 2.11).
 * @structure notePersonZone(owner, zone) · personZone(owner)
 * @usage notePersonZone(ownerName, opts.timezone); const zone = prefs.timezone ?? personZone(ownerName);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { isValidTimeZone } from './display-prefs.js';

/** The most people one process remembers; the oldest goes first. A node has a handful. */
const MAX_PEOPLE = 10_000;

const zones = new Map<string, string>();

/** Remember the zone a person's browser sent. An unknown zone is not remembered. */
export function notePersonZone(owner: string, zone: unknown): void {
  if (!owner || !isValidTimeZone(zone)) return;
  zones.delete(owner);
  zones.set(owner, zone);
  if (zones.size > MAX_PEOPLE) zones.delete(zones.keys().next().value as string);
}

/** The zone a person's browser last sent, or null. */
export function personZone(owner: string): string | null {
  return zones.get(owner) ?? null;
}
