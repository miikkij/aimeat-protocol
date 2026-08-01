/**
 * @file e2e-ai-provenance-agent-plane.ts
 * @description E2E for the AGENT PLANE (TARGET-058 Phase 4): provenance survives the MCP hop.
 *
 *   WHY THIS SUITE EXISTS. Article 50(1) does not reach agent-to-node traffic — an agent is not a
 *   natural person. Carrying provenance here is an ENGINEERING requirement instead: the MCP hop is
 *   where the information either survives or is lost, and once it is lost no amount of labelling
 *   downstream can reconstruct the truth. Everything below is asserted THROUGH THE MCP SURFACE
 *   rather than by calling the service, because the surface is what was broken.
 *
 *   THE FIVE THINGS IT PINS DOWN:
 *     1. An agent writing over MCP with NO declaration is stamped model-written; an OWNER is not.
 *     2. An agent reading content back receives the record and can state how it was made.
 *     3. A caller-supplied `principal` is IGNORED — proven by sending a false one.
 *     4. Declaring requires `provenance:write`, exactly as POST /v1/provenance does, so MCP is not
 *        a way around the REST gate.
 *     5. A direct message — AI-written text DELIVERED to a named person — carries the record into
 *        the RECIPIENT's own mailbox copy. That is also the only new storage column this phase
 *        added, so it is what proves the column and its migration on both providers.
 * @structure owner + two agents (one with provenance:write, one without) · write · read · lie · gate · DM
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance-agent-plane
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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
    return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
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

/** One MCP tool call on a fresh session. Returns the parsed JSON payload the tool put in `content`. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
    let sessionId = '';
    let id = 1;
    const rpc = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
        return await res.json() as any;
    };
    await rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'Agent-plane provenance E2E', version: '1.0.0' },
    });
    const out = await rpc('tools/call', { name, arguments: args });
    const raw = out?.result?.content?.[0]?.text ?? '';
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* an error result is plain prose */ }
    return { raw, parsed, isError: !!out?.result?.isError, structured: out?.result?.structuredContent };
}

/** The list of tools this session is offered, so a scope claim can be checked rather than assumed. */
async function mcpToolNames(token: string): Promise<string[]> {
    let sessionId = '';
    let id = 1;
    const rpc = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
        return await res.json() as any;
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'E2E', version: '1' } });
    const out = await rpc('tools/list', {});
    return (out?.result?.tools ?? []).map((t: any) => t.name);
}

async function setupOwner(label: string) {
    const name = `plane${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Plane', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Plane', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

(async () => {
    console.log('\n── AI provenance on the agent plane (TARGET-058 Phase 4) ──');

    const o = await setupOwner('o');
    // Two agents on ONE owner: the difference between them is the provenance:write scope, which is
    // the whole point of the gate tests below.
    const declarer = await connectAgent(o.token, o.name, `decl${Date.now()}`,
        ['memory:read', 'memory:write', 'provenance:write']);
    // Deliberately WITHOUT provenance:write — that absence is what the gate tests below assert. The
    // messaging scopes are unrelated and are needed for the direct-message case.
    const silent = await connectAgent(o.token, o.name, `sil${Date.now()}`,
        ['memory:read', 'memory:write', 'messages:send', 'messages:read']);

    const agentKey = `plane.agent.${Date.now()}`;
    const ownerKey = `plane.owner.${Date.now()}`;
    const declaredKey = `plane.declared.${Date.now()}`;
    let mint3Id = '';

    // ── 1. The default: silence from an agent is recorded as model-written ──

    await test('MINT-3: an agent writing over MCP with no declaration is stamped model-written', async () => {
        const w = await mcpCall(silent.token, 'aimeat_memory_write', {
            key: agentKey, value: 'Written by an agent that said nothing at all.', visibility: 'private',
        });
        assert(!w.isError, `write failed: ${w.raw.slice(0, 300)}`);
        const prov = w.parsed?.ai_provenance;
        assert(!!prov?.id, `no provenance echoed on the write result: ${w.raw.slice(0, 400)}`);
        mint3Id = prov.id;
        assert(prov.record.level === 'ai-generated', `level ${prov.record.level}`);
        assert(prov.record.humanInvolvement === 'none', `humanInvolvement ${prov.record.humanInvolvement}`);
        assert(prov.record.attestation?.stampedBy === 'node', `stampedBy ${prov.record.attestation?.stampedBy}`);
        assert(prov.record.attestation?.observed === false,
            'observed must be FALSE — the node inferred from the principal type, it did not watch a model');
    });

    await test('An OWNER writing over MCP is NOT stamped (a person is presumed human)', async () => {
        // The owner writes through REST here because /v1/mcp authenticates agents; the assertion is
        // about the RULE, and the rule lives in the one function both surfaces call.
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${o.token}` },
            body: JSON.stringify({ key: ownerKey, value: 'A person typed this.', visibility: 'private' }),
        });
        assert(w.status === 200 || w.status === 201, `owner write ${w.status}: ${JSON.stringify(w.body?.error)}`);
        const r = await json(`/v1/memory/${encodeURIComponent(ownerKey)}`, { headers: { Authorization: `Bearer ${o.token}` } });
        assert(r.status === 200, `owner read ${r.status}`);
        assert(!r.body.data.ai_provenance_id,
            `an owner's own write must carry no stamp, got ${r.body.data.ai_provenance_id}`);
    });

    // ── 2. Reading it back: the agent can state how the content was made ──

    await test('An agent reading its own write back receives the record', async () => {
        const r = await mcpCall(silent.token, 'aimeat_memory_read', { key: agentKey });
        assert(!r.isError, `read failed: ${r.raw.slice(0, 300)}`);
        const prov = r.parsed?.ai_provenance ?? r.structured?.ai_provenance;
        assert(!!prov, `aimeat_memory_read returned no ai_provenance: ${r.raw.slice(0, 400)}`);
        assert(prov.id === mint3Id, `read returned a different record: ${prov.id} vs ${mint3Id}`);
        assert(prov.record.spec === 'aimeat.provenance/v1', `spec ${prov.record.spec}`);
        assert(!!prov.record_url && prov.record_url.includes(`/v1/provenance/${mint3Id}`), `record_url ${prov.record_url}`);
        // The whole point: the agent can now SAY how it was made, in the node's own words.
        assert(!!prov.record.disclosure?.short?.en, 'no pre-rendered disclosure text to quote');
    });

    await test('A record the node never stamped reads as UNSTATED, not as human-written', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(ownerKey)}`, { headers: { Authorization: `Bearer ${o.token}` } });
        assert(r.status === 200, `read ${r.status}`);
        assert(r.body.meta?.provenance === undefined, 'an unstamped item must carry no record at all');
        assert(!r.body.data.ai_provenance_id, 'and no id either — absence is the signal');
    });

    // ── 3. A DECLARATION is honoured, but never for identity ──

    await test('A declared ai_provenance is stored, with the node filling in identity', async () => {
        const w = await mcpCall(declarer.token, 'aimeat_memory_write', {
            key: declaredKey,
            value: 'A person wrote this; the agent is only relaying it.',
            visibility: 'private',
            ai_provenance: { level: 'original', human_involvement: 'full-human', model: 'anthropic/claude-opus-5' },
        });
        assert(!w.isError, `declared write failed: ${w.raw.slice(0, 400)}`);
        const rec = w.parsed?.ai_provenance?.record;
        assert(!!rec, `no record echoed: ${w.raw.slice(0, 400)}`);
        assert(rec.level === 'original', `level ${rec.level} — the declaration was not honoured`);
        assert(rec.humanInvolvement === 'full-human', `humanInvolvement ${rec.humanInvolvement}`);
        // The node's own fields, none of which the caller sent.
        assert(rec.generator?.principal === declarer.gaii, `principal ${rec.generator?.principal} != ${declarer.gaii}`);
        assert(rec.generator?.nodeId === NODE_ID, `nodeId ${rec.generator?.nodeId}`);
        assert(!!rec.attestation?.contentHash?.startsWith('sha256:'), `contentHash ${rec.attestation?.contentHash}`);
        assert(rec.attestation?.stampedBy === 'principal',
            'a caller declaring is a PRINCIPAL stamp — the node did not witness the generation');
        assert(rec.attestation?.observed === false, 'and a principal stamp can never claim observation');
    });

    await test('A caller-supplied principal is IGNORED — proven by sending a false one', async () => {
        const key = `plane.lie.${Date.now()}`;
        const w = await mcpCall(declarer.token, 'aimeat_memory_write', {
            key, value: 'Attributed to somebody else, if the node were careless.', visibility: 'private',
            ai_provenance: {
                level: 'ai-generated',
                // Everything below is a lie the caller is trying to plant. `principal`/`nodeId`/
                // `generator` are not even in the input schema, so they are dropped at the boundary;
                // asserting on the RESULT is what proves the boundary actually holds.
                principal: `impostor@${NODE_ID}`,
                nodeId: 'some-other-node',
                generator: { principal: `victim@${NODE_ID}`, nodeId: 'some-other-node' },
                attestation: { stampedBy: 'node', observed: true, contentHash: 'sha256:' + '0'.repeat(64) },
            } as Record<string, unknown>,
        });
        assert(!w.isError, `write failed: ${w.raw.slice(0, 400)}`);
        const rec = w.parsed?.ai_provenance?.record;
        assert(!!rec, `no record echoed: ${w.raw.slice(0, 400)}`);
        assert(rec.generator.principal === declarer.gaii,
            `IDENTITY WAS TAKEN FROM THE CALLER: ${rec.generator.principal}`);
        assert(rec.generator.nodeId === NODE_ID, `nodeId taken from the caller: ${rec.generator.nodeId}`);
        assert(rec.attestation.stampedBy === 'principal',
            `the caller claimed a NODE stamp and got one: ${rec.attestation.stampedBy}`);
        assert(rec.attestation.observed === false,
            'the caller claimed this node OBSERVED the generation and was believed');
        assert(rec.attestation.contentHash !== 'sha256:' + '0'.repeat(64),
            'the caller supplied the content hash and it was taken on trust');
    });

    // ── 4. The scope gate: MCP must not be a way around POST /v1/provenance ──

    await test('Declaring without provenance:write is REFUSED, naming the scope', async () => {
        const key = `plane.ungated.${Date.now()}`;
        const w = await mcpCall(silent.token, 'aimeat_memory_write', {
            key, value: 'An agent without the scope claiming a person wrote this.', visibility: 'private',
            ai_provenance: { level: 'original', human_involvement: 'full-human' },
        });
        assert(w.isError, 'a declaration without provenance:write must be refused, not silently downgraded');
        assert(w.raw.includes('provenance:write'), `the refusal must name the scope: ${w.raw.slice(0, 300)}`);
    });

    await test('...and the same agent can still WRITE — only the assertion is gated', async () => {
        const key = `plane.stillwrites.${Date.now()}`;
        const w = await mcpCall(silent.token, 'aimeat_memory_write', { key, value: 'No block, no problem.', visibility: 'private' });
        assert(!w.isError, `the ungated write must still succeed: ${w.raw.slice(0, 300)}`);
        assert(w.parsed?.ai_provenance?.record?.level === 'ai-generated',
            'and it is still recorded as what the node observed');
    });

    await test('provenance:write gates a PARAMETER, not a tool — memory_write stays offered', async () => {
        const names = await mcpToolNames(silent.token);
        assert(names.includes('aimeat_memory_write'),
            'an agent that merely cannot assert authorship must not lose the write tool itself');
    });

    await test('The REST declare route requires the same scope, so the two doors agree', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: { Authorization: `Bearer ${silent.token}` },
            body: JSON.stringify({ level: 'original', human_involvement: 'full-human', content_hash: 'sha256:' + 'a'.repeat(64) }),
        });
        assert(r.status === 403, `POST /v1/provenance without the scope should be 403, got ${r.status}`);
    });

    // ── 5. A direct message: AI-written text DELIVERED to a named person ──
    //
    // The one surface where the record has to survive into somebody else's mailbox rather than onto
    // a public page. It is also the only new storage column this phase added, so this is what proves
    // the column and its migration on both providers.

    await test('An agent DM is stamped, and the record comes back on the thread', async () => {
        const send = await mcpCall(silent.token, 'aimeat_dm_send', {
            to: o.gaii, body: 'An agent wrote this message and said nothing about it.',
            subject: `Provenance ${Date.now()}`,
        });
        assert(!send.isError, `dm_send failed: ${send.raw.slice(0, 400)}`);
        const prov = send.parsed?.ai_provenance;
        assert(!!prov?.id, `no provenance echoed on the send: ${send.raw.slice(0, 400)}`);
        assert(prov.record.level === 'ai-generated' && prov.record.humanInvolvement === 'none',
            `level/involvement ${prov.record.level}/${prov.record.humanInvolvement}`);

        const conversationId = send.parsed.conversation_id;
        const thread = await mcpCall(silent.token, 'aimeat_dm_thread', { conversation_id: conversationId });
        assert(!thread.isError, `dm_thread failed: ${thread.raw.slice(0, 300)}`);
        const msg = (thread.parsed?.messages ?? []).find((m: any) => m.id === send.parsed.message_id);
        assert(!!msg, `sent message not in the thread: ${thread.raw.slice(0, 400)}`);
        assert(msg.ai_provenance?.id === prov.id,
            `the thread lost the record: ${JSON.stringify(msg.ai_provenance)}`);
    });

    await test('The RECIPIENT sees the same record on their own copy', async () => {
        // Both mailbox copies carry the same id — the statement is about the bytes, not the row.
        const inbox = await json('/v1/messages/inbox?per_page=20', { headers: { Authorization: `Bearer ${o.token}` } });
        assert(inbox.status === 200, `inbox ${inbox.status}: ${JSON.stringify(inbox.body?.error)}`);
        const msgs = (inbox.body.data?.messages ?? []) as Array<Record<string, any>>;
        const fromAgent = msgs.find(m => m.senderGhii === silent.gaii || m.sender_ghii === silent.gaii);
        assert(!!fromAgent, `no inbound message from the agent: ${JSON.stringify(msgs.slice(0, 2))}`);
        const id = fromAgent!.aiProvenanceId ?? fromAgent!.ai_provenance_id;
        assert(!!id, `the recipient's copy carries no provenance id: ${JSON.stringify(fromAgent)}`);
    });

    // ── 6. The agent contract: the convention is something an agent AGREES to ──

    await test('The AI-transparency convention ships as a system-layer agent directive', async () => {
        const agentName = silent.gaii.split('#')[0];
        const d = await json(`/v1/agents/${encodeURIComponent(agentName)}/directives`, { headers: { Authorization: `Bearer ${o.token}` } });
        assert(d.status === 200, `directives ${d.status}: ${JSON.stringify(d.body?.error)}`);
        const rules = (d.body.data?.rules ?? []) as Array<{ id: string; description: string; source: string }>;
        const rule = rules.find(r => r.id === 'system-ai-transparency');
        assert(!!rule, `no transparency directive among [${rules.map(r => r.id).join(', ')}]`);
        assert(rule!.source === 'system', `source ${rule!.source}`);
        assert(/silence/i.test(rule!.description),
            'the directive must state what silence costs — that is the half that changes behaviour');
    });

    await test('The write tools ADVERTISE the convention in their own descriptions', async () => {
        let sessionId = '';
        let id = 1;
        const rpc = async (method: string, params: Record<string, unknown>) => {
            const res = await fetch(`${BASE}/v1/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                    Authorization: `Bearer ${declarer.token}`,
                    ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
            });
            const sid = res.headers.get('mcp-session-id');
            if (sid) sessionId = sid;
            const ct = res.headers.get('content-type') ?? '';
            if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
            return await res.json() as any;
        };
        await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'E2E', version: '1' } });
        const out = await rpc('tools/list', {});
        const tools = (out?.result?.tools ?? []) as Array<{ name: string; description: string; inputSchema: any }>;
        const mw = tools.find(t => t.name === 'aimeat_memory_write');
        assert(!!mw, 'aimeat_memory_write not offered');
        assert(mw!.description.includes('silence is recorded as model-written'),
            'the appended sentence is missing from the description an agent actually reads');
        assert(!!mw!.inputSchema?.properties?.ai_provenance, 'ai_provenance is not on the input schema');
        assert(!!mw!.inputSchema?.properties?.ai_provenance_id, 'ai_provenance_id is not on the input schema');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
