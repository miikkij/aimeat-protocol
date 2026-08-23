/**
 * @file test/unit/compliance-snapshot-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `aimeat_compliance_snapshot` actually puts on the wire from the CLI dispatch —
 *   the door a fleet daemon calls.
 *
 *   WHY IT IS ITS OWN FILE. cli-tool-param-forwarding.test.ts probes one parameter at a time while
 *   holding the required ones at a sentinel, and this tool's two optional parameters are mutually
 *   exclusive: `since_days` only means something when the action is "save", and `id` only when it is
 *   not. One probe run cannot exercise both, so `id` is listed there as conditional and measured
 *   here instead. The entry in that list says so, and this file is what makes it true rather than
 *   merely claimed — an unreachable entry with no second measurement behind it is the move that
 *   turns an audit green while the defect stays.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-snapshot-dispatch.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. Written with the snapshot tool itself.
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/cli/connect/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function run(input: JsonObject): Promise<Sent[]> {
  const sent: Sent[] = [];
  const ok = { ok: true, data: {} } as never;
  const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve(ok); };
  const ctx = {
    client: {
      get: (p: string) => push('GET', p),
      post: (p: string, b?: unknown) => push('POST', p, b),
      put: (p: string, b?: unknown) => push('PUT', p, b),
      patch: (p: string, b?: unknown) => push('PATCH', p, b),
      delete: (p: string) => push('DELETE', p),
    },
    config: { agent: 'probe', owner: 'prober', node_url: 'http://node.test' },
    agentPath: 'probe',
  };
  const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_compliance_snapshot');
  if (!tool) throw new Error('aimeat_compliance_snapshot is not in the CLI dispatch table');
  return Promise.resolve(tool.handler(ctx as never, input)).then(() => sent);
}

describe('aimeat_compliance_snapshot reaches the node from /local/call', () => {
  it('lists without asking for anything in particular', async () => {
    const sent = await run({ action: 'list' });
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('GET');
    expect(sent[0].path).toBe('/v1/admin/compliance/reports');
  });

  it('puts the id on the wire when one is asked for', async () => {
    const sent = await run({ action: 'read', id: '2026-08-23-1930' });
    expect(sent[0].method).toBe('GET');
    expect(sent[0].path).toContain('id=2026-08-23-1930');
  });

  it('forwards an id even when the action does not say read', async () => {
    // The route decides what an id means; the dispatch does not hold a second opinion, because a
    // second opinion here can only ever drop a value the caller meant.
    const sent = await run({ action: 'list', id: '2026-08' });
    expect(sent[0].path).toContain('id=2026-08');
  });

  it('encodes an id rather than pasting it into the query', async () => {
    // URLSearchParams form-encodes, so the space becomes + and the separators become escapes. What
    // matters is that none of it survives as a second query parameter.
    const sent = await run({ action: 'read', id: 'a b&c=d' });
    expect(sent[0].path).not.toContain('a b&c=d');
    expect(sent[0].path).toContain('id=a+b%26c%3Dd');
  });

  it('saves with the window it was given', async () => {
    const sent = await run({ action: 'save', since_days: 90 });
    expect(sent[0].method).toBe('POST');
    expect(sent[0].path).toBe('/v1/admin/compliance/snapshot');
    expect(sent[0].body).toEqual({ since_days: 90 });
  });

  it('saves with no window rather than inventing one', async () => {
    const sent = await run({ action: 'save' });
    expect(sent[0].body).toEqual({});
  });
});
