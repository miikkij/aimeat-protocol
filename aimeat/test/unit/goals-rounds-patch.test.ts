/**
 * @file test/unit/goals-rounds-patch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A change to a goal's rounds keeps what it does not name, and a clock round with an
 *   empty cron is refused on change as on create (group k3-goalrounds, 2026-11-08). The Settings page
 *   saves the rounds with the trigger and the cron only; before the fix that save replaced the rounds
 *   whole, so the goal lost its time zone and its works per round. Pure functions: buildGoal() and
 *   applyPatch() from services/goals/goals-create.ts, the code both PATCH /v1/goals/{id} and the
 *   aimeat_goal_set MCP tool run (goals-ops.ts patchOp).
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-rounds-patch.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (group k3-goalrounds).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const quiet: unknown = new Proxy({}, { get: () => () => quiet });
  return { ...real, logger: quiet };
});

const { buildGoal, applyPatch, GoalInputSchema, GoalPatchSchema } = await import('../../src/services/goals/goals-create.js');
const { GoalError } = await import('../../src/services/goals/goals-store.js');
type Access = Parameters<typeof buildGoal>[0];

const owner: Access = { ownerGhii: 'alice@node-test', ownerName: 'alice', person: true, agent: null, who: 'owner' };

function roundGoal() {
  return buildGoal(owner, GoalInputSchema.parse({
    statement: 'Check the overnight orders every weekday morning.',
    rounds: { trigger: 'clock', cron: '0 7 * * 1-5', timezone: 'Europe/Helsinki', works: [{ title: 'Read the orders' }, { title: 'Write the summary' }] },
  }));
}

describe('a change to the rounds keeps what it does not name', () => {
  it('updating the rounds with only the cron keeps the time zone and the works per round', () => {
    const goal = roundGoal();
    expect(goal.rounds?.timezone).toBe('Europe/Helsinki');
    const next = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'clock', cron: '0 9 * * 1' } }), owner);
    expect(next.rounds?.cron).toBe('0 9 * * 1');
    expect(next.rounds?.timezone).toBe('Europe/Helsinki');
    expect(next.rounds?.template.map(w => w.title)).toEqual(['Read the orders', 'Write the summary']);
    expect(next.rounds?.nextAt).toBeTruthy();
  });

  it('a field given empty clears it, and a field given replaces it', () => {
    const goal = roundGoal();
    const next = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'clock', cron: '0 9 * * 1', timezone: '', works: [] } }), owner);
    expect(next.rounds?.timezone).toBeUndefined();
    expect(next.rounds?.template).toEqual([]);
    const other = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'clock', timezone: 'America/New_York', works: [{ title: 'Only this' }] } }), owner);
    expect(other.rounds?.cron).toBe('0 7 * * 1-5');
    expect(other.rounds?.timezone).toBe('America/New_York');
    expect(other.rounds?.template.map(w => w.title)).toEqual(['Only this']);
  });

  it('a manual round keeps no cron, and only a condition round keeps its condition', () => {
    const goal = buildGoal(owner, GoalInputSchema.parse({
      statement: 'Answer new reviews when one is unhappy.',
      rounds: { trigger: 'condition', cron: '0 */4 * * *', condition: 'a review has two stars or fewer', timezone: 'Europe/Helsinki' },
    }));
    const manual = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'manual' } }), owner);
    expect(manual.rounds?.cron).toBeUndefined();
    expect(manual.rounds?.condition).toBeUndefined();
    expect(manual.rounds?.timezone).toBe('Europe/Helsinki');
    const clock = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'clock' } }), owner);
    expect(clock.rounds?.cron).toBe('0 */4 * * *');
    expect(clock.rounds?.condition).toBeUndefined();
    const same = applyPatch(goal, GoalPatchSchema.parse({ rounds: { trigger: 'condition', cron: '0 8 * * *' } }), owner);
    expect(same.rounds?.condition).toBe('a review has two stars or fewer');
  });

  it('the round count and the last round stay through a change', () => {
    const goal = roundGoal();
    const ran = { ...goal, rounds: { ...goal.rounds!, count: 4, lastAt: '2026-11-07T05:00:00.000Z' } };
    const next = applyPatch(ran, GoalPatchSchema.parse({ rounds: { trigger: 'clock', cron: '0 8 * * *' } }), owner);
    expect(next.rounds?.count).toBe(4);
    expect(next.rounds?.lastAt).toBe('2026-11-07T05:00:00.000Z');
  });
});

describe('a clock round names its cron, on change as on create', () => {
  it('an empty cron on a clock round is refused on update', () => {
    const goal = roundGoal();
    const refused = (patch: unknown) => {
      try { applyPatch(goal, GoalPatchSchema.parse(patch), owner); return null; }
      catch (err) { return err; }
    };
    for (const patch of [{ rounds: { trigger: 'clock', cron: '' } }, { rounds: { trigger: 'clock', cron: '   ' } }]) {
      const err = refused(patch);
      expect(err).toBeInstanceOf(GoalError);
      expect((err as InstanceType<typeof GoalError>).status).toBe(400);
    }
    // A manual goal switched to the clock without a cron has none to keep.
    const manual = buildGoal(owner, GoalInputSchema.parse({ statement: 'Run when I say.', rounds: { trigger: 'manual' } }));
    expect(() => applyPatch(manual, GoalPatchSchema.parse({ rounds: { trigger: 'clock' } }), owner)).toThrow(GoalError);
  });

  it('create still refuses a clock round without a cron, and still accepts one with it', () => {
    expect(() => buildGoal(owner, GoalInputSchema.parse({ statement: 'x', rounds: { trigger: 'clock' } }))).toThrow(GoalError);
    expect(roundGoal().rounds?.cron).toBe('0 7 * * 1-5');
  });
});
