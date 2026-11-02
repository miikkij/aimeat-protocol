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
 * @structure notePersonZone(owner, zone, locale) · personZone(owner) · personLocale(owner)
 * @usage notePersonZone(ownerName, opts.timezone, locale); const zone = prefs.timezone ?? personZone(ownerName);
 * @version-history
 *   v1.1.0 — 2026-11-02 — The chat page's language is kept with the zone, so a time is written in the
 *     language of the answer (crew73: a Spanish answer quoted "2.11. klo 7.00").
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { isValidTimeZone } from './display-prefs.js';
import type { Locale } from '../i18n.js';

/** The most people one process remembers; the oldest goes first. A node has a handful. */
const MAX_PEOPLE = 10_000;

const zones = new Map<string, { zone: string; locale?: Locale }>();

/**
 * Remember the zone a person's browser sent, and the language their chat page speaks, which the
 * node writes a time in for that chat. An unknown zone is not remembered.
 */
export function notePersonZone(owner: string, zone: unknown, locale?: Locale): void {
  if (!owner || !isValidTimeZone(zone)) return;
  zones.delete(owner);
  zones.set(owner, { zone, ...(locale ? { locale } : {}) });
  if (zones.size > MAX_PEOPLE) zones.delete(zones.keys().next().value as string);
}

/** The zone a person's browser last sent, or null. */
export function personZone(owner: string): string | null {
  return zones.get(owner)?.zone ?? null;
}

/** The language of the chat page that last sent the zone, or null. */
export function personLocale(owner: string): Locale | null {
  return zones.get(owner)?.locale ?? null;
}
