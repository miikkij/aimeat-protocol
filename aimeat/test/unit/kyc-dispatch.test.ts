/**
 * @file test/unit/kyc-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the customer due diligence tools put on the wire from the CLI dispatch (the
 *   connector's /local/call and the connector MCP): the route of each action and the body it carries,
 *   held to routes/kyc/routes.ts.
 *
 *   WHY IT IS ITS OWN FILE. cli-tool-param-forwarding.test.ts probes one parameter at a time with
 *   `action` held at one sentinel and no customer_id, so for aimeat_kyc_customer every per-action
 *   parameter is filed there as unmeasured, not as forwarded. Measured here, one case per action.
 * @usage cd aimeat && pnpm exec vitest run test/unit/kyc-dispatch.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

async function run(name: string, input: JsonObject): Promise<{ sent: Sent[]; result: unknown }> {
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
  const tool = CONNECT_CLI_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`${name} is not in the CLI dispatch table`);
  const result = await tool.handler(ctx as never, input);
  return { sent, result };
}

const ORG = 'org-abc';
const CARD = 'c-1a2b3c4d-5e6f';
const AT = `/v1/kyc/${ORG}/customers/${CARD}`;

describe('aimeat_kyc_customer reaches the route of each action', () => {
  const customer = (input: JsonObject) => run('aimeat_kyc_customer', { organism: ORG, ...input });

  it('list forwards due and status as the query', async () => {
    const { sent } = await customer({ action: 'list', due: true, status: 'blocked' });
    expect(sent).toEqual([{ method: 'GET', path: `/v1/kyc/${ORG}/customers?due=true&status=blocked`, body: undefined }]);
  });

  it('open posts the card fields as the body', async () => {
    const fields = { kind: 'person', name: 'Alice Example', country: 'FI' };
    const { sent } = await customer({ action: 'open', fields });
    expect(sent).toEqual([{ method: 'POST', path: `/v1/kyc/${ORG}/customers`, body: fields }]);
  });

  it('read and as_of address the card; as_of rides in the query', async () => {
    expect((await customer({ action: 'read', customer_id: CARD })).sent[0]).toEqual({ method: 'GET', path: AT, body: undefined });
    expect((await customer({ action: 'as_of', customer_id: CARD, as_of: '2026-11-01' })).sent[0].path).toBe(`${AT}?as_of=2026-11-01`);
  });

  it('update patches the fields with the note beside them', async () => {
    const { sent } = await customer({ action: 'update', customer_id: CARD, fields: { purpose: 'trade' }, note: 'asked in person' });
    expect(sent).toEqual([{ method: 'PATCH', path: AT, body: { purpose: 'trade', note: 'asked in person' } }]);
  });

  it('identify posts the identity with the note', async () => {
    const identity = { level: 'substantial', method: 'document', verifiedAt: '2026-11-19T10:00:00Z' };
    const { sent } = await customer({ action: 'identify', customer_id: CARD, identity, note: 'passport seen' });
    expect(sent).toEqual([{ method: 'POST', path: `${AT}/identity`, body: { ...identity, note: 'passport seen' } }]);
  });

  it('screen, review and link post to their routes', async () => {
    expect((await customer({ action: 'screen', customer_id: CARD })).sent[0]).toEqual({ method: 'POST', path: `${AT}/screen`, body: {} });
    expect((await customer({ action: 'review', customer_id: CARD, note: 'yearly' })).sent[0]).toEqual({ method: 'POST', path: `${AT}/review`, body: { note: 'yearly' } });
    expect((await customer({ action: 'link', customer_id: CARD })).sent[0]).toEqual({ method: 'POST', path: `${AT}/link`, body: {} });
  });

  it('end forwards the note and ended_at', async () => {
    const { sent } = await customer({ action: 'end', customer_id: CARD, note: 'moved abroad', ended_at: '2026-11-18' });
    expect(sent).toEqual([{ method: 'POST', path: `${AT}/end`, body: { note: 'moved abroad', ended_at: '2026-11-18' } }]);
  });

  it('encodes the organism and the card in the path', async () => {
    const { sent } = await run('aimeat_kyc_customer', { organism: 'a/b', action: 'read', customer_id: '../x' });
    expect(sent[0].path).toBe('/v1/kyc/a%2Fb/customers/..%2Fx');
  });
});

describe('aimeat_kyc_suspicion_mark and aimeat_kyc_settings', () => {
  it('a mark posts the observation and the card', async () => {
    const { sent } = await run('aimeat_kyc_suspicion_mark', { organism: ORG, observation: 'Cash deposits split under the limit.', customer_id: CARD });
    expect(sent).toEqual([{ method: 'POST', path: `/v1/kyc/${ORG}/suspicions`, body: { observation: 'Cash deposits split under the limit.', customer_id: CARD } }]);
  });

  it('settings read is a GET, update a PUT of only the fields given', async () => {
    expect((await run('aimeat_kyc_settings', { organism: ORG, action: 'read' })).sent[0]).toEqual({ method: 'GET', path: `/v1/kyc/${ORG}/settings`, body: undefined });
    const { sent } = await run('aimeat_kyc_settings', {
      organism: ORG, action: 'update', staff: ['alice@node'], officers: ['bob@node'], highRiskCountries: ['KP'], reviewMonths: { low: 60, medium: 36, high: 12 },
    });
    expect(sent).toEqual([{ method: 'PUT', path: `/v1/kyc/${ORG}/settings`, body: {
      staff: ['alice@node'], officers: ['bob@node'], highRiskCountries: ['KP'], reviewMonths: { low: 60, medium: 36, high: 12 },
    } }]);
    expect((await run('aimeat_kyc_settings', { organism: ORG, action: 'update', officers: ['carol@node'] })).sent[0].body).toEqual({ officers: ['carol@node'] });
  });
});
