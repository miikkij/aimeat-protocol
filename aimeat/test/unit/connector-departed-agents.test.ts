/**
 * @file test/unit/connector-departed-agents.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record of agents that left a connector home on the node's word
 *   (cli/connect/departed-agents.ts), and when the serve daemon writes it (cli/connect/forget-agent.ts).
 *
 *   The rules held here. Only the two reasons the node sends are recorded: 'moved' and 'deleted'.
 *   A revocation with no reason (a deactivated account) and an unknown word record nothing, and
 *   remove nothing. One record per identity. A record goes stale by age, or when the daemon carries
 *   the identity again. The file survives a reload, and a file that cannot be parsed is an empty
 *   one. forgetOnNodeWord records the departure before it detaches the agent.
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// The connector home is read once, when cli/connect/config.ts loads, so it is set before the import.
const home = mkdtempSync(join(tmpdir(), 'aimeat-departed-'));
const savedHome = process.env.AIMEAT_HOME;
process.env.AIMEAT_HOME = home;

const { recordDeparted, readDeparted, departedAgentsPath, isDepartureReason, DEPARTED_MAX_AGE_DAYS } =
  await import('../../src/cli/connect/departed-agents.js');
const { forgetOnNodeWord } = await import('../../src/cli/connect/forget-agent.js');
const { getConfigDir } = await import('../../src/cli/connect/config.js');

const NODE = 'aimeat-local-001-dev';
const who = (agent: string, owner = 'alice') => ({ gaii: `${agent}#${owner}@${NODE}`, agent, owner });
const day = 24 * 60 * 60 * 1000;
const keyFile = (agent: string, owner: string) => join(getConfigDir(), 'keys', `${agent}@${owner}.key`);

beforeEach(() => {
  rmSync(departedAgentsPath(), { force: true });
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.AIMEAT_HOME;
  else process.env.AIMEAT_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('what is recorded', () => {
  it('records the two reasons the node sends, with who left and when', () => {
    const now = new Date('2026-10-12T08:50:00.000Z');
    expect(recordDeparted(who('viive-testi'), 'deleted', now)).toEqual({
      gaii: `viive-testi#alice@${NODE}`, agent: 'viive-testi', owner: 'alice', reason: 'deleted', at: '2026-10-12T08:50:00.000Z',
    });
    expect(recordDeparted(who('watcher'), 'moved', now)?.reason).toBe('moved');
    expect(readDeparted([], now).map(r => [r.agent, r.reason])).toEqual([['viive-testi', 'deleted'], ['watcher', 'moved']]);
  });

  it('records nothing for a revocation with no reason: a deactivated account can be enabled again', () => {
    expect(recordDeparted(who('sleeper'), undefined)).toBeNull();
    expect(existsSync(departedAgentsPath())).toBe(false);
  });

  it('records nothing for a word the node does not send', () => {
    for (const word of ['', 'expired', 'DELETED', 'refused']) expect(recordDeparted(who('x'), word)).toBeNull();
    expect(isDepartureReason('moved') && isDepartureReason('deleted')).toBe(true);
    expect(readDeparted()).toEqual([]);
  });

  it('keeps one record per identity: the later departure replaces the earlier one', () => {
    recordDeparted(who('watcher'), 'moved', new Date('2026-10-01T00:00:00.000Z'));
    recordDeparted(who('watcher'), 'deleted', new Date('2026-10-02T00:00:00.000Z'));
    recordDeparted(who('watcher', 'bob'), 'moved', new Date('2026-10-02T00:00:00.000Z'));
    const rows = readDeparted([], new Date('2026-10-03T00:00:00.000Z'));
    expect(rows.map(r => [r.owner, r.reason])).toEqual([['alice', 'deleted'], ['bob', 'moved']]);
  });
});

describe('how a record goes stale', () => {
  it('drops a record past the age limit, at a read and at a write', () => {
    const then = new Date('2026-09-01T00:00:00.000Z');
    recordDeparted(who('old'), 'deleted', then);
    expect(readDeparted([], new Date(then.getTime() + DEPARTED_MAX_AGE_DAYS * day)).length).toBe(1);
    recordDeparted(who('old'), 'deleted', then);
    expect(readDeparted([], new Date(then.getTime() + DEPARTED_MAX_AGE_DAYS * day + 1000))).toEqual([]);
    expect(JSON.parse(readFileSync(departedAgentsPath(), 'utf-8')).departed).toEqual([]);

    recordDeparted(who('old'), 'deleted', then);
    recordDeparted(who('new'), 'moved', new Date(then.getTime() + 40 * day));
    expect(JSON.parse(readFileSync(departedAgentsPath(), 'utf-8')).departed.map((r: { agent: string }) => r.agent)).toEqual(['new']);
  });

  it('drops the record of an identity the daemon carries again, and leaves the namesake of another owner', () => {
    recordDeparted(who('leaver'), 'deleted');
    recordDeparted(who('leaver', 'bob'), 'deleted');
    expect(readDeparted([`leaver#alice@${NODE}`]).map(r => r.owner)).toEqual(['bob']);
    expect(JSON.parse(readFileSync(departedAgentsPath(), 'utf-8')).departed.length).toBe(1);
    expect(readDeparted().map(r => r.owner)).toEqual(['bob']);
  });

  it('never drops a record because it was read', () => {
    recordDeparted(who('leaver'), 'deleted');
    expect(readDeparted().length).toBe(1);
    expect(readDeparted().length).toBe(1);
  });
});

describe('the file', () => {
  it('is in the connector home, and what a daemon started later reads', () => {
    recordDeparted(who('leaver'), 'moved');
    expect(dirname(departedAgentsPath())).toBe(getConfigDir());
    const doc = JSON.parse(readFileSync(departedAgentsPath(), 'utf-8'));
    expect(doc.schema_version).toBe(1);
    expect(Object.keys(doc.departed[0]).sort()).toEqual(['agent', 'at', 'gaii', 'owner', 'reason']);
  });

  it('is treated as empty when it cannot be parsed, and the next record replaces it', () => {
    writeFileSync(departedAgentsPath(), '{ not json', 'utf-8');
    expect(readDeparted()).toEqual([]);
    recordDeparted(who('leaver'), 'deleted');
    expect(readDeparted().map(r => r.agent)).toEqual(['leaver']);
  });

  it('ignores rows that are not records', () => {
    writeFileSync(departedAgentsPath(), JSON.stringify({ schema_version: 1, departed: [
      { gaii: 'a#o@n', agent: 'a', owner: 'o', reason: 'deleted', at: new Date().toISOString() },
      { gaii: 'b#o@n', agent: 'b', owner: 'o', reason: 'lost', at: new Date().toISOString() },
      { gaii: 'c#o@n', agent: 'c', owner: 'o', reason: 'moved', at: 'not a time' },
      'text', null,
    ] }), 'utf-8');
    expect(readDeparted().map(r => r.agent)).toEqual(['a']);
  });
});

describe('when the serve daemon writes it (forgetOnNodeWord)', () => {
  const lay = (agent: string, owner: string): void => {
    mkdirSync(dirname(keyFile(agent, owner)), { recursive: true });
    writeFileSync(keyFile(agent, owner), '{"kid":"k"}', 'utf-8');
  };

  it('records the departure before it detaches the agent, for both reasons', () => {
    for (const reason of ['deleted', 'moved']) {
      rmSync(departedAgentsPath(), { force: true });
      lay('leaver', 'alice');
      let recordedAtDetach = -1;
      forgetOnNodeWord(reason, 'leaver', 'alice', () => { recordedAtDetach = readDeparted().length; }, `leaver#alice@${NODE}`);
      expect(recordedAtDetach).toBe(1);
      expect(readDeparted().map(r => [r.gaii, r.reason])).toEqual([[`leaver#alice@${NODE}`, reason]]);
    }
  });

  it('with no reason it records nothing, detaches nothing and removes nothing', () => {
    lay('sleeper', 'alice');
    let detached = false;
    forgetOnNodeWord(undefined, 'sleeper', 'alice', () => { detached = true; }, `sleeper#alice@${NODE}`);
    expect(detached).toBe(false);
    expect(readDeparted()).toEqual([]);
    expect(existsSync(keyFile('sleeper', 'alice'))).toBe(true);
  });
});
