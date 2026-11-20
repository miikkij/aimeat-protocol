/**
 * @file test/unit/report-subscriptions.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Report subscriptions (services/reports/subscriptions.ts): a record is read as a
 *   subscription or refused with its reason; a cadence is due when it should be and not twice a day;
 *   the writer's rights are read at the send, so a person who is not an operator never sends a node
 *   report; a report with nothing in it is not sent; one with something is sent once and stamped.
 * @usage pnpm exec vitest run test/unit/report-subscriptions.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-20 — lastSkip as a code, said once; an invalid record says why; organism measures parse.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 4).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  parseSubscription, isDue, recipientsOf, runReportSubscriptions, SUBSCRIPTION_PREFIX, type ReportSubscription,
} from '../../src/services/reports/subscriptions.js';
import { parseMeasure } from '../../src/services/value/measures.js';

const NODE = 'aimeat-local-001-dev';
const ALICE = `alice@${NODE}`;
const config = { nodeId: NODE } as AimeatConfig;

const sub = (over: Partial<ReportSubscription> = {}): ReportSubscription => ({
  id: 's1', name: 'My week', scope: 'own', recipients: 'me', cadence: 'weekly', contents: ['value'], ...over,
});

describe('reading a record as a subscription', () => {
  it('takes a valid record and fills the defaults', () => {
    const r = parseSubscription('s1', { scope: 'own', cadence: 'weekly', contents: ['value', 'data'] });
    expect(r.ok && r.sub).toMatchObject({ id: 's1', scope: 'own', recipients: 'me', cadence: 'weekly', contents: ['value', 'data'] });
  });

  it('refuses a record that would send someone else\'s report or reach the wrong people', () => {
    expect(parseSubscription('a', { scope: 'own', cadence: 'daily', recipients: 'members' })).toMatchObject({ ok: false });
    expect(parseSubscription('b', { scope: 'organism', cadence: 'daily' })).toMatchObject({ ok: false, reason: 'orgId is required' });
    expect(parseSubscription('c', { scope: 'organism', orgId: 'o1', cadence: 'daily', recipients: 'operators' })).toMatchObject({ ok: false });
    expect(parseSubscription('d', { scope: 'own', cadence: 'cron', cron: 'not a cron' })).toMatchObject({ ok: false });
    expect(parseSubscription('e', { scope: 'own', cadence: 'yearly' })).toMatchObject({ ok: false });
  });
});

describe('reading a record as an organism measure', () => {
  it('takes a count with a condition and a period, and a mean of a nested field', () => {
    expect(parseMeasure('m', { name: 'Offers sent', wsId: 'deals', space: 'offer', op: 'count', where: [{ field: 'status', value: 'sent' }], per: 'week' }))
      .toMatchObject({ ok: true, measure: { op: 'count', per: 'week', where: [{ field: 'status', value: 'sent' }] } });
    expect(parseMeasure('m', { wsId: 'deals', space: 'offer', op: 'avg', field: 'customer.amount' })).toMatchObject({ ok: true, measure: { name: 'm', field: 'customer.amount' } });
  });
  it('refuses a measure without its number, with a field that is not a path, or with an unknown period', () => {
    expect(parseMeasure('a', { wsId: 'deals', space: 'offer', op: 'sum' })).toMatchObject({ ok: false });
    expect(parseMeasure('b', { wsId: 'deals', space: 'offer', op: 'count', where: [{ field: "x') OR 1=1 --", value: 1 }] })).toMatchObject({ ok: false });
    expect(parseMeasure('c', { wsId: 'deals', space: 'offer', op: 'count', per: 'year' })).toMatchObject({ ok: false });
    expect(parseMeasure('d', { wsId: '../other', space: 'offer', op: 'count' })).toMatchObject({ ok: false });
  });
});

describe('when a subscription is due', () => {
  const monday8 = new Date('2026-11-23T08:00:00.000Z');
  it('weekly on its weekday after its hour, once that day', () => {
    expect(isDue(sub(), monday8)).toBe(true);
    expect(isDue(sub({ lastSentAt: '2026-11-23T07:30:00.000Z' }), monday8)).toBe(false);
    expect(isDue(sub(), new Date('2026-11-23T06:00:00.000Z'))).toBe(false);
    expect(isDue(sub(), new Date('2026-11-24T08:00:00.000Z'))).toBe(false);
  });
  it('every other day on the even days of the month, monthly on its day, never when paused', () => {
    expect(isDue(sub({ cadence: 'every-other-day' }), new Date('2026-11-22T08:00:00.000Z'))).toBe(true);
    expect(isDue(sub({ cadence: 'every-other-day' }), new Date('2026-11-23T08:00:00.000Z'))).toBe(false);
    expect(isDue(sub({ cadence: 'monthly' }), new Date('2026-12-01T08:00:00.000Z'))).toBe(true);
    expect(isDue(sub({ paused: true }), monday8)).toBe(false);
  });
  it('a cron cadence once its next time after the last send has passed', () => {
    expect(isDue(sub({ cadence: 'cron', cron: '0 6 * * *', lastSentAt: '2026-11-22T06:00:00.000Z' }), monday8)).toBe(true);
    expect(isDue(sub({ cadence: 'cron', cron: '0 6 * * *', lastSentAt: '2026-11-23T06:00:00.000Z' }), monday8)).toBe(false);
  });
});

describe('sending', () => {
  let storage: Storage;
  beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }); });

  const put = (key: string, value: Record<string, unknown>, at = '2026-11-23T08:00:00.000Z') => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
  });

  it('a node report needs the writer to be an operator at the send', async () => {
    const r = await recipientsOf(storage, config, ALICE, sub({ scope: 'node', recipients: 'operators' }));
    expect(r).toEqual({ ok: false, reason: 'not-operator' });
  });

  it('an organism report needs the writer to own the organism', async () => {
    const r = await recipientsOf(storage, config, ALICE, sub({ scope: 'organism', orgId: 'missing-org', recipients: 'owners' }));
    expect(r).toEqual({ ok: false, reason: 'organism-gone' });
  });

  it('a refused send says why once, and the next run does not write the same reason again', async () => {
    const key = `${SUBSCRIPTION_PREFIX}node-week`;
    await put(key, { name: 'Node week', scope: 'node', recipients: 'operators', cadence: 'daily', contents: ['rhythm'] });
    const now = new Date('2026-11-23T08:00:00.000Z');
    expect(await runReportSubscriptions(storage, config, now)).toBe(0);
    const first = await storage.getMemory(ALICE, key);
    expect((first!.value as Record<string, unknown>).lastSkip).toBe('not-operator');
    await runReportSubscriptions(storage, config, new Date('2026-11-23T08:15:00.000Z'));
    expect((await storage.getMemory(ALICE, key))!.version).toBe(first!.version);
    await storage.deleteMemory(ALICE, key);
  });

  it('a record that is not a subscription says what is wrong in it, once', async () => {
    const key = `${SUBSCRIPTION_PREFIX}broken`;
    await put(key, { name: 'Broken', scope: 'own', cadence: 'yearly' });
    await runReportSubscriptions(storage, config, new Date('2026-11-23T08:00:00.000Z'));
    const first = await storage.getMemory(ALICE, key);
    expect(first!.value).toMatchObject({ lastSkip: 'invalid', lastSkipDetail: expect.stringContaining('cadence') });
    await runReportSubscriptions(storage, config, new Date('2026-11-23T08:15:00.000Z'));
    expect((await storage.getMemory(ALICE, key))!.version).toBe(first!.version);
    await storage.deleteMemory(ALICE, key);
  });

  it('a report with nothing in it is not sent; one with AI work is sent once and stamped', async () => {
    const now = new Date('2026-11-23T08:00:00.000Z');
    const key = `${SUBSCRIPTION_PREFIX}week`;
    await storage.setMemory({
      key, ownerGaii: ALICE, value: { name: 'My week', scope: 'own', cadence: 'weekly', contents: ['value'] },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
    expect(await runReportSubscriptions(storage, config, now)).toBe(0);
    const quiet = await storage.getMemory(ALICE, key);
    expect((quiet!.value as Record<string, unknown>).lastSkip).toBe('nothing');

    // The next Monday, with AI work in the week before.
    const next = new Date('2026-11-30T08:00:00.000Z');
    await storage.upsertValueDaily([{ day: '2026-11-27', ownerGhii: ALICE, orgId: '', wsId: '', producer: `claude#alice@${NODE}`, family: 'report.*', signal: 'produced', count: 2, bytes: 10 }]);
    expect(await runReportSubscriptions(storage, config, next)).toBe(1);
    const stamped = await storage.getMemory(ALICE, key);
    expect((stamped!.value as Record<string, unknown>).lastSentAt).toBe(next.toISOString());
    expect(await runReportSubscriptions(storage, config, next)).toBe(0);
  });
});
