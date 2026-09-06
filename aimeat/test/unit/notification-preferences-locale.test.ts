/**
 * @file notification-preferences-locale.test.ts
 * @description The language a person chose to be written to in, against real in-memory SQLite.
 *
 *   WHAT THIS PINS, and why it is one small file. `NotificationPreferences.locale` is on the
 *   interface and has been a Postgres column since the feature shipped. SQLite had no column, left
 *   the field out of the INSERT and the ON CONFLICT, and never deserialized it — and the upsert
 *   returned the CALLER'S OWN OBJECT, so the write looked like it took. Every push and every email
 *   from a SQLite node went out in English whatever the owner had picked, and the read site's
 *   `prefs.locale ?? 'en'` looked like a sensible default while it was covering the hole. Review
 *   items 5.3 and 4.8, 2026-09-06.
 *
 *   So the assertion is not "the field round-trips" but "the value comes back from the DATABASE".
 *   The upsert reads its row back now, which is the part that makes the next dropped field visible
 *   on the first read instead of months later.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-preferences-locale.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Written with the fix for review item 5.3.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, NotificationPreferences } from '../../src/storage/interface.js';

const NODE = 'pn-locale-test';
let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

function prefs(over: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    personalNodeId: NODE,
    enabled: true,
    channels: ['email'],
    notifyTypes: ['work_assignment'],
    cooldownMinutes: 5,
    quietHoursUtc: null,
    email: 'someone@example.test',
    ...over,
  };
}

describe('notification preferences: the chosen language survives the store', () => {
  it('a locale written comes back on the next READ, not just in the upsert answer', async () => {
    await storage.upsertNotificationPreferences(prefs({ locale: 'fi' }));
    const read = await storage.getNotificationPreferences(NODE);
    expect(read?.locale).toBe('fi');
  });

  it('and the upsert answers with what the database holds, not with what it was handed', async () => {
    // THE HALF THAT HID THE OTHER HALF. Returning the input made a field that reached no column
    // indistinguishable from one that did, for every caller, forever.
    const returned = await storage.upsertNotificationPreferences(prefs({ locale: 'es' }));
    expect(returned.locale).toBe('es');
    const read = await storage.getNotificationPreferences(NODE);
    expect(returned).toEqual(read);
  });

  it('an update can change it, and can clear it back to no preference', async () => {
    await storage.upsertNotificationPreferences(prefs({ locale: 'fi' }));
    await storage.upsertNotificationPreferences(prefs({ locale: 'es' }));
    expect((await storage.getNotificationPreferences(NODE))?.locale).toBe('es');

    await storage.upsertNotificationPreferences(prefs());
    const cleared = await storage.getNotificationPreferences(NODE);
    // Absent, not the string 'en': "no preference" is a different fact from "chose English", and the
    // node's own default is applied where the message is written.
    expect(cleared?.locale).toBeUndefined();
  });

  it('every other field still round-trips, so the column did not disturb its neighbours', async () => {
    const written = prefs({ locale: 'fi', channels: ['web_push', 'email'], cooldownMinutes: 42, quietHoursUtc: { start: '22:00', end: '07:00' } });
    await storage.upsertNotificationPreferences(written);
    const read = await storage.getNotificationPreferences(NODE);
    expect(read).toEqual(written);
  });
});
