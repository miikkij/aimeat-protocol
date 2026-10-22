/**
 * @file test/unit/account-event-view.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The projection of an account-event row for its reader (services/account-event-view.ts):
 *   a task row's title and reason only for the readers the task route admits, every other kind
 *   unchanged (secaudit 2026-10, v89).
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89).
 */
import { describe, it, expect } from 'vitest';
import { projectAccountEvent, projectAccountEvents, type AccountEventReader } from '../../src/services/account-event-view.js';

const WORKER = 'worker#alice@node';
const reader = (r: Partial<AccountEventReader> & { words?: string[] }): AccountEventReader => ({
  principal: r.principal ?? 'someone',
  kind: r.kind ?? 'agent',
  inPerson: r.inPerson ?? false,
  has: (w: string) => (r.inPerson ?? false) || (r.words ?? []).includes(w),
});
const row = (kind: string, data: Record<string, string>) => ({ kind, at: '2026-10-22T00:00:00Z', actorGaii: WORKER, link: '/x', data });

describe('a task row for its reader', () => {
  const done = row('agent_task_done', { agent: 'worker', title: 'Write the report' });
  const declined = row('agent_task_declined', { agent: 'worker', title: 'Do the thing', reason: 'Out of scope' });

  it('keeps the content for the owner in person, an app holding task:read and the task\'s own agent', () => {
    for (const r of [reader({ kind: 'owner', inPerson: true }), reader({ kind: 'app', words: ['task:read'] }), reader({ kind: 'agent', principal: WORKER })]) {
      expect(projectAccountEvent(declined, r)).toBe(declined);
      expect(projectAccountEvent(done, r)).toBe(done);
    }
  });

  it('takes the title and the reason out for a sibling agent, an ecosystem app and an app without task:read, and keeps the rest', () => {
    for (const r of [reader({ kind: 'agent', principal: 'other#alice@node', words: ['*'] }), reader({ kind: 'ecosystem' }), reader({ kind: 'app', words: ['memory:read'] })]) {
      const shown = projectAccountEvent(declined, r);
      expect(shown.data).toEqual({ agent: 'worker' });
      expect(shown.withheld).toEqual(['title', 'reason']);
      expect([shown.kind, shown.at, shown.link]).toEqual([declined.kind, declined.at, declined.link]);
      expect(projectAccountEvent(done, r).withheld).toEqual(['title']);
      expect(projectAccountEvent(row('agent_task_failed', { agent: 'worker', title: 't' }), r).data).toEqual({ agent: 'worker' });
    }
  });

  it('passes every other kind unchanged, and says whether anything was taken out', () => {
    const app = row('app:shop:order_placed', { item: 'book' });
    const sibling = reader({ kind: 'agent', principal: 'other#alice@node' });
    expect(projectAccountEvent(app, sibling)).toBe(app);
    expect(projectAccountEvents([app], sibling).withheld).toBe(false);
    expect(projectAccountEvents([app, declined], sibling).withheld).toBe(true);
  });
});
