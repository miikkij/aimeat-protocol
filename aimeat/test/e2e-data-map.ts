/**
 * @file test/e2e-data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map end to end: an app with none says so, an app with one serves it, and
 *   the contradiction that pays for the whole feature is found.
 *
 *   THE FIRST TEST IS THE ONE THAT MATTERS. A previous version of this feature DERIVED a map from an
 *   app's permission words whenever the app said nothing, and the guess then sat exactly where the
 *   answer belonged and read like one. "An app that declares nothing has NO map" is asserted here so
 *   that guessing cannot come back without turning this suite red.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=data-map
 * @version-history
 *   v2.2.0 — 2026-09-26 — A6-10 on the MCP door: aimeat_app_get gives another owner's agent the
 *     manifest without `dataMap.gap`. Failed on the code before the fix: the gap was there.
 *   v2.1.0 — 2026-09-24 — A6-10: another owner and a caller with no token read the stamp without
 *     its `gap`; the owner still reads it.
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`  \u2713 ${name}`);
    } catch (err) {
        failed++;
        console.log(`  \u2717 ${name}\n      ${(err as Error).message}`);
    }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

interface Owner { name: string; token: string }

async function registerOwner(label: string): Promise<Owner> {
    const name = `${label}${Date.now()}${Math.floor(performance.now())}`.toLowerCase().slice(0, 28);
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: 'Data map', password: 'Provenance1234' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
            owner: name, timestamp: ts,
            signature: await sign(reg.body.data.private_key, name + NODE_ID + ts),
        }),
    });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="aimeat-scopes" content="memory:read memory:write">
<title>Map probe</title></head><body><h1>Map probe</h1></body></html>`;

/** A complete map for a group app whose rows really do land where the group can read them. */
const GOOD_MAP = {
    spec: 'aimeat.datamap/2',
    what: 'A shared book for a small team.',
    usedFor: 'Keeping everyone looking at the same list.',
    form: 'group',
    arrangement: 'One workspace inside the team organism.',
    machinery: [],
    leaves: [],
    held: [{
        what: 'book.entries', holds: 'the entries', kind: 'register', usedFor: 'to-share-with-others',
        where: 'organism-workspace', whereExactly: 'org/ws-test/book', owner: 'organism',
        readers: 'organism-members', writers: ['person-in-the-ui'], shape: 'collection-under-one-key',
        keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no',
        why: 'The book belongs to the team, not to whoever typed the entry.',
    }],
    elsewhere: [],
};

/** The same app, arranged the way the original defect was arranged. */
const CONTRADICTED_MAP = {
    ...GOOD_MAP,
    held: [{ ...GOOD_MAP.held[0], where: 'owner-memory-private', owner: 'person', readers: 'owner-only' }],
};

/** An agent of this owner, and its token. aimeat_app_get asks no scope word, so memory:read does. */
async function agentOf(o: Owner): Promise<string> {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ name: `dmapag${Date.now() % 100000}${Math.floor(Math.random() * 900 + 100)}`, owner: o.name, scopes: ['memory:read'] }),
    });
    assert(reg.status === 201, `agent registration ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return tok.body.data.token as string;
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    const NL = String.fromCharCode(10);
    for (const evt of text.split(NL + NL)) {
        let data = '';
        for (const line of evt.trim().split(NL)) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return out;
}

/** One MCP tool call on a fresh session. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<{ raw: string; parsed: any; isError: boolean }> {
    let sessionId = '';
    let id = 1;
    const rpc = async (method: string, params: Record<string, unknown>): Promise<any> => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
        return await res.json();
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Data map E2E', version: '1.0.0' } });
    const out = await rpc('tools/call', { name, arguments: args });
    const raw = out?.result?.content?.[0]?.text ?? '';
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* a refusal is prose */ }
    return { raw, parsed, isError: !!out?.result?.isError };
}

async function publish(o: Owner, filename: string): Promise<void> {
    const r = await json('/v1/apps', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({
            filename, content: Buffer.from(APP_HTML).toString('base64'),
            mime_type: 'text/html', name: 'Map probe', description: 'E2E',
        }),
    });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

(async () => {
    const o = await registerOwner('dmap');
    const other = await registerOwner('dmap2');

    await test('an app that declares nothing has NO map, and the node does not invent one', async () => {
        await publish(o, 'probe-none.html');
        const r = await json(`/v1/datamap/apps/${o.name}/probe-none.html`, { headers: auth(o.token) });
        assert(r.status === 200, `read ${r.status}`);
        // The whole point. A guessed row here is the defect this suite exists to keep out.
        assert(r.body.data.data_map === null,
            `an app that said nothing must have no map, got ${JSON.stringify(r.body.data.data_map)}`);
        assert(r.body.data.stamp.missing === true, 'the stamp says the map is missing');
        assert(r.body.data.stamp.gap?.code === 'DATAMAP_MISSING',
            `the finding names it: ${JSON.stringify(r.body.data.stamp.gap)}`);
    });

    await test('publishing never fails because a map is missing', async () => {
        // Same app again: the check warns and stamps, and the publish goes through.
        await publish(o, 'probe-none.html');
    });

    await test('a written map is served back whole', async () => {
        await publish(o, 'probe-good.html');
        const w = await json(`/v1/datamap/apps/${o.name}/probe-good.html`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify(GOOD_MAP),
        });
        assert(w.status === 200, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);

        const r = await json(`/v1/datamap/apps/${o.name}/probe-good.html`, { headers: auth(o.token) });
        const m = r.body.data.data_map;
        assert(m?.what === GOOD_MAP.what, 'the paragraph comes back');
        assert(m?.usedFor === GOOD_MAP.usedFor, 'what it is used for comes back');
        assert(m?.held?.[0]?.why === GOOD_MAP.held[0].why, 'the why comes back');
        assert(r.body.data.stamp.missing === false, 'the stamp no longer says missing');
        assert((r.body.data.findings ?? []).length === 0,
            `a complete map has nothing missing: ${JSON.stringify(r.body.data.findings)}`);
    });

    await test('the example object the tool itself shows is one the node accepts, with the spec the service takes', async () => {
        // Both MCP doors spelled the spec by hand as /1 while the service took only /2, so the tool
        // told every builder to send what it would refuse. The example is parsed out of the text a
        // builder reads and written for real, so it cannot go false in silence again.
        const { DATA_MAP_PARAM } = await import('../src/mcp/catalog/definitions/data-map.js');
        const start = DATA_MAP_PARAM.indexOf('{ "spec"');
        const end = DATA_MAP_PARAM.indexOf('"elsewhere": [] }') + '"elsewhere": [] }'.length;
        assert(start > 0 && end > start, 'the parameter text carries an example object');
        const example = JSON.parse(DATA_MAP_PARAM.slice(start, end));
        await publish(o, 'probe-example.html');
        const w = await json(`/v1/datamap/apps/${o.name}/probe-example.html`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify(example),
        });
        assert(w.status === 200, `the tool's own example is refused: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const r = await json(`/v1/datamap/apps/${o.name}/probe-example.html`, { headers: auth(o.token) });
        assert(r.body.data.data_map?.held?.[0]?.what === 'habits.v1', 'and it is stored as written');
    });

    await test('the stamp lands on the app manifest at the next publish', async () => {
        await publish(o, 'probe-good.html');
        // The catalogue listing is where a stamp is actually read from, so assert it there.
        const r = await json(`/v1/apps?owner=${o.name}&limit=50`, { headers: auth(o.token) });
        const app = (r.body?.data?.apps ?? []).find((a: { filename: string }) => a.filename === 'probe-good.html');
        const stamp = app?.data_map ?? app?.manifest?.dataMap;
        assert(stamp && stamp.missing === false, `the manifest carries the summary: ${JSON.stringify(stamp)}`);
    });

    await test('a group app whose rows all sit in one person memory is a finding', async () => {
        await publish(o, 'probe-bad.html');
        const w = await json(`/v1/datamap/apps/${o.name}/probe-bad.html`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify(CONTRADICTED_MAP),
        });
        assert(w.status === 200, `write ${w.status}`);
        const codes = (w.body.data.findings ?? []).map((f: { code: string }) => f.code);
        // This is CADENCE's original defect, and it is the reason the feature exists.
        assert(codes.includes('DATAMAP_FORM_CONTRADICTED'),
            `expected the contradiction, got ${JSON.stringify(codes)}`);
    });

    await test('a row with no why is named as unfinished', async () => {
        await publish(o, 'probe-nowhy.html');
        const noWhy = { ...GOOD_MAP, held: [{ ...GOOD_MAP.held[0], why: '' }] };
        const w = await json(`/v1/datamap/apps/${o.name}/probe-nowhy.html`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify(noWhy),
        });
        const codes = (w.body.data.findings ?? []).map((f: { code: string }) => f.code);
        assert(codes.includes('DATAMAP_ROW_NO_WHY'), `expected the unfinished row, got ${JSON.stringify(codes)}`);
    });

    await test('the map is public and the findings are not', async () => {
        const r = await json(`/v1/datamap/apps/${o.name}/probe-nowhy.html`, { headers: auth(other.token) });
        assert(r.status === 200, `a stranger can read the map: ${r.status}`);
        assert(r.body.data.data_map?.what === GOOD_MAP.what, 'the rows are the promise, so they are public');
        assert(r.body.data.findings === undefined,
            'what is still missing is the owner\'s own business, not a stranger\'s');
    });

    // A6-10. The stamp carries the publish check's finding as `gap`, and the read handed it to every
    // caller: another owner and a caller with no token both read `stamp.gap`. It is the owner's
    // unfinished business on the stamp exactly as it is in `findings`.
    await test('the finding on the stamp is the owner\'s too', async () => {
        const mine = await json(`/v1/datamap/apps/${o.name}/probe-none.html`, { headers: auth(o.token) });
        assert(mine.body.data.stamp.gap?.code === 'DATAMAP_MISSING',
            `the owner still reads it: ${JSON.stringify(mine.body.data.stamp)}`);
        const readers: Array<[string, RequestInit]> = [['another owner', { headers: auth(other.token) }], ['no token', {}]];
        for (const [who, opts] of readers) {
            const r = await json(`/v1/datamap/apps/${o.name}/probe-none.html`, opts);
            assert(r.status === 200, `${who} can read the map: ${r.status}`);
            assert(r.body.data.stamp.gap === undefined,
                `${who} must not read the finding: ${JSON.stringify(r.body.data.stamp.gap)}`);
            assert(r.body.data.stamp.missing === true, `${who} still reads the rest of the stamp`);
        }
    });

    // A6-10, the MCP door. aimeat_app_get reads any owner's app, and it handed the stamp over whole
    // inside the manifest: the finding the data map door strips went out beside it.
    await test('aimeat_app_get gives another owner\'s agent the manifest without the owner\'s findings', async () => {
        const mine = await mcpCall(await agentOf(o), 'aimeat_app_get', { owner: o.name, filename: 'probe-none.html' });
        assert(!mine.isError && mine.parsed, `the owner's agent reads the app: ${mine.raw}`);
        assert(mine.parsed.manifest?.dataMap?.gap?.code === 'DATAMAP_MISSING',
            `the owner's agent still reads the finding: ${JSON.stringify(mine.parsed.manifest?.dataMap)}`);
        const theirs = await mcpCall(await agentOf(other), 'aimeat_app_get', { owner: o.name, filename: 'probe-none.html' });
        assert(!theirs.isError && theirs.parsed, `another owner's agent reads the app: ${theirs.raw}`);
        const stamp = theirs.parsed.manifest?.dataMap;
        assert(stamp?.missing === true, `the rest of the stamp is public: ${JSON.stringify(stamp)}`);
        assert(stamp.gap === undefined, `another owner's agent must not read the finding: ${JSON.stringify(stamp.gap)}`);
        assert(theirs.parsed.manifest?.specCheck === undefined && theirs.parsed.manifest?.aiPosture?.gap === undefined,
            `nor the other notes that are the owner's own: ${JSON.stringify({ specCheck: theirs.parsed.manifest?.specCheck, gap: theirs.parsed.manifest?.aiPosture?.gap })}`);
    });

    await test('another owner cannot write this map', async () => {
        const w = await json(`/v1/datamap/apps/${o.name}/probe-good.html`, {
            method: 'PUT', headers: auth(other.token), body: JSON.stringify(GOOD_MAP),
        });
        assert(w.status === 403, `cross-owner write must be refused, got ${w.status}`);
    });

    await test('a map without the spec is refused rather than half-stored', async () => {
        const w = await json(`/v1/datamap/apps/${o.name}/probe-good.html`, {
            method: 'PUT', headers: auth(o.token), body: JSON.stringify({ what: 'no spec' }),
        });
        assert(w.status === 400, `expected 400, got ${w.status}`);
        // The refusal says what to send. Three cold builds in a row were told only that a spec was
        // missing (2026-09-19) and had to find the shape somewhere else.
        const msg = String(w.body.error?.message ?? '');
        assert(msg.includes('"spec": "aimeat.datamap/2"') && msg.includes('"held"'), `the refusal shows the whole object: ${msg.slice(0, 200)}`);
        assert(msg.includes('REPLACES') && msg.includes('build-app/data-map'), 'it says why the spec is required and where the fields are');
        // And the good map is still there, untouched.
        const r = await json(`/v1/datamap/apps/${o.name}/probe-good.html`, { headers: auth(o.token) });
        assert(r.body.data.data_map?.what === GOOD_MAP.what, 'a refused write changes nothing');
    });

    await test('an unknown app is a 404, not an empty map', async () => {
        const r = await json(`/v1/datamap/apps/${o.name}/does-not-exist.html`, { headers: auth(o.token) });
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
