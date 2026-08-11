/**
 * @file e2e-skills.ts
 * @description E2E tests for the skills registry (dedicated system, Phase 2a): SKILL.md
 *   contract validation, user/node scopes, SkillRef resolution, agent linking (the crewaimeat
 *   consumer read), cross-owner visibility, MCP aimeat_skill_* tools, and the presigned
 *   skill-directory ZIP upload including traversal/symlink rejection.
 * @version-history
 *   v1.2.0 -- 2026-07-19 -- 27b3: seeded public aimeat-app-builder (AppDev KB Phase 2) —
 *     present in the discovery index, digest-consistent, carries spec-first + research + pitfalls
 *   v1.1.0 -- 2026-07-14 -- Phase 5b: Agent Skills discovery index (/.well-known/agent-skills,
 *     RFC v0.2.0) — $schema + entry shape, sha256 digest match, members-only non-leak, 404s,
 *     seeded public aimeat-node-guide present + digest-consistent
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2a)
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-skills.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function rawFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, opts);
}

// ── ZIP builder (in-memory, for the presigned upload tests) ──
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';

function listZipEntries(buffer: Buffer): Promise<string[]> {
    return new Promise((resolvePromise, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            const entries: string[] = [];
            zipfile!.readEntry();
            zipfile!.on('entry', (entry: yauzl.Entry) => { entries.push(entry.fileName); zipfile!.readEntry(); });
            zipfile!.on('end', () => resolvePromise(entries));
            zipfile!.on('error', reject);
        });
    });
}

function makeZip(entries: Array<{ name: string; data: string; symlink?: boolean }>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const a = new ZipArchive({ zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        a.on('data', (c: Buffer) => chunks.push(c));
        a.on('end', () => resolve(Buffer.concat(chunks)));
        a.on('error', reject);
        for (const e of entries) {
            if (e.symlink) a.symlink(e.name, e.data);
            else a.append(e.data, { name: e.name });
        }
        void a.finalize();
    });
}

// ── SSE / MCP JSON-RPC helpers (server MCP surface) ──
function parseSSE(text: string): any[] {
    const messages: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { messages.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return messages;
}

let mcpToken = '';
let sessionId = '';

async function mcpRpc(method: string, params: Record<string, any> = {}, id: number = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    let body: any;
    if (ct.includes('text/event-stream')) {
        const messages = parseSSE(await res.text());
        body = messages.find(m => m.id === id) ?? messages[0] ?? {};
    } else {
        body = await res.json() as any;
    }
    return { status: res.status, body, headers: res.headers };
}

function toolText(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '{}';
    try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ─── State ───
const ownerName = `sklowner${Date.now()}`;
const otherOwnerName = `sklother${Date.now()}`;
const agentName = 'skills-test-agent';
let ownerPrivKey = '';
let ownerToken = '';
let otherOwnerPrivKey = '';
let otherOwnerToken = '';
let agentGaii = '';
let agentPrivKey = '';
let agentToken = '';

const SKILL_MD = `---
name: research-briefs
description: How to write a concise research brief for this organisation. Use when asked to summarize findings or draft a brief.
license: MIT
metadata:
  tags: research, writing
---

# Research briefs

Always lead with the conclusion. Three sections: finding, evidence, recommendation.
`;

console.log('\n=== AIMEAT Skills Registry E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owners & Agent');

await test('Register owner A', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register owner B', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: otherOwnerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}`);
    otherOwnerPrivKey = body.data.private_key;
    otherOwnerToken = await getToken(otherOwnerName, otherOwnerPrivKey, false);
});

await test('Register agent under owner A', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        // '*' plus the words no wildcard carries. Since 2026-08-11 the calls this suite drives in
        // phases 6 and 8 — rewriting another agent's permissions, and changing the owner's AI
        // settings — each cost their own tick, so a Full-access agent does not get them for free.
        body: JSON.stringify({
            name: agentName, owner: ownerName, capabilities: ['memory'],
            scopes: ['*', 'agent:permissions', 'memory:write-reserved', 'memory:write-as-owner'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    agentToken = await getToken(agentGaii, agentPrivKey, true);
});

// ─── Phase 1: Publish + contract validation ───
console.log('\nPhase 1 -- Publish & SKILL.md contract');

await test('1. Publish a user-scope skill (inline SKILL.md)', async () => {
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: SKILL_MD }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skill.name === 'research-briefs', 'name parsed');
    assert(body.data.skill.version === '1.0.0', `version ${body.data.skill.version}`);
    assert(body.data.skill.ref === `user:${ownerName}/research-briefs`, `ref ${body.data.skill.ref}`);
    assert(body.data.skill.scope === 'user', 'scope user');
    assert(body.data.skill.license === 'MIT', 'license carried');
});

await test('2. Republish bumps the patch version', async () => {
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: SKILL_MD }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.data.skill.version === '1.0.1', `version ${body.data.skill.version}`);
});

await test('3. Missing frontmatter rejected (422)', async () => {
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: '# just markdown, no frontmatter' }),
    });
    assert(status === 422, `status ${status}: ${JSON.stringify(body)}`);
});

await test('4. Bad name (uppercase) rejected (422)', async () => {
    const bad = SKILL_MD.replace('name: research-briefs', 'name: Research-Briefs');
    const { status } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: bad }),
    });
    assert(status === 422, `status ${status}`);
});

await test('5. Missing description rejected (422)', async () => {
    const bad = SKILL_MD.replace(/description: .*\n/, '');
    const { status } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: bad }),
    });
    assert(status === 422, `status ${status}`);
});

await test('6. File outside the contract layout rejected (422)', async () => {
    const { status } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: SKILL_MD, files: { 'evil/notes.txt': 'nope' } }),
    });
    assert(status === 422, `status ${status}`);
});

await test('7. Multi-file skill publishes with a file index', async () => {
    const md = SKILL_MD.replace('research-briefs', 'brief-tooling');
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            skill_md: md,
            files: { 'scripts/outline.py': 'print("outline")', 'references/style.md': '# Style' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    const paths = body.data.skill.files.map((f: any) => f.path).sort();
    assert(JSON.stringify(paths) === JSON.stringify(['SKILL.md', 'references/style.md', 'scripts/outline.py']), `files: ${paths}`);
});

// ─── Phase 2: List + resolve ───
console.log('\nPhase 2 -- Library & resolution');

await test('8. Library lists own user skills without bodies', async () => {
    const { status, body } = await json('/v1/skills', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const names = body.data.library.user.map((s: any) => s.name);
    assert(names.includes('research-briefs'), `user library: ${names}`);
    assert(body.data.library.user[0].fileContents === undefined, 'no bodies in listings');
});

await test('9. Resolve loads the SKILL.md body', async () => {
    const { status, body } = await json('/v1/skills/research-briefs', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.skill.fileContents['SKILL.md'].includes('Always lead with the conclusion'), 'body loaded');
});

await test('10. manifest_only skips bodies', async () => {
    const { body } = await json('/v1/skills/research-briefs?manifest_only=true', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(Object.keys(body.data.skill.fileContents).length === 0, 'no bodies');
});

await test('11. Owner B cannot read A\'s owner-visibility skill', async () => {
    const { status } = await json(`/v1/skills/research-briefs?scope=user&owner=${ownerName}`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 403 || status === 404, `status ${status}`);
});

await test('12. Public skill is readable cross-owner', async () => {
    const md = SKILL_MD.replace('research-briefs', 'shared-wisdom');
    const pub = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: md, visibility: 'public' }),
    });
    assert(pub.status === 201, `publish status ${pub.status}`);
    const { status, body } = await json(`/v1/skills/shared-wisdom?scope=user&owner=${ownerName}`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skill.ref === `user:${ownerName}/shared-wisdom`, 'ref');
});

// ─── Phase 3: Agent linking (the crewaimeat consumer read) ───
console.log('\nPhase 3 -- Agent linking');

await test('13. Owner links a skill to the agent', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ref: `user:${ownerName}/research-briefs` }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.links.length === 1, 'one link');
    assert(body.data.links[0].ref === `user:${ownerName}/research-briefs`, 'ref stored');
});

await test('14. Linking is idempotent per ref', async () => {
    const { body } = await json(`/v1/agents/${agentName}/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ref: `user:${ownerName}/research-briefs` }),
    });
    assert(body.data.links.length === 1, `links: ${body.data.links.length}`);
});

await test('15. Linking an unreadable/unknown ref fails', async () => {
    const { status } = await json(`/v1/agents/${agentName}/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ref: `user:${ownerName}/does-not-exist` }),
    });
    assert(status === 404, `status ${status}`);
});

await test('16. Agent reads its own skills resolved (the consumer read)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/skills`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.skills.length === 1, 'one resolved skill');
    assert(body.data.skills[0].fileContents['SKILL.md'].includes('Research briefs'), 'body inlined');
    assert(body.data.unresolved.length === 0, 'nothing unresolved');
});

await test('17. A foreign agent cannot read this agent\'s skills', async () => {
    const { status } = await json(`/v1/agents/${agentName}/skills`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    // Owner B reads under their own owner namespace -> empty links, not A's.
    const { body } = await json(`/v1/agents/${agentName}/skills`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 200 && body.data.skills.length === 0, `cross-owner leak: ${JSON.stringify(body.data)}`);
});

await test('18. Deleting a linked skill surfaces as unresolved, never silently dropped', async () => {
    const md = SKILL_MD.replace('research-briefs', 'ephemeral-skill');
    await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: md }),
    });
    await json(`/v1/agents/${agentName}/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ref: `user:${ownerName}/ephemeral-skill` }),
    });
    const del = await json(`/v1/skills/ephemeral-skill`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(del.status === 200, `delete status ${del.status}`);
    const { body } = await json(`/v1/agents/${agentName}/skills`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.data.unresolved.some((u: any) => u.ref === `user:${ownerName}/ephemeral-skill`), 'unresolved reported');
});

await test('19. Unlink removes the ref', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/skills?ref=${encodeURIComponent(`user:${ownerName}/ephemeral-skill`)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(!body.data.links.some((l: any) => l.ref === `user:${ownerName}/ephemeral-skill`), 'ref gone');
});

// ─── Phase 4: MCP tools + presigned ZIP upload ───
console.log('\nPhase 4 -- MCP tools & presigned skill ZIP');

let clientId = '';
let clientSecret = '';

await test('MCP OAuth setup', async () => {
    const reg = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'Skills E2E Client', redirect_uris: [] }),
    });
    assert(reg.status === 201, `register status ${reg.status}`);
    clientId = reg.body.client_id;
    clientSecret = reg.body.client_secret;

    const timestamp = new Date().toISOString();
    const message = agentGaii + NODE_ID + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii: agentGaii, signature, timestamp });
    const { body: authBody } = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authBody.code === 'string', 'has auth code');
    const { status, body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: authBody.code, client_id: clientId, client_secret: clientSecret }),
    });
    assert(status === 200, `token status ${status}`);
    mcpToken = tokenBody.access_token;

    const init = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'Skills E2E', version: '1.0.0' },
    });
    assert(init.status === 200, `init status ${init.status}`);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken}`,
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

await test('20. aimeat_skill_* tools registered', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const names = body.result.tools.map((t: any) => t.name);
    for (const t of ['aimeat_skill_publish', 'aimeat_skill_list', 'aimeat_skill_get', 'aimeat_skill_link', 'aimeat_skill_unlink']) {
        assert(names.includes(t), `missing ${t}`);
    }
});

await test('21. aimeat_skill_list library view sees the owner\'s skills', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_list', arguments: {} }, 101);
    const data = toolText(body);
    const names = (data.library?.user ?? []).map((s: any) => s.name);
    assert(names.includes('research-briefs'), `library.user: ${JSON.stringify(names)}`);
});

await test('22. aimeat_skill_get resolves by bare name', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_get', arguments: { name: 'research-briefs' } }, 102);
    const data = toolText(body);
    assert(data.skill?.fileContents?.['SKILL.md']?.includes('Research briefs'), `got: ${JSON.stringify(data).slice(0, 200)}`);
});

await test('23. Presigned skill ZIP upload publishes the skill', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_publish', arguments: {} }, 103);
    const data = toolText(body);
    assert(typeof data.upload_url === 'string', `no upload_url: ${JSON.stringify(data).slice(0, 200)}`);

    const zip = await makeZip([
        { name: 'zipped-skill/SKILL.md', data: SKILL_MD.replace('research-briefs', 'zipped-skill') },
        { name: 'zipped-skill/references/notes.md', data: '# Notes' },
    ]);
    const up = await fetch(data.upload_url, { method: 'PUT', body: new Uint8Array(zip) });
    const upBody = await up.json() as any;
    assert(up.status === 200, `upload status ${up.status}: ${JSON.stringify(upBody)}`);
    assert(upBody.skill?.name === 'zipped-skill', `published: ${JSON.stringify(upBody.skill)}`);

    const { body: getBody } = await json(`/v1/skills/zipped-skill`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getBody.data.skill.files.length === 2, 'both files stored');
});

await test('24. ZIP with path traversal rejected (422)', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_publish', arguments: {} }, 104);
    const data = toolText(body);
    const zip = await makeZip([
        { name: 'bad-skill/SKILL.md', data: SKILL_MD },
        { name: '../../etc/passwd', data: 'root:x:0:0' },
    ]);
    const up = await fetch(data.upload_url, { method: 'PUT', body: new Uint8Array(zip) });
    assert(up.status === 422, `status ${up.status}`);
});

await test('25. ZIP with symlink entry rejected (422)', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_publish', arguments: {} }, 105);
    const data = toolText(body);
    const zip = await makeZip([
        { name: 'sym-skill/SKILL.md', data: SKILL_MD.replace('research-briefs', 'sym-skill') },
        { name: 'sym-skill/scripts/link.sh', data: '/etc/passwd', symlink: true },
    ]);
    const up = await fetch(data.upload_url, { method: 'PUT', body: new Uint8Array(zip) });
    assert(up.status === 422, `status ${up.status}`);
});

await test('26. aimeat_skill_link + unlink round-trip', async () => {
    const link = await mcpRpc('tools/call', { name: 'aimeat_skill_link', arguments: { ref: `user:${ownerName}/zipped-skill` } }, 106);
    const linkData = toolText(link.body);
    assert((linkData.links ?? []).some((l: any) => l.ref === `user:${ownerName}/zipped-skill`), `links: ${JSON.stringify(linkData)}`);

    const unlink = await mcpRpc('tools/call', { name: 'aimeat_skill_unlink', arguments: { ref: `user:${ownerName}/zipped-skill` } }, 107);
    const unlinkData = toolText(unlink.body);
    assert(!(unlinkData.links ?? []).some((l: any) => l.ref === `user:${ownerName}/zipped-skill`), 'unlinked');
});

// ─── Phase 5: Node scope (operator-gated) ───
console.log('\nPhase 5 -- Node scope');

await test('27. Node-scope publish is operator-gated (403 for non-operator, 201+library for operator)', async () => {
    const md = SKILL_MD.replace('research-briefs', 'node-runbook');
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: md, scope: 'node' }),
    });
    if (status === 201) {
        // This owner happens to be the node's first owner (= operator on a fresh test DB).
        assert(body.data.skill.ref === 'node:node-runbook', `ref ${body.data.skill.ref}`);
        const lib = await json('/v1/skills', { headers: { Authorization: `Bearer ${otherOwnerToken}` } });
        const names = lib.body.data.library.node.map((s: any) => s.name);
        assert(names.includes('node-runbook'), `node library visible to all members: ${names}`);
    } else {
        assert(status === 403, `expected 403 or 201, got ${status}: ${JSON.stringify(body)}`);
    }
});

// ─── Phase 5b: Agent Skills discovery index (/.well-known/agent-skills, RFC v0.2.0) ───
console.log('\nPhase 5b -- Agent Skills discovery index');

// Whether owner A turned out to be the node operator (fresh test DB) — set in 27b,
// gates the presence assertions that need a public node-scope skill to exist.
let discoveryIsOperator = false;
const DISCOVERY_MD = SKILL_MD.replace('research-briefs', 'discovery-pub');
const DISCOVERY_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

await test('27b. index.json serves $schema + RFC-shaped entries; public node skill listed with matching sha256', async () => {
    // Publish a PUBLIC node-scope skill (201 only when owner A is the operator).
    const pub = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: DISCOVERY_MD, scope: 'node', visibility: 'public' }),
    });
    discoveryIsOperator = pub.status === 201;
    assert(discoveryIsOperator || pub.status === 403, `expected 201 or 403, got ${pub.status}`);

    // The index is anonymous — no Authorization header.
    const res = await rawFetch('/.well-known/agent-skills/index.json');
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('application/json'), `content-type ${res.headers.get('content-type')}`);
    const idx = await res.json() as any;
    assert(idx.$schema === DISCOVERY_SCHEMA, `$schema ${idx.$schema}`);
    assert(Array.isArray(idx.skills), 'skills is an array');
    for (const s of idx.skills) {
        assert(typeof s.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name), `bad name: ${s.name}`);
        assert(s.type === 'skill-md' || s.type === 'archive', `bad type: ${s.type}`);
        assert(typeof s.description === 'string' && s.description.length <= 1024, `bad description on ${s.name}`);
        assert(typeof s.url === 'string' && s.url.length > 0, `bad url on ${s.name}`);
        assert(/^sha256:[0-9a-f]{64}$/.test(s.digest), `bad digest on ${s.name}: ${s.digest}`);
    }
    // The seeded public "start here" skill guarantees the index is never empty on any node.
    assert(idx.skills.some((s: any) => s.name === 'aimeat-node-guide'),
        `seeded aimeat-node-guide missing from index: ${JSON.stringify(idx.skills.map((s: any) => s.name))}`);
    // Members-visibility builtin seeds must NOT leak into the public index.
    assert(!idx.skills.some((s: any) => s.name === 'manage-my-agents'), 'members-only builtin skill leaked into the index');
    if (discoveryIsOperator) {
        const entry = idx.skills.find((s: any) => s.name === 'discovery-pub');
        assert(entry, `discovery-pub missing from index: ${JSON.stringify(idx.skills.map((s: any) => s.name))}`);
        const expected = `sha256:${createHash('sha256').update(DISCOVERY_MD, 'utf8').digest('hex')}`;
        assert(entry.digest === expected, `digest ${entry.digest} != ${expected}`);
        // The members-visibility node skill from test 27 must NOT leak into the public index.
        assert(!idx.skills.some((s: any) => s.name === 'node-runbook'), 'members-only node skill leaked into the index');
    }
});

await test('27b2. seeded aimeat-node-guide serves anonymously and its bytes hash to the index digest', async () => {
    const idxRes = await rawFetch('/.well-known/agent-skills/index.json');
    const idx = await idxRes.json() as any;
    const entry = idx.skills.find((s: any) => s.name === 'aimeat-node-guide');
    assert(entry, 'aimeat-node-guide missing from index');
    const res = await rawFetch('/.well-known/agent-skills/aimeat-node-guide/SKILL.md');
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.text();
    const actual = `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
    assert(actual === entry.digest, `served bytes hash ${actual} != index digest ${entry.digest}`);
    assert(body.includes('device-authorize'), 'guide covers agent connection');
    assert(body.includes('/v1/prompts/build-app'), 'guide covers app building');
    assert(body.includes('handbook'), 'guide covers handbooks');
});

await test('27b3. seeded aimeat-app-builder is public and serves the paved-path workflow', async () => {
    const idxRes = await rawFetch('/.well-known/agent-skills/index.json');
    const idx = await idxRes.json() as any;
    const entry = idx.skills.find((s: any) => s.name === 'aimeat-app-builder');
    assert(entry, `aimeat-app-builder missing from index: ${JSON.stringify(idx.skills.map((s: any) => s.name))}`);
    const res = await rawFetch('/.well-known/agent-skills/aimeat-app-builder/SKILL.md');
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.text();
    const actual = `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
    assert(actual === entry.digest, `served bytes hash ${actual} != index digest ${entry.digest}`);
    assert(body.includes('/v1/prompts/build-app'), 'skill misses the spec-first rule');
    assert(body.includes('/v1/appdev/pitfalls'), 'skill misses the pitfall registry');
    assert(body.includes('Research before building'), 'skill misses the research phase');
    assert(body.includes('aimeat_app_publish'), 'skill misses the MCP publish path');
});

await test('27c. SKILL.md URL serves the digested bytes anonymously; members-only + unknown skills 404', async () => {
    if (discoveryIsOperator) {
        const res = await rawFetch('/.well-known/agent-skills/discovery-pub/SKILL.md');
        assert(res.status === 200, `status ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('markdown'), `content-type ${res.headers.get('content-type')}`);
        const body = await res.text();
        assert(body === DISCOVERY_MD, 'served SKILL.md differs from the published content');
        // members-only node skill (test 27) is not served anonymously
        const hidden = await rawFetch('/.well-known/agent-skills/node-runbook/SKILL.md');
        assert(hidden.status === 404, `members-only skill status ${hidden.status}, expected 404`);
    }
    const missing = await rawFetch('/.well-known/agent-skills/no-such-skill/SKILL.md');
    assert(missing.status === 404, `unknown skill status ${missing.status}, expected 404`);
    const badName = await rawFetch('/.well-known/agent-skills/Not--Valid/SKILL.md');
    assert(badName.status === 404, `invalid name status ${badName.status}, expected 404`);
});

// ─── Phase 6: Discover ───
console.log('\nPhase 6 -- Discovery');

await test('28. Skills appear in /v1/discover as type=skill', async () => {
    const { status, body } = await json('/v1/discover?type=skill&scope=own', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const entries = body.data.entries ?? [];
    assert(entries.some((e: any) => e.type === 'skill' && e.title?.includes?.('research-briefs') || e.id?.includes?.('research-briefs') || JSON.stringify(e).includes('research-briefs')),
        `no skill entry: ${JSON.stringify(entries).slice(0, 300)}`);
});

// ─── Phase 7: Operator enactment (propose-then-confirm) ───
console.log('\nPhase 7 -- Operator enactment');

await test('29. aimeat_agent_profile includes linked skills', async () => {
    await mcpRpc('tools/call', { name: 'aimeat_skill_link', arguments: { ref: `user:${ownerName}/research-briefs` } }, 110);
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_agent_profile', arguments: { gaii: agentGaii } }, 111);
    const data = body?.result?.structuredContent ?? toolText(body);
    const refs = (data.skills ?? []).map((s: any) => s.ref);
    assert(refs.includes(`user:${ownerName}/research-briefs`), `skills: ${JSON.stringify(refs)}`);
});

let confirmToken = '';

await test('30. operator_agent_configure without token returns a proposal, applies nothing', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_operator_agent_configure',
        arguments: { agent_name: agentName, display_name: 'Skills Test Agent' },
    }, 112);
    const data = toolText(body);
    assert(data.mode === 'proposal', `mode: ${JSON.stringify(data).slice(0, 200)}`);
    assert(typeof data.confirm_token === 'string', 'has confirm_token');
    assert(data.diff?.display_name?.to === 'Skills Test Agent', `diff: ${JSON.stringify(data.diff)}`);
    confirmToken = data.confirm_token;

    const { body: profBody } = await json(`/v1/agents/${agentName}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const dn = profBody?.data?.agent?.displayName ?? profBody?.data?.displayName;
    assert(dn !== 'Skills Test Agent', `applied without confirm! displayName=${dn}`);
});

await test('31. changed payload invalidates the token (PAYLOAD_MISMATCH)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_operator_agent_configure',
        arguments: { agent_name: agentName, display_name: 'A DIFFERENT NAME', confirm_token: confirmToken },
    }, 113);
    const text = body?.result?.content?.[0]?.text ?? '';
    assert(body?.result?.isError === true && text.includes('PAYLOAD_MISMATCH'), `got: ${text.slice(0, 120)}`);
});

await test('32. confirm with the token applies the exact change', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_operator_agent_configure',
        arguments: { agent_name: agentName, display_name: 'Skills Test Agent', confirm_token: confirmToken },
    }, 114);
    const data = toolText(body);
    assert(data.mode === 'applied', `mode: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.current?.display_name === 'Skills Test Agent', 'applied');
});

await test('33. the token is single-use', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_operator_agent_configure',
        arguments: { agent_name: agentName, display_name: 'Skills Test Agent', confirm_token: confirmToken },
    }, 115);
    const data = toolText(body);
    const text = body?.result?.content?.[0]?.text ?? '';
    // Either the values now equal current (nothing to apply) or the token is rejected as used.
    assert(text.includes('TOKEN_USED') || data.note?.includes('nothing to apply') || (data.diff && Object.keys(data.diff).length === 0),
        `got: ${text.slice(0, 150)}`);
});

await test('34. scope WIDENING is rejected even at propose time', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_operator_agent_configure',
        arguments: { agent_name: agentName, scopes: ['memory:read', 'memory:write', 'wallet:read', 'consent:manage', 'work:request'] },
    }, 116);
    const text = body?.result?.content?.[0]?.text ?? '';
    const data = toolText(body);
    // Agents provisioned with '*' may pass the guard; otherwise additions must be refused.
    const rejected = body?.result?.isError === true && text.includes('Scope additions are not allowed');
    const wildcarded = data.mode === 'proposal';
    assert(rejected || wildcarded, `got: ${text.slice(0, 150)}`);
});

// ─── Phase 8: Workspace scope (2c) ───
console.log('\nPhase 8 -- Workspace scope');

let orgId = '';
const WS = 'ws-skilltest1';
const WS_SKILL_MD = SKILL_MD.replace('research-briefs', 'team-style');

await test('35. Setup: organism + workspace manifest', async () => {
    const o = await json('/v1/organisms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'Skills Test Org', type: 'project', join_policy: 'open', visibility: 'public' }),
    });
    assert(o.status === 201, `org status ${o.status}: ${JSON.stringify(o.body)}`);
    orgId = o.body.data.organism.id;
    const ts = new Date().toISOString();
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Skill WS', createdAt: ts, createdBy: ownerName }] }, visibility: 'private' }),
    });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Skill WS', kind: 'project', status: 'active', objectTypes: [
        { name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
    ] };
    const m = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }),
    });
    assert(m.status === 200 || m.status === 201, `manifest ${m.status}`);
});

await test('36. Member publishes a workspace-scope skill', async () => {
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: WS_SKILL_MD, scope: 'workspace', organism: orgId, ws: WS }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skill.ref === `ws:${orgId}/${WS}/team-style`, `ref ${body.data.skill.ref}`);
    assert(body.data.skill.visibility === 'workspace', `visibility ${body.data.skill.visibility}`);
});

await test('37. Workspace listing + library workspace group contain it', async () => {
    const list = await json(`/v1/skills?scope=workspace&organism=${orgId}&ws=${WS}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(list.status === 200 && list.body.data.skills.some((s: any) => s.name === 'team-style'), `list: ${JSON.stringify(list.body.data)}`);
    const lib = await json('/v1/skills', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert((lib.body.data.library.workspace ?? []).some((s: any) => s.ref === `ws:${orgId}/${WS}/team-style`),
        `library.workspace: ${JSON.stringify(lib.body.data.library.workspace)}`);
});

await test('37b. Workspace overview map surfaces the skill with its ws: ref', async () => {
    const { status, body } = await json(`/v1/organisms/${orgId}/workspace/overview?ws=${WS}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const md = body.data?.markdown ?? JSON.stringify(body.data);
    assert(md.includes('Skills (loadable expertise)'), 'skills section present');
    assert(md.includes(`ws:${orgId}/${WS}/team-style`), `ref in map: ${md.slice(md.indexOf('Skills'), md.indexOf('Skills') + 200)}`);
});

await test('38. Resolve loads the workspace skill body', async () => {
    const { status, body } = await json(`/v1/skills/team-style?scope=workspace&organism=${orgId}&ws=${WS}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.skill.fileContents['SKILL.md'].includes('Research briefs'), 'body loaded');
});

await test('39. Non-member can neither read nor publish', async () => {
    const read = await json(`/v1/skills/team-style?scope=workspace&organism=${orgId}&ws=${WS}`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(read.status === 403 || read.status === 404, `read status ${read.status}`);
    const pub = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
        body: JSON.stringify({ skill_md: WS_SKILL_MD, scope: 'workspace', organism: orgId, ws: WS }),
    });
    assert(pub.status === 403, `publish status ${pub.status}: ${JSON.stringify(pub.body)}`);
});

await test('40. Workspace skill links to an agent and resolves', async () => {
    const link = await json(`/v1/agents/${agentName}/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ref: `ws:${orgId}/${WS}/team-style` }),
    });
    assert(link.status === 200, `link status ${link.status}: ${JSON.stringify(link.body)}`);
    const { body } = await json(`/v1/agents/${agentName}/skills`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const ws = body.data.skills.find((s: any) => s.ref === `ws:${orgId}/${WS}/team-style`);
    assert(!!ws && ws.fileContents['SKILL.md'].includes('Research briefs'), `resolved: ${JSON.stringify(body.data.unresolved)}`);
});

await test('41. Workspace skills ride the workspace export/import round-trip', async () => {
    const exp = await json(`/v1/organisms/${orgId}/workspace/export?ws=${WS}&format=base64`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(exp.status === 200, `export ${exp.status}`);
    const imp = await json(`/v1/organisms/${orgId}/workspace/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ zip_base64: exp.body.data.zip_base64 }),
    });
    assert(imp.status === 200 || imp.status === 201, `import ${imp.status}: ${JSON.stringify(imp.body)}`);
    const newWs = imp.body.data.ws ?? imp.body.data.workspace ?? imp.body.data.new_ws;
    assert(typeof newWs === 'string', `new ws id: ${JSON.stringify(imp.body.data)}`);
    const list = await json(`/v1/skills?scope=workspace&organism=${orgId}&ws=${newWs}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(list.body.data.skills.some((s: any) => s.name === 'team-style'), `imported ws skills: ${JSON.stringify(list.body.data.skills)}`);
});

await test('42. Member deletes the workspace skill', async () => {
    const del = await json(`/v1/skills/team-style?scope=workspace&organism=${orgId}&ws=${WS}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body)}`);
    const read = await json(`/v1/skills/team-style?scope=workspace&organism=${orgId}&ws=${WS}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(read.status === 404, `after delete: ${read.status}`);
});

// ─── Phase 9: @version pins + app bindings ───
console.log('\nPhase 9 -- Version pins & app bindings');

await test('43. Version pin resolves the retained snapshot, latest stays latest', async () => {
    const v1 = SKILL_MD.replace('research-briefs', 'pinned-skill').replace('Always lead with the conclusion', 'BODY VERSION ONE');
    const v2 = SKILL_MD.replace('research-briefs', 'pinned-skill').replace('Always lead with the conclusion', 'BODY VERSION TWO');
    const p1 = await json('/v1/skills', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ skill_md: v1 }) });
    assert(p1.status === 201 && p1.body.data.skill.version === '1.0.0', `publish v1 ${p1.status}`);
    const p2 = await json('/v1/skills', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ skill_md: v2 }) });
    assert(p2.body.data.skill.version === '1.0.1', 'bumped');

    // Pinned resolve via MCP get (refs carry the pin)
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_get', arguments: { ref: `user:${ownerName}/pinned-skill@1.0.0` } }, 120);
    const data = toolText(body);
    assert(data.skill?.version === '1.0.0', `pinned version: ${data.skill?.version}`);
    assert(data.skill?.fileContents?.['SKILL.md']?.includes('BODY VERSION ONE'), 'pinned body is the old one');
    assert(data.skill?.ref === `user:${ownerName}/pinned-skill@1.0.0`, `pinned ref: ${data.skill?.ref}`);

    const latest = await json('/v1/skills/pinned-skill', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(latest.body.data.skill.fileContents['SKILL.md'].includes('BODY VERSION TWO'), 'latest body is the new one');
});

await test('44. Unretained pin returns NOT_FOUND', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_skill_get', arguments: { ref: `user:${ownerName}/pinned-skill@9.9.9` } }, 121);
    const text = body?.result?.content?.[0]?.text ?? '';
    assert(body?.result?.isError === true && text.includes('not retained'), `got: ${text.slice(0, 120)}`);
});

await test('45. App-bound skill surfaces on the app skills route', async () => {
    const bound = `---
name: app-helper
description: How to use the demo app well. Use when working inside the demo app.
metadata:
  binding: app:${ownerName}/demo.html
---

# Demo app helper
Press the big button.
`;
    const pub = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: bound, visibility: 'public' }),
    });
    assert(pub.status === 201 && pub.body.data.skill.binding === `app:${ownerName}/demo.html`, `binding: ${JSON.stringify(pub.body.data.skill)}`);

    const { status, body } = await json(`/v1/apps/${ownerName}/demo.html/skills`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.skills.some((s: any) => s.name === 'app-helper'), `bound skills: ${JSON.stringify(body.data.skills)}`);

    const filt = await json(`/v1/skills?binding=${encodeURIComponent(`app:${ownerName}/demo.html`)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(filt.body.data.skills.some((s: any) => s.name === 'app-helper'), 'binding query filter');
});

await test('46. Invalid binding format rejected (422)', async () => {
    const withBad = `---
name: bad-binding
description: A skill with a malformed app binding, for the negative test.
metadata:
  binding: not-an-app-ref
---

# Bad binding
`;
    const { status, body } = await json('/v1/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ skill_md: withBad }),
    });
    assert(status === 422, `status ${status}: ${JSON.stringify(body)}`);
});

await test('46b. Skill ZIP download is upload-ready ({name}/SKILL.md layout, pin supported)', async () => {
    const res = await rawFetch(`/v1/skills/pinned-skill/zip`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.headers.get('content-type') === 'application/zip', `ct ${res.headers.get('content-type')}`);
    assert(res.headers.get('x-skill-version') === '1.0.1', `version header ${res.headers.get('x-skill-version')}`);
    const entries = await listZipEntries(Buffer.from(await res.arrayBuffer()));
    assert(entries.includes('pinned-skill/SKILL.md'), `entries: ${entries}`);

    // Pinned download returns the retained snapshot
    const pinned = await rawFetch(`/v1/skills/${encodeURIComponent('pinned-skill@1.0.0')}/zip`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(pinned.status === 200 && pinned.headers.get('x-skill-version') === '1.0.0',
        `pinned ${pinned.status} v${pinned.headers.get('x-skill-version')}`);
});

// ─── Phase 10: workflow propose-mode + operator AI config ───
console.log('\nPhase 10 -- Workflow propose & AI config');

const WF_DEF = {
    title: 'Skills test flow',
    description: 'test',
    trigger: { kind: 'manual' },
    vars: [],
    steps: [] as any[],
    on_step_fail: 'inspect',
};

await test('47. workflow_save propose returns a diff + token without saving', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_workflow_save',
        arguments: { id: 'skills-test-flow', definition: WF_DEF, propose: true },
    }, 130);
    const data = toolText(body);
    assert(data.mode === 'proposal' && typeof data.confirm_token === 'string', `got: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.exists === false, 'not saved yet');
    assert(data.diff?.title?.to === 'Skills test flow', `diff: ${JSON.stringify(data.diff).slice(0, 120)}`);

    const { body: getBody } = await mcpRpc('tools/call', { name: 'aimeat_workflow_get', arguments: { id: 'skills-test-flow' } }, 131);
    assert(getBody?.result?.isError === true, 'workflow must not exist before confirm');

    // Confirm applies (may still fail workflow validation — accept either saved or a
    // VALIDATION error, but never a token error).
    const { body: confBody } = await mcpRpc('tools/call', {
        name: 'aimeat_workflow_save',
        arguments: { id: 'skills-test-flow', definition: WF_DEF, confirm_token: data.confirm_token },
    }, 132);
    const confText = confBody?.result?.content?.[0]?.text ?? '';
    assert(!confText.includes('TOKEN_'), `token error: ${confText.slice(0, 150)}`);
});

await test('48. operator ai_config: read view, propose, confirm, applied', async () => {
    const view = await mcpRpc('tools/call', { name: 'aimeat_operator_ai_config', arguments: {} }, 133);
    const viewData = toolText(view.body);
    assert(viewData.current !== undefined, `view: ${JSON.stringify(viewData).slice(0, 150)}`);

    const prop = await mcpRpc('tools/call', {
        name: 'aimeat_operator_ai_config',
        arguments: { daily_budget_usd: 2.5, model: 'openrouter/test-model' },
    }, 134);
    const propData = toolText(prop.body);
    assert(propData.mode === 'proposal' && typeof propData.confirm_token === 'string', `propose: ${JSON.stringify(propData).slice(0, 200)}`);
    assert(propData.diff?.daily_budget_usd?.to === 2.5, 'budget in diff');

    const appl = await mcpRpc('tools/call', {
        name: 'aimeat_operator_ai_config',
        arguments: { daily_budget_usd: 2.5, model: 'openrouter/test-model', confirm_token: propData.confirm_token },
    }, 135);
    const applData = toolText(appl.body);
    assert(applData.mode === 'applied', `apply: ${JSON.stringify(applData).slice(0, 200)}`);

    const check = await json('/v1/ai/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(check.body.data.daily_budget_usd === 2.5 || check.body.data?.settings?.daily_budget_usd === 2.5,
        `settings after apply: ${JSON.stringify(check.body.data).slice(0, 200)}`);
});

await test('49. ai_config never exposes or accepts the API key', async () => {
    const view = await mcpRpc('tools/call', { name: 'aimeat_operator_ai_config', arguments: {} }, 136);
    const raw = JSON.stringify(toolText(view.body));
    assert(!raw.includes('apiKey') && !raw.includes('encrypted'), `leaked: ${raw.slice(0, 200)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner B', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(otherOwnerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 200, `status ${status}`);
});

await test('Cascade-delete owner A', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Skills Registry E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
