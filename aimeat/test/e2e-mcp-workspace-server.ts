/**
 * @file test/e2e-mcp-workspace-server.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An MCP server a group attaches to ONE workspace (POST /v1/mcp-servers/organism with
 *   `ws`) is reached by the workspace's roles, not by the group's membership
 *   (services/mcp-client/registry.ts organismAdmits): a contributor may call its tools, a viewer sees
 *   it in the list and may not call it, and a member of the group with no role in that workspace
 *   neither sees it nor calls it. The rule had no test at all. This suite holds it on a real node
 *   and a real far side:
 *     1. the contributor calls a tool, on REST and through an agent over MCP;
 *     2. the viewer sees it listed and is refused the call with 404, as for a server that does not
 *        exist; the group member without a role neither sees nor calls it, and an outsider neither;
 *     3. a server attached to the whole group answers that plain member, so the narrowing is the
 *        workspace binding's;
 *     4. the contributor's role revoked, the call is refused again;
 *     5. the workspace creator, who also owns the group, calls it without a role, and a member made
 *        an admin of the group calls it without a role, as both write the workspace without one.
 *   Tests 1a, 1b and 2a were red before the fix of 2026-11-19: the roles were looked up under the
 *   organism owner's bare name, where no grant is stored, so the source was broken.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-workspace-server
 * @version-history
 *   v1.1.0 — 2026-11-19 — A contributor who is no admin of the group is refused attaching a server
 *     to the workspace (403 NOT_ALLOWED): attaching is the group's owners' and admins' decision.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

const UPSTREAM_PORT = Number(new URL(BASE).port || '40251') + 262;
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}/mcp`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const transports = new Map<string, NodeStreamableHTTPServerTransport>();
const upstream = http.createServer(async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid && !transports.has(sid)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}');
    return;
  }
  let transport = sid ? transports.get(sid) : undefined;
  if (!transport) {
    const srv = new McpServer({ name: 'e2e-ws-server', version: '1.0.0' });
    srv.registerTool('echo', { description: 'Repeats its input.', inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }));
    const created = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => transports.set(id, created),
    });
    transport = created;
    await srv.connect(created);
  }
  let body: unknown;
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  await transport.handleRequest(req, res, body);
});

console.log('\n=== An MCP server bound to one workspace: its roles decide ===\n');
await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

const stamp = Date.now().toString(36);
type Person = { name: string; token: string };
let alice!: Person, bob!: Person, carol!: Person, dave!: Person, erin!: Person;
let orgId = '';
let ws = '';
let wsServerId = '';
let groupServerId = '';

const call = (token: string, id: string, text: string) =>
  json(`/v1/mcp-servers/${encodeURIComponent(id)}/call`, { method: 'POST', headers: auth(token), body: JSON.stringify({ tool: 'echo', arguments: { text } }) });
const listed = async (token: string): Promise<string[]> => {
  const r = await json('/v1/mcp-servers', { headers: auth(token) });
  assert(r.status === 200, `list: ${r.status}`);
  return (r.body.data.servers as Array<{ id: string }>).map((s) => s.id);
};

try {
  console.log('Setup');
  await test('Alice makes a group with a workspace; Bob is its contributor, Carol its viewer, Dave a member with no role, Erin outside', async () => {
    const reg = async (p: string): Promise<Person> => { const o = await registerOwner(BASE, `${p}${stamp}`); return { name: o.name, token: o.token }; };
    [alice, bob, carol, dave, erin] = [await reg('wsmalice'), await reg('wsmbob'), await reg('wsmcarol'), await reg('wsmdave'), await reg('wsmerin')];
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ name: `ws mcp ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
      method: 'POST', headers: auth(alice.token),
      body: JSON.stringify({ name: 'Tools', manifest: { objectTypes: [{ name: 'note', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' }] } }),
    });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    for (const p of [bob, carol, dave]) {
      const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(p.token), body: '{}' });
      assert(j.status === 201, `join ${p.name}: ${j.status}`);
    }
    for (const [p, role] of [[bob, 'contributor'], [carol, 'viewer']] as const) {
      const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ ws, grantee: p.name, role }) });
      assert(g.status === 200, `grant ${p.name}: ${g.status} ${JSON.stringify(g.body?.error)}`);
    }
  });

  await test('Alice attaches one server to the workspace and one to the whole group', async () => {
    const a = await json('/v1/mcp-servers/organism', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ organism_id: orgId, ws, name: 'wstools', url: UPSTREAM_URL }) });
    assert(a.status === 201, `workspace server: ${a.status} ${JSON.stringify(a.body)}`);
    assert(String(a.body.data.note).includes('contribute to that workspace'), `the answer says who may use it: ${a.body.data.note}`);
    wsServerId = a.body.data.server.id;
    const g = await json('/v1/mcp-servers/organism', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ organism_id: orgId, name: 'grouptools', url: UPSTREAM_URL }) });
    assert(g.status === 201, `group server: ${g.status} ${JSON.stringify(g.body)}`);
    groupServerId = g.body.data.server.id;
  });

  await test('Bob, a contributor but no admin of the group, is refused attaching a server to the workspace', async () => {
    const r = await json('/v1/mcp-servers/organism', { method: 'POST', headers: auth(bob.token), body: JSON.stringify({ organism_id: orgId, ws, name: 'bobtools', url: UPSTREAM_URL }) });
    expectRefusal(r, 403, 'NOT_ALLOWED');
  });

  console.log('\n1. A contributor calls');
  await test('1a. Bob, a contributor of the workspace, sees the server and calls its tool', async () => {
    assert((await listed(bob.token)).includes(wsServerId), 'Bob sees it listed');
    const r = await call(bob.token, wsServerId, 'from bob');
    assert(r.status === 200 && JSON.stringify(r.body.data?.content).includes('echo:from bob'), `Bob's call: ${r.status} ${JSON.stringify(r.body)}`);
  });

  await test('1b. Bob\'s agent holding mcp:use calls it over MCP (aimeat_mcp_call)', async () => {
    const agent = await makeAgent(BASE, bob, ['mcp:read', 'mcp:use']);
    const s = await openSession(BASE, agent.token, 'ws-server-bob');
    const r = await callTool(s, 'aimeat_mcp_call', { server: wsServerId, tool: 'echo', arguments: { text: 'via chat' } });
    assert(!r.isError && r.text.includes('echo:via chat'), `the agent's call: ${r.text.slice(0, 300)}`);
  });

  console.log('\n2. Everyone else');
  await test('2a. Carol, a viewer, sees the server listed and is refused the call with 404', async () => {
    assert((await listed(carol.token)).includes(wsServerId), 'Carol sees that it is there');
    expectRefusal(await call(carol.token, wsServerId, 'from carol'), 404);
  });

  await test('2b. Dave, a member of the group with no role in the workspace, neither sees nor calls it', async () => {
    assert(!(await listed(dave.token)).includes(wsServerId), 'Dave does not see it');
    expectRefusal(await call(dave.token, wsServerId, 'from dave'), 404);
  });

  await test('2c. Erin, outside the group, neither sees nor calls it, in the same words as a server that does not exist', async () => {
    assert(!(await listed(erin.token)).includes(wsServerId), 'Erin does not see it');
    const hers = await call(erin.token, wsServerId, 'from erin');
    const none = await call(erin.token, randomUUID(), 'nothing');
    expectRefusal(hers, 404);
    assert(hers.body.error?.code === none.body.error?.code, `${hers.body.error?.code} vs ${none.body.error?.code}`);
  });

  console.log('\n3. The whole group\'s server');
  await test('3. A server attached to the whole group answers Dave, so the narrowing is the workspace binding\'s', async () => {
    assert((await listed(dave.token)).includes(groupServerId), 'Dave sees the group server');
    const r = await call(dave.token, groupServerId, 'group');
    assert(r.status === 200, `Dave on the group server: ${r.status} ${JSON.stringify(r.body?.error)}`);
    expectRefusal(await call(erin.token, groupServerId, 'group'), 404);
  });

  console.log('\n4. A role taken back');
  await test('4. Bob\'s role revoked, his call is refused and the server leaves his list', async () => {
    const rv = await json(`/v1/organisms/${orgId}/workspace-access/revoke`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ ws, grantee: bob.name }) });
    assert(rv.status === 200, `revoke: ${rv.status} ${JSON.stringify(rv.body?.error)}`);
    expectRefusal(await call(bob.token, wsServerId, 'again'), 404);
    assert(!(await listed(bob.token)).includes(wsServerId), 'Bob no longer sees it');
  });

  console.log('\n5. The workspace creator and the group\'s admins');
  await test('5a. Alice, who made the workspace and owns the group, sees the server and calls it with no role', async () => {
    assert((await listed(alice.token)).includes(wsServerId), 'Alice sees it listed');
    const r = await call(alice.token, wsServerId, 'from alice');
    assert(r.status === 200 && JSON.stringify(r.body.data?.content).includes('echo:from alice'), `Alice's call: ${r.status} ${JSON.stringify(r.body)}`);
  });

  await test('5b. Dave made an admin of the group calls it with no workspace role', async () => {
    const p = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ target_ghii: dave.name }) });
    assert(p.status === 200 && p.body.data.role === 'admin', `promote: ${p.status} ${JSON.stringify(p.body?.error)}`);
    assert((await listed(dave.token)).includes(wsServerId), 'Dave the admin sees it listed');
    const r = await call(dave.token, wsServerId, 'from dave');
    assert(r.status === 200, `Dave the admin's call: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });
} finally {
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
}

finish();
