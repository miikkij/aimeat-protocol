/**
 * @file test/unit/sdk-agents-create-task-ignored.test.ts
 * @description AIMEAT.agents.createTask names what it did not store (registry entry
 *   app/createtask-has-no-tags-field). The library builds the request body from the fields it
 *   knows, so `tags` on the task never left the page and the call still answered with a task. Now
 *   the returned task carries `ignored_fields`: the fields the library did not send, and the ones the
 *   node answered it did not take (POST /v1/agents/:name/tasks `ignored_fields`).
 *
 *   The library runs against a fake session (a route table), as the other SDK lib tests do. Seen red
 *   first: before the change the returned task had no ignored_fields.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-agents-create-task-ignored.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let agents: any;
let sent: any[];
let answer: Record<string, unknown>;

beforeAll(async () => {
  restore = installGlobals({});
  const session = {
    jwt: 'test', owner: 'alice', ghii: 'alice@node-1',
    fetch: async (path: string, opts: any = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST' && path === '/v1/agents/helper/tasks') {
        sent.push(JSON.parse(opts.body));
        return { ok: true, data: { task: { id: 't-' + sent.length, status: 'queued' }, ...answer } };
      }
      return { ok: false, error: { code: 'NOT_FOUND', message: 'no route ' + path } };
    },
  };
  (window as any).AIMEAT = { auth: { getSession: () => session } };
  await import('../../src/static/sdk-libs/agents/index.js');
  agents = (window as any).AIMEAT.agents;
});
afterAll(() => restore());
beforeEach(() => { sent = []; answer = {}; });

describe('createTask names what it did not store', () => {
  it('names a field the library does not send, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = await agents.createTask('helper', { description: 'sort the inbox', tags: ['inbox'] }, { allowDuplicate: true });
    expect(sent[0]).not.toHaveProperty('tags');
    expect(task.ignored_fields).toEqual(['tags']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('adds the fields the node answered it did not take', async () => {
    answer = { ignored_fields: ['colour'] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = await agents.createTask('helper', { description: 'file the receipts', tags: ['x'] }, { allowDuplicate: true });
    expect(task.ignored_fields).toEqual(['tags', 'colour']);
    warn.mockRestore();
  });

  it('leaves ignored_fields off a task whose every field was stored', async () => {
    const task = await agents.createTask('helper', { title: 'T', description: 'answer the mail', rules: ['be brief'] }, { allowDuplicate: true });
    expect(task).not.toHaveProperty('ignored_fields');
    expect(sent[0].rules).toEqual(['be brief']);
  });
});
