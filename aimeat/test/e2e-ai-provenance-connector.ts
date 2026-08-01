/**
 * @file e2e-ai-provenance-connector.ts
 * @description E2E for the CONNECTOR's tool surfaces (TARGET-058 Phase 11): a declaration made
 *   through `aimeat connect serve` reaches the node, or the caller is told it did not.
 *
 *   WHY THIS SUITE EXISTS. Phase 4 wired provenance into `src/mcp/` — the surface a claude.ai
 *   connector talks to. It did not wire `src/cli/connect/`, which is what `aimeat connect serve`
 *   exposes and what every crewaimeat crew calls through. The catalog advertised `ai_provenance` on
 *   fourteen write tools; the connector's zod shapes did not carry it, so the block was STRIPPED as
 *   an unknown key before the body was posted. A crew declared `level: original,
 *   human_involvement: full-human`, got `ok: true`, and the node stored `ai-generated` / `none`.
 *   Found by probing the live node on 2026-08-01, reproduced here.
 *
 *   THE FAILURE THIS PROGRAMME EXISTS TO HUNT is a caller declaring, getting ok:true, and the
 *   declaration vanishing with no error. Every test below is written so that unwiring the thing it
 *   protects makes it fail.
 *
 *   IT DRIVES THE REAL DAEMON. Nothing here calls a connector function directly: the suite spawns
 *   `aimeat connect serve --http` against a temp AIMEAT_HOME and talks to it over MCP
 *   (Streamable HTTP, /v1/mcp) and over the shell-callable dispatch (/local/call/:tool), because
 *   those two surfaces are what was broken and they are separate code paths.
 * @structure owner + two agents (one with provenance:write, one without) · daemon · schema · declare ·
 *   bogus level · spoofed principal · attach-by-id · non-carrying tool · shell path · scope gate
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance-connector
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 11.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getAuthToken(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const signature = await signMsg(priv, message);
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json(BASE, '/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

/** Lay down a connector home dir: stored token + per-agent config. */
function writeConnectorHome(home: string, agents: Array<{ agent: string; owner: string; token: string; primary: boolean }>, nodeUrl: string): void {
  mkdirSync(join(home, 'tokens'), { recursive: true });
  for (const a of agents) {
    mkdirSync(join(home, 'agents', a.agent), { recursive: true });
    writeFileSync(join(home, 'tokens', `${a.agent}@${a.owner}.token`), a.token, 'utf-8');
    writeFileSync(
      join(home, 'agents', a.agent, 'config.yaml'),
      yamlStringify({ agent: a.agent, owner: a.owner, node_url: nodeUrl, primary: a.primary }),
      'utf-8',
    );
  }
}

function spawnDaemon(home: string): { child: ChildProcess; output: () => string } {
  let buf = '';
  const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'connect', 'serve', '--http'], {
    cwd: process.cwd(),
    env: { ...process.env, AIMEAT_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => { buf += d.toString(); });
  child.stderr?.on('data', (d) => { buf += d.toString(); });
  return { child, output: () => buf };
}

async function waitForDiscovery(home: string, timeoutMs = 40_000): Promise<any> {
  const file = join(home, 'serve.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { /* mid-write */ }
    }
    await sleep(150);
  }
  throw new Error(`serve.json did not appear in ${home} within ${timeoutMs}ms`);
}

/**
 * Call a connector MCP tool and return the parsed JSON payload its text content carries.
 *
 * A schema violation is a PROTOCOL error (the SDK throws McpError before the handler runs) while a
 * handler throwing comes back as `isError: true`. Both mean "the call was refused", and a test that
 * only understood one of them would report a refusal as a crash.
 */
async function mcpCall(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; payload: any; raw: string }> {
  let r: any;
  try { r = await client.callTool({ name, arguments: args }); }
  catch (err: any) { return { isError: true, payload: null, raw: String(err?.message ?? err) }; }
  const raw = (r.content ?? []).map((c: any) => c.text ?? '').join('\n');
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { /* not JSON */ }
  return { isError: r.isError === true, payload, raw };
}

/** The stored provenance for one of this agent's memory keys, resolved through the node's own API. */
async function storedProvenanceFor(token: string, key: string): Promise<{ id: string | null; record: any }> {
  const read = await json(BASE, `/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
  assert(read.status === 200, `memory read ${key}: ${read.status} ${JSON.stringify(read.body?.error ?? {})}`);
  const id: string | null = read.body?.data?.ai_provenance_id ?? null;
  if (!id) return { id: null, record: null };
  const prov = await json(BASE, `/v1/provenance/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  assert(prov.status === 200, `provenance read ${id}: ${prov.status}`);
  return { id, record: prov.body?.data?.provenance ?? null };
}

// ─── State ───
const stamp = Date.now();
const home = resolve(process.cwd(), `test/.tmp-prov-connector-${stamp}`);
const declarer = 'provbot';        // scopes: *  → may declare
const mute = 'mutebot';            // scopes: memory:write only → may NOT declare
let ownerName = '';
let declarerToken = '';
let muteToken = '';
let declarerGaii = '';
let daemon: { child: ChildProcess; output: () => string } | null = null;
let loopbackBase = '';
let mcp: Client | null = null;

console.log('\n=== AIMEAT Connector AI-Provenance E2E (TARGET-058 Phase 11) ===\n');

console.log('Setup — owner, two agents, connector home, daemon');

await test('Register owner + a declaring agent + an agent without provenance:write', async () => {
  ownerName = `provconn${stamp}`;
  const reg = await json(BASE, '/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(reg.status === 201, `owner status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const ownerToken = await getAuthToken(ownerName, reg.body.data.private_key, false);

  const a1 = await json(BASE, '/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: declarer, owner: ownerName, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(a1.status === 201, `declarer status ${a1.status}: ${JSON.stringify(a1.body)}`);
  declarerGaii = a1.body.data.agent.gaii;
  declarerToken = await getAuthToken(declarerGaii, a1.body.data.private_key, true);

  const a2 = await json(BASE, '/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: mute, owner: ownerName, capabilities: ['memory'], scopes: ['memory:write', 'memory:read'] }),
  });
  assert(a2.status === 201, `mute status ${a2.status}: ${JSON.stringify(a2.body)}`);
  muteToken = await getAuthToken(a2.body.data.agent.gaii, a2.body.data.private_key, true);

  writeConnectorHome(home, [
    { agent: declarer, owner: ownerName, token: declarerToken, primary: true },
    { agent: mute, owner: ownerName, token: muteToken, primary: false },
  ], BASE);
});

await test('`aimeat connect serve --http` starts and both agents register', async () => {
  daemon = spawnDaemon(home);
  const disc = await waitForDiscovery(home).catch((err) => {
    throw new Error(`${err.message}\n--- daemon output ---\n${daemon!.output()}`);
  });
  assert(disc.agents.length === 2, `agents: ${JSON.stringify(disc.agents)}`);
  loopbackBase = `http://127.0.0.1:${disc.port}`;
  mcp = new Client({ name: 'prov-connector-e2e', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${loopbackBase}/v1/mcp`)));
});

// ─── 1. The schema the crews actually read ───
console.log('\nPhase 1 — The parameter exists on the surface crews call through');

await test('CONNECTOR MCP: aimeat_memory_write advertises ai_provenance and ai_provenance_id', async () => {
  const tools = await mcp!.listTools();
  const t = tools.tools.find(x => x.name === 'aimeat_memory_write');
  assert(!!t, 'aimeat_memory_write is not on the connector surface');
  const props = (t!.inputSchema as any)?.properties ?? {};
  assert('ai_provenance' in props,
    `ai_provenance is absent from the connector schema, so a declaration is STRIPPED before the body is posted. Properties: ${Object.keys(props).join(', ')}`);
  assert('ai_provenance_id' in props, `ai_provenance_id absent. Properties: ${Object.keys(props).join(', ')}`);
});

await test('CONNECTOR MCP: every catalog tool that declares ai_provenance carries it here too', async () => {
  const { CLI_FALLBACK_TOOL_DEFINITIONS } = await import('../src/mcp/catalog/definitions.js');
  const expected = CLI_FALLBACK_TOOL_DEFINITIONS
    .filter(d => d.input && 'ai_provenance' in d.input)
    .map(d => d.name);
  assert(expected.length > 0, 'the catalog declares ai_provenance on no tool at all — check the catalog, not the connector');
  const tools = await mcp!.listTools();
  const byName = new Map(tools.tools.map(t => [t.name, t]));
  const missing = expected.filter(n => {
    const t = byName.get(n);
    if (!t) return false;                       // not exposed by the connector at all — not this test's business
    return !('ai_provenance' in ((t.inputSchema as any)?.properties ?? {}));
  });
  assert(missing.length === 0,
    `${missing.length} connector tool(s) advertise ai_provenance in the catalog but drop it from their schema: ${missing.join(', ')}`);
});

// ─── 2. The crewaimeat probe, reproduced ───
console.log('\nPhase 2 — A declared write arrives as declared');

await test('THE PROBE: level=original / human_involvement=full-human is STORED, not defaulted', async () => {
  const key = 'crew.relayed.human.text';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    key,
    value: { brief: 'A person typed this and the crew is only relaying it.' },
    visibility: 'private',
    ai_provenance: { level: 'original', human_involvement: 'full-human', notes: 'Pasted brief from the operator.' },
  });
  assert(!r.isError, `write failed: ${r.raw}`);

  const { id, record } = await storedProvenanceFor(declarerToken, key);
  assert(id !== null, 'the write stored NO provenance id at all');
  assert(record.level === 'original',
    `stored level is "${record.level}", not "original" — the declaration did not survive the connector hop. Stored record: ${JSON.stringify(record)}`);
  assert(record.humanInvolvement === 'full-human',
    `stored humanInvolvement is "${record.humanInvolvement}", not "full-human". Stored record: ${JSON.stringify(record)}`);
});

await test('THE PROBE, echoed: the tool result states what was actually recorded', async () => {
  const key = 'crew.relayed.human.text.echo';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    key,
    value: { brief: 'Another operator paste.' },
    visibility: 'private',
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  });
  assert(!r.isError, `write failed: ${r.raw}`);
  const echo = r.payload?.ai_provenance;
  assert(!!echo, `the result carries no ai_provenance echo, so a caller cannot see whether its block survived. Result: ${r.raw.slice(0, 600)}`);
  assert(echo.recorded === true, `echo says recorded=${echo.recorded}: ${JSON.stringify(echo)}`);
  assert(echo.level === 'original' && echo.human_involvement === 'full-human',
    `echo disagrees with what was declared: ${JSON.stringify(echo)}`);
  // Shaped like the READ surfaces ({ id, record, record_url }) so aimeat-crewai's read_provenance()
  // — which keys off record.spec — works on a write result without a second parser.
  assert(echo.record?.spec === 'aimeat.provenance/v1',
    `the echo carries no aimeat.provenance/v1 record, so read_provenance() reads it as UNSTATED: ${JSON.stringify(echo)}`);
  assert(typeof echo.record_url === 'string' && echo.record_url.includes('/v1/provenance/'),
    `no resolvable record_url in the echo: ${JSON.stringify(echo)}`);
});

// ─── 3. A bogus declaration is refused, not defaulted ───
console.log('\nPhase 3 — A declaration that cannot be honoured never looks like one that was');

await test('A bogus level is REFUSED (not silently defaulted to the node stamp)', async () => {
  const key = 'crew.bogus.level';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    key,
    value: { x: 1 },
    ai_provenance: { level: 'hand-carved-by-elves', human_involvement: 'full-human' },
  });
  assert(r.isError, `the call SUCCEEDED with an invalid level — the block was stripped and the node stamped its default. Result: ${r.raw.slice(0, 600)}`);
  assert(/level/i.test(r.raw), `the refusal does not name the offending field: ${r.raw.slice(0, 400)}`);
  const read = await json(BASE, `/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${declarerToken}` } });
  assert(read.status === 404, `a refused declaration still wrote the record (status ${read.status})`);
});

await test('A spoofed principal inside the block is ignored AND the caller can see it was', async () => {
  const key = 'crew.spoofed.principal';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    key,
    value: { x: 2 },
    ai_provenance: {
      level: 'ai-generated',
      human_involvement: 'none',
      principal: `ghostwriter#victim@${NODE_ID}`,
      node_id: 'some-other-node',
    } as Record<string, unknown>,
  });
  assert(!r.isError, `write failed: ${r.raw}`);
  const echo = r.payload?.ai_provenance;
  assert(!!echo, `no echo, so the caller cannot tell its spoofed principal was discarded: ${r.raw.slice(0, 600)}`);
  assert(typeof echo.principal === 'string' && echo.principal === declarerGaii,
    `the echo does not show the REAL principal (${declarerGaii}); got ${JSON.stringify(echo.principal)}`);

  const { record } = await storedProvenanceFor(declarerToken, key);
  assert(record.generator?.principal === declarerGaii,
    `the node stored a spoofed principal: ${record.generator?.principal}`);
  assert(record.generator?.nodeId === NODE_ID, `the node stored a spoofed nodeId: ${record.generator?.nodeId}`);
});

// ─── 4. Attaching a record the node already minted ───
console.log('\nPhase 4 — ai_provenance_id travels too');

await test('ai_provenance_id minted over REST attaches through the connector write', async () => {
  const content = JSON.stringify({ draft: 'Written by a model, reviewed by a person.' });
  const dec = await json(BASE, '/v1/provenance', {
    method: 'POST',
    headers: { Authorization: `Bearer ${declarerToken}` },
    body: JSON.stringify({ level: 'assisted', humanInvolvement: 'editorial-control', content }),
  });
  assert(dec.status === 201, `declare: ${dec.status} ${JSON.stringify(dec.body?.error ?? {})}`);
  const mintedId = dec.body.data.id;

  const key = 'crew.attached.by.id';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    key, value: { draft: 'Written by a model, reviewed by a person.' }, ai_provenance_id: mintedId,
  });
  assert(!r.isError, `write failed: ${r.raw}`);
  const { id, record } = await storedProvenanceFor(declarerToken, key);
  assert(id === mintedId, `the record attached is ${id}, not the minted ${mintedId}`);
  assert(record.level === 'assisted' && record.humanInvolvement === 'editorial-control',
    `attached record reads ${JSON.stringify({ level: record.level, humanInvolvement: record.humanInvolvement })}`);
});

// ─── 4b. THE READ DIRECTION ───
// Reported by the crewaimeat developer on 2026-08-01: read_provenance() never returns anything for
// memory reads. Same class as the write-side strip, pointing the other way — the node serves the
// record on the ENVELOPE carrier (`meta.provenance`, the one carrier 22-frozen-vocabulary.md §A4
// froze), and the connector unwraps `resp.data` and throws the envelope away.
console.log('\nPhase 4b — Reading it back through the connector');

await test('CONNECTOR MCP: aimeat_memory_read returns the record, not just the id', async () => {
  const key = 'crew.read.back';
  const w = await mcpCall(mcp!, 'aimeat_memory_write', {
    key,
    value: { brief: 'A person wrote this; the crew relayed it.' },
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  });
  assert(!w.isError, `write failed: ${w.raw}`);

  const r = await mcpCall(mcp!, 'aimeat_memory_read', { key });
  assert(!r.isError, `read failed: ${r.raw}`);
  const block = r.payload?.ai_provenance;
  assert(!!block,
    `the read result carries no ai_provenance block, so a crew reading its own content back cannot `
    + `state how it was made. The node DOES send it (meta.provenance); the connector dropped it. `
    + `Result keys: ${Object.keys(r.payload ?? {}).join(', ')}`);
  assert(block.record?.spec === 'aimeat.provenance/v1',
    `no aimeat.provenance/v1 document in the block, so read_provenance() reads it as UNSTATED: ${JSON.stringify(block)}`);
  assert(block.record.level === 'original',
    `read back the wrong level: ${JSON.stringify(block.record)}`);
  assert(typeof block.id === 'string' && typeof block.record_url === 'string',
    `the block is not the { id, record, record_url } shape every other read surface uses: ${JSON.stringify(block)}`);
});

await test('SHELL: /local/call/aimeat_memory_read returns the record too', async () => {
  const key = 'crew.read.back.shell';
  const w = await json(loopbackBase, '/local/call/aimeat_memory_write', {
    method: 'POST',
    body: JSON.stringify({ key, value: { brief: 'Relayed.' }, ai_provenance: { level: 'original', human_involvement: 'full-human' } }),
  });
  assert(w.status === 200 && w.body.ok === true, `shell write: ${w.status} ${JSON.stringify(w.body)}`);

  const r = await json(loopbackBase, '/local/call/aimeat_memory_read', { method: 'POST', body: JSON.stringify({ key }) });
  assert(r.status === 200 && r.body.ok === true, `shell read: ${r.status} ${JSON.stringify(r.body)}`);
  const block = r.body.data?.ai_provenance;
  assert(!!block, `the shell read dropped the record: ${JSON.stringify(r.body.data)}`);
  assert(block.record?.spec === 'aimeat.provenance/v1' && block.record.level === 'original',
    `shell read block is wrong: ${JSON.stringify(block)}`);
});

// ─── 5. The tools whose node door cannot carry a declaration say so ───
console.log('\nPhase 5 — A door that cannot carry a declaration says so out loud');

await test('A write tool whose REST door takes no declaration reports recorded:false with a reason', async () => {
  const boards = await json(BASE, '/v1/boards', {
    method: 'POST', headers: { Authorization: `Bearer ${declarerToken}` },
    body: JSON.stringify({ name: `provboard${stamp}`, description: 'Phase 11 probe board', visibility: 'public' }),
  });
  assert(boards.status === 201, `board create: ${boards.status} ${JSON.stringify(boards.body?.error ?? {})}`);
  const boardId = boards.body.data.id ?? boards.body.data.board_id;

  const r = await mcpCall(mcp!, 'aimeat_board_post', {
    board_id: boardId,
    title: 'Relayed from a person',
    body: 'A human wrote this paragraph; the crew is only posting it.',
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  });
  assert(!r.isError, `board post failed: ${r.raw}`);
  const echo = r.payload?.ai_provenance;
  assert(!!echo, `the declaration vanished silently on aimeat_board_post — no echo in the result: ${r.raw.slice(0, 600)}`);
  assert(echo.recorded === false, `echo says recorded=${echo.recorded} but this door cannot carry a declaration: ${JSON.stringify(echo)}`);
  assert(typeof echo.reason === 'string' && echo.reason.length > 20, `the echo gives no usable reason: ${JSON.stringify(echo)}`);
});

// ─── 6. The shell-callable surface is the same code path's twin ───
console.log('\nPhase 6 — The shell-callable surface (/local/call, `aimeat connect call`)');

await test('SHELL: /local/call/aimeat_memory_write honours a declaration too', async () => {
  const key = 'crew.shell.declared';
  const w = await json(loopbackBase, '/local/call/aimeat_memory_write', {
    method: 'POST',
    body: JSON.stringify({
      key, value: { brief: 'Relayed through the shell path.' },
      ai_provenance: { level: 'original', human_involvement: 'full-human' },
    }),
  });
  assert(w.status === 200 && w.body.ok === true, `shell write: ${w.status} ${JSON.stringify(w.body)}`);
  const { id, record } = await storedProvenanceFor(declarerToken, key);
  assert(id !== null, 'the shell write stored NO provenance id');
  assert(record.level === 'original' && record.humanInvolvement === 'full-human',
    `the shell path dropped the declaration: ${JSON.stringify({ level: record.level, humanInvolvement: record.humanInvolvement })}`);
});

// ─── 7. The scope gate is not bypassed by going through the connector ───
console.log('\nPhase 7 — MCP is not a way around the REST scope gate');

await test('CROSS-SCOPE → refused: an agent without provenance:write cannot declare through the connector', async () => {
  const r = await mcpCall(mcp!, 'aimeat_memory_write', {
    agent_name: mute,
    key: 'crew.unscoped.declaration',
    value: { x: 3 },
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  });
  assert(r.isError, `an agent without provenance:write DECLARED successfully: ${r.raw.slice(0, 600)}`);
  assert(/provenance:write/.test(r.raw), `the refusal does not name the missing scope: ${r.raw.slice(0, 400)}`);
});

await test('The same agent can still WRITE — only the declaration is gated', async () => {
  const key = 'crew.unscoped.plain';
  const r = await mcpCall(mcp!, 'aimeat_memory_write', { agent_name: mute, key, value: { x: 4 } });
  assert(!r.isError, `an undeclared write was refused: ${r.raw.slice(0, 400)}`);
  const { record } = await storedProvenanceFor(muteToken, key);
  assert(record?.level === 'ai-generated' && record?.humanInvolvement === 'none',
    `the node's own stamp is missing or wrong: ${JSON.stringify(record)}`);
});

// ─── Teardown ───
if (mcp) { try { await mcp.close(); } catch { /* closing */ } }
if (daemon) {
  daemon.child.kill('SIGTERM');
  await sleep(1_500);
  if (daemon.child.exitCode === null) daemon.child.kill('SIGKILL');
}
try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
