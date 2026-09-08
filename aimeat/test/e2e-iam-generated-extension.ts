/**
 * @file e2e-iam-generated-extension.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/iam/generate-extension.ts, which turns an app's IAM spec into an installable
 *   gate, had one of its seven functions covered. It runs from exactly one place: defineAppIam()
 *   generates the extension only when the app_id names an app (`owner/file`), and defineAppIam has
 *   one door, the MCP tool aimeat_iam_define. No REST route reaches it, so this suite speaks MCP.
 *
 *   What it asserts is the TEXT the tool hands back, because that text is what an owner installs:
 *   the manifest and its three actions, the check script's accumulated capability ladder, the
 *   commands script's manifest, and the roles script's vocabulary. Two things the generator exists
 *   to prevent are asserted directly — a tier that sits above another and holds less of it, and a
 *   command whose capability no role lists being left out of the input enum.
 *
 *   It also pins two disagreements found while writing it, so a fix moves a line here rather than
 *   passing unnoticed: the `matrix` the same response carries is computed WITHOUT the accumulation
 *   the generated gate applies, and the tool takes neither `defaultRole` nor `author`, so two of the
 *   generator's parameters cannot be reached through the only door it has.
 * @structure Setup (owner, agent, MCP session) · Part A rich design · Part B minimal design ·
 *   Part C the arms that generate nothing · Part D refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=iam-generated-extension
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

// ── MCP plumbing: JSON-RPC over the streamable HTTP door ─────────────────────
interface Session { token: string; sessionId: string; nextId: number }

/** SSE frames back to JSON-RPC messages — the door answers either shape. */
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return out;
}

async function rpc(s: Session, method: string, params: Record<string, unknown> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('text/event-stream')
        ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
        : await res.json() as any;
    return { status: res.status, body };
}

/**
 * Call a tool and hand back what it said. A tool the session's scopes never registered comes back
 * as a JSON-RPC error rather than an `isError` result; both are refusals, so both are reported.
 */
async function call(s: Session, name: string, args: Record<string, unknown>) {
    const { body } = await rpc(s, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? '';
    const isError = body?.result?.isError === true || body?.error !== undefined;
    let data: any = null;
    if (!isError && text) { try { data = JSON.parse(text); } catch { data = null; } }
    return { isError, text, data, raw: body };
}

async function openSession(agentGaii: string, agentKey: string, label: string): Promise<Session> {
    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `iam-gen ${label}`, redirect_uris: [] }),
    });
    assert(client.status === 201, `mcp/register ${client.status}`);
    const ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ts), timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const s: Session = { token: token.body.access_token, sessionId: '', nextId: 1 };
    const init = await rpc(s, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'iam-generated e2e', version: '1.0.0' },
    });
    assert(init.body.result !== undefined, `initialize: ${JSON.stringify(init.body)}`);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return s;
}

// ── The design under test ────────────────────────────────────────────────────
// The app id is `<owner>/<file>` and is filled in once the owner has a name: the install door
// refuses a gate whose config.app names an app somebody else owns, so a fixed literal would design
// a gate this suite could never install.
let APP_ID = '';
let EXT_NAME = '';
const LEVELS = [
    { level: 0, key: 'admin', label: 'Administrator', capabilities: ['*'] },
    { level: 10, key: 'editor', label: 'Editor', capabilities: ['publish', 'edit'] },
    { level: 20, key: 'reader', label: 'Reader', capabilities: ['read'] },
];
const COMMANDS = [
    { id: 'list', description: 'List the ledger entries', capability: 'read', tier: 'read' },
    { id: 'save', description: 'Save one entry', capability: 'edit', tier: 'write' },
    { id: 'announce', description: 'Publish the month', capability: 'publish', tier: 'write' },
    { id: 'purge', description: 'Delete every entry, for good', capability: '*', tier: 'irreversible' },
];

console.log('\n=== AIMEAT IAM generated extension E2E (aimeat_iam_define) ===\n');

let ownerName = '';
let ownerToken = '';
let session!: Session;
let narrow!: Session;
let rich: any = null;

await test('Setup: an owner, an agent, and an MCP session', async () => {
    ownerName = `iamgen${Date.now()}`;
    APP_ID = `${ownerName}/ledger.html`;
    EXT_NAME = `${ownerName}-ledger-iam`;
    const mk = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'IAM Gen', password: 'IamGen12345' }) });
    let reg = await mk();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await mk(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }),
    });
    ownerToken = tok.body.data.token;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'designer', owner: ownerName, capabilities: ['extensions'], model: 'gpt-4o' }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
    session = await openSession(ag.body.data.agent.gaii, ag.body.data.private_key, 'wide');
});

await test('0. aimeat_iam_define is on this session\'s tool surface', async () => {
    const { body } = await rpc(session, 'tools/list');
    const names = body.result.tools.map((t: any) => t.name);
    assert(names.includes('aimeat_iam_define'), `tool is registered: ${names.length} tools`);
    const tool = body.result.tools.find((t: any) => t.name === 'aimeat_iam_define');
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    assert(props.includes('app_id') && props.includes('levels') && props.includes('commands'),
        `the published parameters: ${JSON.stringify(props)}`);
    // PINNED, NOT ENDORSED (2026-09-08): generateIamExtension takes `defaultRole`, `author`,
    // `extName` and `version`, and NONE of the four is a parameter of the only door that reaches
    // it. So a generated gate always says a signed-in stranger holds nothing, always claims
    // author "generated", and always publishes 1.0.0 — which the generator's own comment calls a
    // rollback when it lands over a live gate. If a parameter is added, this assertion fails.
    assert(!props.includes('defaultRole') && !props.includes('author') && !props.includes('version'),
        `today the tool exposes none of the generator's other inputs: ${JSON.stringify(props)}`);
});

// ── Part A: the rich design ──────────────────────────────────────────────────
console.log('\nPart A — a design with three levels and four commands');

await test('A1. An app_id naming an app returns the installable extension', async () => {
    const r = await call(session, 'aimeat_iam_define', { app_id: APP_ID, levels: LEVELS, commands: COMMANDS });
    assert(!r.isError, `the call succeeded: ${r.text.slice(0, 300)}`);
    assert(r.data?.ok === true, `the design validated: ${r.text.slice(0, 300)}`);
    rich = r.data;
    assert(!!rich.extension, `an extension came back: ${Object.keys(rich)}`);
    assert(rich.extension.name === EXT_NAME, `the name is a slug of the app id plus -iam: ${rich.extension.name}`);
    assert(Object.keys(rich.extension.scripts).sort().join(',') === 'check.js,commands.js,roles.js',
        `three scripts: ${Object.keys(rich.extension.scripts)}`);
    assert(rich.schema.groupType === 'app' && rich.schema.name === `${APP_ID}-levels`, `schema: ${JSON.stringify(rich.schema.name)}`);
    assert(Array.isArray(rich.apply) && rich.apply.map((a: any) => a.op).join(',') === 'setRoles,setLevels,setCommands',
        `the apply payloads are still there beside the extension: ${JSON.stringify(rich.apply?.map((a: any) => a.op))}`);
});

await test('A2. The manifest declares the three actions and names every role', async () => {
    const m: string = rich.extension.manifest;
    assert(m.includes(`name: ${EXT_NAME}`), `manifest name: ${m.slice(0, 120)}`);
    assert(m.includes('version: 1.0.0'), 'a new gate publishes 1.0.0');
    assert(m.includes('author: generated'), 'and claims no author, because the tool takes none');
    assert(m.includes(`default: ${APP_ID}`), 'the app it gates is config, so the node can resolve the roster');
    for (const id of ['check', 'commands', 'roles']) assert(m.includes(`- id: ${id}`), `action ${id} is declared`);
    for (const script of ['check.js', 'commands.js', 'roles.js']) assert(m.includes(`script: ${script}`), `${script} is wired to an action`);
    assert(m.includes('Roles: admin, editor, reader.'), `the description names the roles: ${m}`);
    assert(m.includes('Anyone signed in who is on no roster row holds nothing.'),
        'and says what a stranger holds, which with no defaultRole is nothing');
    // The input enum has to carry every capability the gate can be ASKED about, including one that
    // only a wildcard role holds. `publish` is listed by a role; the enum must also survive the
    // '*' command capability being dropped rather than offered as an askable permission.
    const enumLine = /permission: \{ type: string, enum: (\[[^\]]*\]) \}/.exec(m);
    assert(!!enumLine, `the check action publishes a permission enum: ${m}`);
    const caps = JSON.parse(enumLine![1]);
    assert(caps.sort().join(',') === 'edit,publish,read', `every askable capability, and no '*': ${JSON.stringify(caps)}`);
    const cmdEnum = /command: \{ type: string, enum: (\[[^\]]*\]) \}/.exec(m);
    assert(JSON.parse(cmdEnum![1]).sort().join(',') === 'announce,list,purge,save', `every command id: ${cmdEnum![1]}`);
});

await test('A3. check.js accumulates the ladder: a higher tier holds every lower tier\'s capabilities', async () => {
    const s: string = rich.extension.scripts['check.js'];
    const caps = JSON.parse(/const CAPS = (\{.*?\});/s.exec(s)![1]);
    // The bug the generator exists to prevent, asserted rather than described: `editor` sits above
    // `reader` and declares only publish + edit, so a literal reading would refuse it the `read`
    // that a passer-by holds.
    assert(JSON.stringify(caps.admin) === '["*"]', `a level 0 holding '*' collapses to the wildcard: ${JSON.stringify(caps.admin)}`);
    assert(caps.editor.sort().join(',') === 'edit,publish,read', `editor inherits reader's read: ${JSON.stringify(caps.editor)}`);
    assert(caps.reader.join(',') === 'read', `reader holds its own only: ${JSON.stringify(caps.reader)}`);
    const levels = JSON.parse(/const LEVELS = (\{.*?\});/s.exec(s)![1]);
    assert(JSON.stringify(levels) === '{"admin":0,"editor":10,"reader":20}', `the ordinals: ${JSON.stringify(levels)}`);
    assert(/const DEFAULT_ROLE = null;/.test(s), `no defaultRole reaches the gate: ${/const DEFAULT_ROLE = .*/.exec(s)?.[0]}`);
    // The gate keeps no roster of its own: the whole point of generating it.
    assert(s.includes('ctx.caller'), 'the caller\'s standing arrives resolved');
    assert(!s.includes('ctx.memory'), 'and nothing is stored, so there is nothing to leak or to sync');
    assert(s.includes("needsConfirmation: cmd.tier === 'irreversible'"), 'an irreversible command asks for confirmation');
    assert(s.startsWith('// GENERATED from this app'), 'the script says it is generated');
});

await test('A4. commands.js carries every command id and answers for THIS caller', async () => {
    const s: string = rich.extension.scripts['commands.js'];
    const cmds = JSON.parse(/const COMMANDS = (\[.*?\]);/s.exec(s)![1]);
    assert(cmds.map((c: any) => c.id).sort().join(',') === 'announce,list,purge,save', `every id: ${JSON.stringify(cmds.map((c: any) => c.id))}`);
    for (const c of COMMANDS) {
        const got = cmds.find((x: any) => x.id === c.id);
        assert(got.description === c.description && got.capability === c.capability && got.tier === c.tier,
            `${c.id} survives verbatim: ${JSON.stringify(got)}`);
    }
    assert(s.includes('allowed: has(c.capability)'), 'each command comes back already marked for the caller');
    assert(s.includes('const CAPS ='), 'and it carries the same accumulated ladder');
});

await test('A5. roles.js is the vocabulary an approval screen reads', async () => {
    const s: string = rich.extension.scripts['roles.js'];
    const labels = JSON.parse(/const LABELS = (\{.*?\});/s.exec(s)![1]);
    assert(labels.admin === 'Administrator' && labels.editor === 'Editor' && labels.reader === 'Reader',
        `the labels reach the gate: ${JSON.stringify(labels)}`);
    assert(/const DEFAULT_ROLE = null;/.test(s), 'defaultRole is null on every gate this door can build');
    assert(s.includes('const assignable = Object.keys(CAPS).filter'), 'assignable is computed from the default');
    // With DEFAULT_ROLE null nothing is filtered out, so all three roles are handable.
    assert(s.includes('defaultRole: DEFAULT_ROLE'), 'and the default is reported to the screen');
    assert(s.includes('// No caller check'), 'the vocabulary is deliberately not personal data');
    // The vocabulary and the roster are two different things, and only the first is in here. The
    // entry point takes NO ctx at all, unlike check.js and commands.js, so the script cannot read
    // who is calling even if somebody later wanted it to.
    assert(/export default async function \(\)/.test(s), `the entry point takes no ctx: ${/export default[^\n]*/.exec(s)?.[0]}`);
    assert(!s.includes('ctx.memory'), 'and it reads no memory, so there is no roster to leak');
    assert(!/return \{[\s\S]*assignments/.test(s), 'nothing about who holds what is returned');
});

await test('A6. PINNED: the matrix in the same response is NOT accumulated, so it disagrees with the gate', async () => {
    // defineAppIam builds `matrix` with capabilitiesOf(), which reads a level's own capabilities
    // literally; generateIamExtension builds the gate with accumulate(), which walks the ladder.
    // Both ship in one response. Today an agent reading the matrix is told `editor` may not run
    // `list`, and the gate it installs from the same reply allows it. Asserted as it stands so a
    // fix moves this test rather than passing unnoticed.
    const m = rich.matrix;
    assert(m.admin.canRun.sort().join(',') === 'announce,list,purge,save', `admin runs everything: ${JSON.stringify(m.admin)}`);
    assert(m.admin.needsConfirmation.join(',') === 'purge', `and confirms only the irreversible one: ${JSON.stringify(m.admin.needsConfirmation)}`);
    assert(m.editor.canRun.sort().join(',') === 'announce,save', `the matrix reads editor literally: ${JSON.stringify(m.editor.canRun)}`);
    assert(!m.editor.canRun.includes('list'), 'so it withholds the read a reader holds');
    const gateCaps = JSON.parse(/const CAPS = (\{.*?\});/s.exec(rich.extension.scripts['check.js'] as string)![1]);
    assert(gateCaps.editor.includes('read'),
        'while the gate generated beside it grants that read — the two halves of one reply disagree');
    assert(m.reader.canRun.join(',') === 'list', `reader runs the read command: ${JSON.stringify(m.reader.canRun)}`);
    assert(m.reader.needsConfirmation.length === 0, 'and confirms nothing');
});

// ── Part B: the minimal design ───────────────────────────────────────────────
console.log('\nPart B — one level, one command');

await test('B1. A single wildcard level takes the early arm and produces an empty capability enum', async () => {
    const r = await call(session, 'aimeat_iam_define', {
        app_id: 'bo/solo',
        levels: [{ level: 0, key: 'root', label: 'Root', capabilities: ['*'] }],
        commands: [{ id: 'wipe', description: 'Wipe it', capability: '*', tier: 'irreversible' }],
    });
    assert(!r.isError && r.data?.ok === true, `minimal design validates: ${r.text.slice(0, 300)}`);
    const ext = r.data.extension;
    assert(ext.name === 'bo-solo-iam', `slug of an app id with no extension: ${ext.name}`);
    const caps = JSON.parse(/const CAPS = (\{.*?\});/s.exec(ext.scripts['check.js'] as string)![1]);
    assert(JSON.stringify(caps) === '{"root":["*"]}', `the wildcard arm returns early and accumulates nothing: ${JSON.stringify(caps)}`);
    // Every declared capability is '*', which the enum drops — so the enum is empty rather than
    // carrying a permission nobody can ask about.
    assert(/permission: \{ type: string, enum: \[\] \}/.test(ext.manifest as string),
        `an empty permission enum: ${/permission: \{[^}]*\}/.exec(ext.manifest as string)?.[0]}`);
    assert(/command: \{ type: string, enum: \["wipe"\] \}/.test(ext.manifest as string), 'and the one command id');
    assert((ext.manifest as string).includes('Roles: root.'), 'the description names the single role');
    const labels = JSON.parse(/const LABELS = (\{.*?\});/s.exec(ext.scripts['roles.js'] as string)![1]);
    assert(JSON.stringify(labels) === '{"root":"Root"}', `one label: ${JSON.stringify(labels)}`);
    assert(r.data.matrix.root.needsConfirmation.join(',') === 'wipe', 'and the irreversible command still asks for confirmation');
});

// ── Part C: the arms that generate nothing ───────────────────────────────────
console.log('\nPart C — designs that validate but build no gate');

await test('C1. A bare app_id without a slash validates and returns NO extension', async () => {
    const r = await call(session, 'aimeat_iam_define', { app_id: 'just-a-label', levels: LEVELS, commands: COMMANDS });
    assert(!r.isError && r.data?.ok === true, `it still validates: ${r.text.slice(0, 300)}`);
    assert(r.data.extension === undefined, `and builds no gate: ${JSON.stringify(r.data.extension)}`);
    // The reason, stated in the source: without an owner/app the node cannot resolve a caller's
    // membership, so a generated gate would answer "no role" to everyone forever.
    assert(r.data.schema.name === 'just-a-label-levels', `the label still names the schema: ${r.data.schema.name}`);
    assert(r.data.apply.length === 3, 'and the apply payloads are unaffected');
});

await test('C2. No app_id at all falls back to "app" and returns no extension', async () => {
    const r = await call(session, 'aimeat_iam_define', { levels: LEVELS, commands: COMMANDS });
    assert(!r.isError && r.data?.ok === true, `validates without an app id: ${r.text.slice(0, 300)}`);
    assert(r.data.extension === undefined, 'no gate');
    assert(r.data.schema.name === 'app-levels', `the fallback label: ${r.data.schema.name}`);
});

await test('C3. REFUSED DESIGN: no level 0 holding "*" is a lockout and is rejected', async () => {
    const r = await call(session, 'aimeat_iam_define', {
        app_id: APP_ID,
        levels: [{ level: 10, key: 'editor', label: 'Editor', capabilities: ['edit'] }],
        commands: COMMANDS,
    });
    assert(!r.isError, 'the tool answers rather than erroring');
    assert(r.data?.ok === false, `the design is refused: ${r.text.slice(0, 200)}`);
    assert(/level 0 holding/.test(r.data.error), `and says why: ${r.data.error}`);
    assert(r.data.extension === undefined, 'a refused design builds nothing');
});

await test('C4. PINNED: an EMPTY command list is refused, so the generator\'s empty arms have no door', async () => {
    // validateCommandManifest requires a non-empty array, and defineAppIam runs it before it
    // generates anything. So generateIamExtension's empty-COMMANDS branches (an empty command enum,
    // a commands.js with nothing in it) cannot be reached through the only door that calls it.
    const r = await call(session, 'aimeat_iam_define', {
        app_id: APP_ID,
        levels: [{ level: 0, key: 'root', label: 'Root', capabilities: ['*'] }],
        commands: [],
    });
    assert(!r.isError, 'the tool answers rather than erroring');
    assert(r.data?.ok === false, `refused: ${r.text.slice(0, 200)}`);
    assert(/commands must be a non-empty array/.test(r.data.error), `and says why: ${r.data.error}`);
});

await test('C5. Duplicate level keys and a bad tier are both refused before anything is built', async () => {
    const dupe = await call(session, 'aimeat_iam_define', {
        app_id: APP_ID,
        levels: [
            { level: 0, key: 'root', label: 'Root', capabilities: ['*'] },
            { level: 10, key: 'root', label: 'Root again', capabilities: ['read'] },
        ],
        commands: COMMANDS,
    });
    assert(dupe.data?.ok === false && /duplicate level key/.test(dupe.data.error), `duplicate key: ${dupe.text.slice(0, 200)}`);

    const dupeCmd = await call(session, 'aimeat_iam_define', {
        app_id: APP_ID, levels: LEVELS,
        commands: [
            { id: 'list', description: 'List', capability: 'read', tier: 'read' },
            { id: 'list', description: 'List again', capability: 'read', tier: 'read' },
        ],
    });
    assert(dupeCmd.data?.ok === false && /duplicate command id/.test(dupeCmd.data.error), `duplicate command: ${dupeCmd.text.slice(0, 200)}`);
});

// ── Part D: refusals ─────────────────────────────────────────────────────────
console.log('\nPart D — refusals');

await test('D1. REFUSAL: the tool refuses a call whose arguments do not match its schema', async () => {
    // `levels` and `commands` are required and `tier` is an enum of three words. A malformed call is
    // an MCP protocol error, not an { ok: false } answer, so a client can tell the two apart.
    const missing = await call(session, 'aimeat_iam_define', { app_id: APP_ID });
    assert(missing.isError, `a call with no levels is refused: ${JSON.stringify(missing.raw).slice(0, 300)}`);

    const badTier = await call(session, 'aimeat_iam_define', {
        app_id: APP_ID, levels: LEVELS,
        commands: [{ id: 'x', description: 'x', capability: 'read', tier: 'catastrophic' }],
    });
    assert(badTier.isError, `an unknown mutation tier is refused: ${JSON.stringify(badTier.raw).slice(0, 300)}`);
});

await test('D2. REFUSAL: a tool this session\'s scopes do not cover is not on the surface at all', async () => {
    // A second agent, narrowed to memory:read. The MCP door registers a tool only when the
    // session's scopes allow it, so a scope-gated one is absent from tools/list AND unreachable by
    // name. aimeat_iam_define carries no scope word — it is a pure design function that touches no
    // storage — so it stays, which is what makes the comparison mean something.
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'narrowhand', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
    const scoped = await json('/v1/agents/narrowhand/scopes', {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ scopes: ['memory:read'] }),
    });
    assert(scoped.status === 200, `scopes ${scoped.status}: ${JSON.stringify(scoped.body)}`);

    narrow = await openSession(ag.body.data.agent.gaii, ag.body.data.private_key, 'narrow');
    const { body } = await rpc(narrow, 'tools/list');
    const names: string[] = body.result.tools.map((t: any) => t.name);
    assert(!names.includes('aimeat_extension_install'), `ext:write is not held, so the install tool is absent: ${names.length} tools`);
    assert(!names.includes('aimeat_memory_write'), 'and neither is the write it was not granted');
    assert(names.includes('aimeat_iam_define'), 'while the ungated design tool is still there');

    const blocked = await call(narrow, 'aimeat_extension_install', { name: 'x', manifest: 'metadata:\n  name: x\n' });
    assert(blocked.isError, `calling it by name is refused: ${JSON.stringify(blocked.raw).slice(0, 300)}`);
    const written = await call(narrow, 'aimeat_memory_write', { key: 'iamgen.probe', value: { x: 1 } });
    assert(written.isError, `and so is the write: ${JSON.stringify(written.raw).slice(0, 300)}`);
});

await test('D3. REFUSAL: the REST door that installs what this tool designs is 401 without a credential', async () => {
    // The generated extension is installed through POST /v1/extensions. The design tool hands back
    // text and nothing else, so the credential check happens at the door that stores it.
    const r = await json('/v1/extensions', {
        method: 'POST',
        body: JSON.stringify({ manifest: rich.extension.manifest, scripts: rich.extension.scripts }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
    // The same door with a credential accepts it, which is what makes the 401 a gate rather than a
    // rejection of the payload.
    const ok = await json('/v1/extensions', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: rich.extension.manifest, scripts: rich.extension.scripts }),
    });
    assert(ok.status === 201, `the generated gate installs as written: ${ok.status}: ${JSON.stringify(ok.body.error ?? '')}`);
    assert(ok.body.data.extension.name === EXT_NAME, `installed under its own name: ${ok.body.data.extension?.name}`);
    const ids = ok.body.data.extension.actions.map((a: any) => a.id).sort();
    assert(ids.join(',') === 'check,commands,roles', `all three actions survived the manifest parse: ${ids}`);
});

await test('Cleanup: remove the generated extension and the owner', async () => {
    const del = await json(`/v1/extensions/${EXT_NAME}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(del.status === 200, `extension delete ${del.status}`);
    const r = await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(r.status === 200, `owner delete ${r.status}`);
});

console.log(`\nIAM generated extension: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
