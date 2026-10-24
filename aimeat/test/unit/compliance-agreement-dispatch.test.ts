/**
 * @file test/unit/compliance-agreement-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `aimeat_compliance_agreement` puts on the wire from the CLI dispatch (the
 *   connector's /local/call, the door a fleet daemon such as aimeat-commercial calls).
 *
 *   WHY IT IS ITS OWN FILE. cli-tool-param-forwarding.test.ts probes one parameter at a time with the
 *   required `action` held at one sentinel value, and every other parameter of this tool belongs to
 *   one action only (`storage_key` to signed_copy, `choice` to end, `note` to deletion_done…). One
 *   probe run cannot reach them, so they are listed there as conditional and measured here, one case
 *   per action, which is what makes that entry true rather than claimed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-agreement-dispatch.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Written with the agreements tool (plan doc-mvmr4i2wdk0p).
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

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
  const tool = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_compliance_agreement');
  if (!tool) throw new Error('aimeat_compliance_agreement is not in the CLI dispatch table');
  return Promise.resolve(tool.handler(ctx as never, input)).then(() => sent);
}

const BASE = '/v1/compliance/agreements';
const ID = 'dpa-abc123def';

describe('aimeat_compliance_agreement reaches the node from /local/call', () => {
  it('get puts the id in the path, encoded', async () => {
    const [s] = await run({ action: 'get', id: ID });
    expect(s).toEqual({ method: 'GET', path: `${BASE}/${ID}`, body: undefined });
  });

  it('document asks for one version', async () => {
    const [s] = await run({ action: 'document', id: ID, version: 2 });
    expect(s.path).toBe(`${BASE}/${ID}/document?format=json&version=2`);
  });

  it('create forwards dry_run and the input', async () => {
    const [s] = await run({ action: 'create', dry_run: true, input: { product: 'box' } });
    expect(s.method).toBe('POST');
    expect(s.path).toBe(`${BASE}?dry_run=true`);
    expect(s.body).toEqual({ product: 'box' });
  });

  it('send forwards the message', async () => {
    const [s] = await run({ action: 'send', id: ID, message: 'Please sign' });
    expect(s).toEqual({ method: 'POST', path: `${BASE}/${ID}/send`, body: { message: 'Please sign' } });
  });

  it('signed_copy forwards storage_key, kind and party', async () => {
    const [s] = await run({ action: 'signed_copy', id: ID, storage_key: 'agreements/x.pdf', kind: 'pdf', party: 'controller' });
    expect(s).toEqual({ method: 'POST', path: `${BASE}/${ID}/signed-copy`, body: { storage_key: 'agreements/x.pdf', kind: 'pdf', party: 'controller' } });
  });

  it('confirm forwards accept and reason', async () => {
    const [s] = await run({ action: 'confirm', id: ID, accept: false, reason: 'page 3 missing' });
    expect(s.body).toEqual({ accept: false, reason: 'page 3 missing' });
  });

  it('object forwards the reason', async () => {
    const [s] = await run({ action: 'object', id: ID, reason: 'not in the EU' });
    expect(s).toEqual({ method: 'POST', path: `${BASE}/${ID}/object`, body: { reason: 'not in the EU' } });
  });

  it('end forwards choice and reason', async () => {
    const [s] = await run({ action: 'end', id: ID, choice: 'return', reason: 'contract over' });
    expect(s.body).toEqual({ choice: 'return', reason: 'contract over' });
  });

  it('deletion_done forwards the note', async () => {
    const [s] = await run({ action: 'deletion_done', id: ID, note: 'wiped 2026-10-25' });
    expect(s.body).toEqual({ note: 'wiped 2026-10-25' });
  });
});
