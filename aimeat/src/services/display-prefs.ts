/**
 * @file src/services/display-prefs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How one person wants dates, times and numbers written, and which clock they read.
 *   The validation both write doors use, and the read the node uses when IT writes a time.
 *
 *   THREE SETTINGS, NOT ONE, and the split is the whole point. `locale` is the LANGUAGE — which
 *   words a person reads, and, load-bearing, the language their email is sent in
 *   (routes/ghii/attach-email.ts). `region` is how a date and a number are WRITTEN. `timezone` is
 *   which clock. An operating system keeps these three apart and lets a person mix them freely; so
 *   does this. Deriving the format from the language is the defect this module exists to end: six
 *   copies of `localeTag()` in public/views/profile did exactly that, and they had already drifted
 *   apart from each other.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   ABSENT MEANS FOLLOW THE READER'S BROWSER. That is what every surface did before these fields
 *   existed, so an account that never opened the settings behaves exactly as it always has. Nobody
 *   is migrated into a preference they did not express, and `null` is a real answer here rather
 *   than a missing one.
 *
 *   THE SERVER SIDE IS WHY THEY ARE STORED AT ALL. A browser can tell you its own zone; it cannot
 *   tell the node anything when the node is writing an email or a notification at three in the
 *   morning. Today nothing in src/ formats a date for a person — measured 2026-09-12, zero
 *   `toLocale*` calls outside app templates — so this module's readers are the surfaces that come
 *   next, and `displayPrefsFor` is the one door they use.
 * @structure
 *   - isValidRegion(tag) / isValidTimeZone(zone) — the two validators, ICU-backed
 *   - DisplayPrefs, displayPrefsFor(storage, ghiiOrOwner)
 *   - formatForPerson(prefs, iso, opts) — one date, written the way that person writes dates
 * @usage
 *   import { isValidRegion, isValidTimeZone, displayPrefsFor } from '../services/display-prefs.js';
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the profile's region and timezone fields.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** What one person's surfaces should use. Null in either means follow the reader's browser. */
export interface DisplayPrefs {
  /** Which words. Also the language their email is written in. */
  locale: string | null;
  /** How a date and a number are written, as a BCP-47 tag. */
  region: string | null;
  /** Which clock, as an IANA zone. */
  timezone: string | null;
}

/**
 * Is this a language tag the platform can actually format with?
 *
 * ICU is the authority rather than a regex: `Intl.getCanonicalLocales` throws a RangeError on a
 * malformed tag, and a tag that is well-formed but unknown still formats (it falls back), which is
 * the behaviour we want. A regex would either refuse valid tags nobody thought of or admit ones
 * that throw at the first format call — and that call happens in the reader's browser, far from
 * here.
 */
export function isValidRegion(tag: unknown): tag is string {
  if (typeof tag !== 'string' || tag.trim() === '' || tag.length > 35) return false;
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    // The throw IS the answer. getCanonicalLocales raises a RangeError on a malformed tag and on
    // nothing else, so catching it is how this question is asked; there is no failure to hide.
    // eslint-disable-next-line aimeat/no-silent-catch -- the RangeError is the negative answer
    return false;
  }
}

/**
 * Is this an IANA zone this runtime knows?
 *
 * Asked by trying to build a formatter with it, which is the only test that matches what will
 * happen later. `UTC` and `Europe/Helsinki` pass; `GMT+2` and `Finland` do not, and refusing them
 * here is the point — an offset is not a zone, because an offset does not know about summer time.
 */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.trim() === '' || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    // Same shape as above: building the formatter IS the test, and a RangeError from it means
    // exactly "this runtime does not know that zone".
    // eslint-disable-next-line aimeat/no-silent-catch -- the RangeError is the negative answer
    return false;
  }
}

/**
 * What one person's surfaces should use, by GHII or by bare owner name.
 *
 * Every field can be null, and a person with no GHII record at all reads as three nulls rather
 * than as an error: not having expressed a preference is the ordinary case, not a failure.
 */
export async function displayPrefsFor(storage: Storage, who: string): Promise<DisplayPrefs> {
  const none: DisplayPrefs = { locale: null, region: null, timezone: null };
  try {
    const record = who.includes('@')
      ? await storage.getGHII(who)
      : await storage.getGHIIByOwner(who);
    if (!record) return none;
    return {
      locale: record.locale ?? null,
      region: record.region ?? null,
      timezone: record.timezone ?? null,
    };
  } catch (err) {
    logger.warn('displayPrefsFor: falling back to no preference', { who, error: String(err) });
    return none;
  }
}

/**
 * One ISO timestamp, written the way this person writes timestamps.
 *
 * For the surfaces that have no browser to ask — an email, a notification, a report the node
 * generates. A null region falls through to the runtime's own format, which is the honest answer
 * when nobody has said otherwise.
 *
 * A NULL ZONE IS NAMED, and this is the one place the function adds something of its own. Leaving
 * the zone to the runtime would print the HOST's clock — whatever the container happens to be set
 * to — with nothing to say so, and a time that looks local and is not is worse than an ISO string.
 * So an unchosen zone is UTC and the line says UTC. A zone the person did choose needs no marker:
 * it is their own clock, and stamping it would only add noise to every line. The marker appears
 * only when the options actually render a CLOCK; on a date alone it would be noise of a second
 * kind, since nobody reads "19 September 2026 UTC" as anything but a typo.
 */
export function formatForPerson(
  prefs: DisplayPrefs,
  iso: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso;
  const chosen = prefs.timezone ?? null;
  const showsAClock = !!(opts.timeStyle || opts.hour || opts.minute || opts.second || opts.timeZoneName);
  const mark = chosen || !showsAClock ? '' : ' UTC';
  try {
    return new Intl.DateTimeFormat(prefs.region ?? undefined, { ...opts, timeZone: chosen ?? 'UTC' }).format(at) + mark;
  } catch (err) {
    // A stored preference the runtime later refuses must not take the whole message down: fall back
    // one step at a time rather than all the way to an ISO string, so a bad ZONE does not also cost
    // the person the date format they asked for.
    logger.warn('formatForPerson: the stored preference did not format', {
      region: prefs.region, timezone: prefs.timezone, error: String(err),
    });
    try {
      return new Intl.DateTimeFormat(prefs.region ?? undefined, { ...opts, timeZone: 'UTC' }).format(at)
        + (showsAClock ? ' UTC' : '');
    } catch {
      // Both the region and the zone were refused. The timestamp itself is still worth sending.
      return at.toISOString();
    }
  }
}
