/**
 * @file e2e-ard-manifest.ts
 * @description E2E for the ARD manifest (routes/ard-manifest.ts): /.well-known/ard.json and its
 *   predecessor path /.well-known/ai-catalog.json answer one document that a browser agent can read
 *   cross-origin, that holds to the ai-catalog schema's shape (the scanner at isitagentready.com
 *   checks the structure: specVersion, host, a non-empty entries array, and per entry an
 *   urn:air identifier, a displayName, a media type and exactly one of url or data), whose every
 *   url answers 200 to an anonymous reader, and which lists exactly the agents of the A2A directory
 *   and the skills of the Agent Skills index, so the three discovery documents cannot disagree. An
 *   owner who is not the operator cannot publish a node-wide skill (403), so cannot fill the
 *   manifest with entries of their own.
 * @version-history
 *   2026-10-27 — The MCP entry is the SEP-2127 card (/v1/mcp/server-card), served as its media type.
 *   2026-10-26 — Initial (wish-ai-catalog-well-known-ai-catalog-json-ard).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ard-manifest

import { registerOwner, tokenRoles } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** The entry url on this test server: the node writes its configured base, the suite asks BASE. */
function local(url: string): string {
    const u = new URL(url);
    return `${BASE}${u.pathname}${u.search}`;
}

async function doc(path: string) {
    const res = await fetch(`${BASE}${path}`, { headers: { Origin: 'https://agent.example' } });
    const body = await res.text();
    let json: any = null;
    try { json = JSON.parse(body); } catch { /* asserted below */ }
    return { status: res.status, ct: res.headers.get('content-type') ?? '', cors: res.headers.get('access-control-allow-origin'), body, json };
}

const URN = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;

(async () => {
    console.log('\n🗂️  ARD manifest — /.well-known/ard.json and /.well-known/ai-catalog.json\n');

    const ard = await doc('/.well-known/ard.json');
    const legacy = await doc('/.well-known/ai-catalog.json');

    await test('both paths answer 200 JSON, readable cross-origin', async () => {
        for (const [p, r] of [['ard.json', ard], ['ai-catalog.json', legacy]] as const) {
            assert(r.status === 200, `${p} → ${r.status}`);
            assert(r.ct.includes('application/json'), `${p} content-type ${r.ct}`);
            assert(r.cors === '*', `${p} has no Access-Control-Allow-Origin: *`);
            assert(r.json !== null, `${p} is not JSON`);
        }
    });

    await test('both paths answer the same document', async () => {
        assert(JSON.stringify(ard.json) === JSON.stringify(legacy.json), 'ard.json and ai-catalog.json differ');
    });

    await test('the top level is exactly specVersion, host and entries (ai-catalog allows no other member)', async () => {
        const keys = Object.keys(ard.json).sort();
        assert(JSON.stringify(keys) === JSON.stringify(['entries', 'host', 'specVersion']), `top-level keys ${keys.join(',')}`);
        assert(ard.json.specVersion === '1.0', `specVersion ${ard.json.specVersion}`);
        assert(typeof ard.json.host?.displayName === 'string' && ard.json.host.displayName.length > 0, 'host.displayName missing');
        assert(typeof ard.json.host?.identifier === 'string' && ard.json.host.identifier.length > 0, 'host.identifier missing');
        assert(Array.isArray(ard.json.entries) && ard.json.entries.length > 0, 'entries is empty');
    });

    await test('every entry has a urn:air identifier, a name, a media type, exactly one of url or data, and 2 to 5 queries', async () => {
        const ids = new Set<string>();
        for (const e of ard.json.entries) {
            assert(URN.test(e.identifier), `identifier ${e.identifier}`);
            assert(!ids.has(e.identifier), `identifier ${e.identifier} appears twice`);
            ids.add(e.identifier);
            assert(typeof e.displayName === 'string' && e.displayName.length > 0, `${e.identifier}: displayName`);
            assert(/^[a-z]+\/[a-zA-Z0-9.+-]+$/.test(e.type), `${e.identifier}: type ${e.type}`);
            assert(('url' in e) !== ('data' in e), `${e.identifier}: needs exactly one of url or data`);
            const q = e.representativeQueries;
            assert(Array.isArray(q) && q.length >= 2 && q.length <= 5, `${e.identifier}: ${q?.length} representativeQueries`);
        }
    });

    await test('the MCP server card and the OpenAPI contract are listed', async () => {
        const types = ard.json.entries.map((e: any) => e.type);
        assert(types.includes('application/mcp-server-card+json'), 'no MCP server card entry');
        assert(types.includes('application/vnd.oai.openapi'), 'no OpenAPI entry');
    });

    await test('the MCP entry is the SEP-2127 Server Card, served as its media type', async () => {
        const entry = ard.json.entries.find((e: any) => e.type === 'application/mcp-server-card+json');
        const r = await fetch(local(entry.url), { headers: { Accept: 'application/mcp-server-card+json' } });
        assert(/^application\/mcp-server-card\+json/.test(r.headers.get('content-type') ?? ''), `content-type ${r.headers.get('content-type')}`);
        const card = await r.json() as any;
        assert(card.$schema === 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json', `$schema ${card.$schema}`);
        assert(Array.isArray(card.remotes) && String(card.remotes[0]?.url).endsWith('/v1/mcp'), `remotes ${JSON.stringify(card.remotes)}`);
    });

    await test('every entry url answers 200 to an anonymous reader', async () => {
        for (const e of ard.json.entries) {
            const r = await fetch(local(e.url));
            assert(r.status === 200, `${e.identifier}: ${e.url} → ${r.status}`);
        }
    });

    await test('the agents are the A2A directory\'s, and the skills are the Agent Skills index\'s', async () => {
        const directory = (await doc('/.well-known/agent-card.json')).json;
        const index = (await doc('/.well-known/agent-skills/index.json')).json;
        const byType = (t: string) => ard.json.entries.filter((e: any) => e.type === t).map((e: any) => new URL(e.url).pathname).sort();
        const agentCards = (directory.agents ?? []).map((a: any) => new URL(a.agent_card).pathname).sort();
        const skillFiles = (index.skills ?? []).map((s: any) => new URL(s.url).pathname).sort();
        assert(JSON.stringify(byType('application/a2a-agent-card+json')) === JSON.stringify(agentCards), 'the agents differ from the A2A directory');
        assert(JSON.stringify(byType('application/agent-skills+md')) === JSON.stringify(skillFiles), 'the skills differ from the Agent Skills index');
    });

    await test('robots.txt and the API catalog point at the manifest', async () => {
        const robots = await (await fetch(`${BASE}/robots.txt`)).text();
        assert(/^Agentmap: \S+\/\.well-known\/ard\.json$/m.test(robots), 'robots.txt has no Agentmap line for ard.json');
        const linkset = (await doc('/.well-known/api-catalog')).json;
        const meta = linkset.linkset[0]['service-meta'].map((l: any) => new URL(l.href).pathname);
        assert(meta.includes('/.well-known/ard.json'), 'the API catalog does not link ard.json');
    });

    await test('FAILURE: an owner who is not the operator cannot put a skill into the manifest (403)', async () => {
        // A fresh node makes its first account the operator, so the probe is the second one.
        await registerOwner(BASE, `ardfirst${Date.now().toString(36)}`);
        const owner = await registerOwner(BASE, `ard${Date.now().toString(36)}`);
        assert(!tokenRoles(owner.token).includes('operator'), `the probe owner is an operator: ${tokenRoles(owner.token).join(',')}`);
        const name = `ard-stuffing-${Date.now().toString(36)}`;
        const skillMd = `---\nname: ${name}\ndescription: An owner tries to list this skill node-wide.\n---\n\n# ${name}\n`;
        const r = await fetch(`${BASE}/v1/skills`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
            body: JSON.stringify({ skill_md: skillMd, scope: 'node', visibility: 'public' }),
        });
        assert(r.status === 403, `a node-wide skill from an ordinary owner → ${r.status}`);
        const after = await doc('/.well-known/ard.json');
        assert(!after.body.includes(name), 'the refused skill is in the manifest');
    });

    await test('FAILURE: a write to the manifest is not accepted', async () => {
        const before = await doc('/.well-known/ard.json');
        const r = await fetch(`${BASE}/.well-known/ard.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"entries":[]}' });
        assert(r.status === 404 || r.status === 405, `POST → ${r.status}`);
        const after = await doc('/.well-known/ard.json');
        assert(JSON.stringify(after.json) === JSON.stringify(before.json), 'the manifest changed after a POST');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
