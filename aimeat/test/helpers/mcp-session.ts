/**
 * @file mcp-session.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a suite makes an owner's agent with exactly the scopes it names, opens a session
 *   on the node MCP endpoint (/v1/mcp) with that agent's token, and calls one tool. The fixture the
 *   MCP coverage suites of the QA audit (W27) share, so each of them is the assertions and nothing
 *   else.
 *
 *   WHY AN AGENT AND NOT THE OWNER. An agent is the caller these tools are written for, and the
 *   scopes it holds decide both which tools the session is offered (the registration filter in
 *   src/mcp/index.ts) and what the handler refuses at call time. A refusal test that drives the tool
 *   with an owner's own session tests neither.
 *
 *   WHAT callTool ANSWERS. `offered: false` when the session was not offered the tool at all (the
 *   SDK answers a JSON-RPC error or an isError result naming an unknown tool); `isError` is true
 *   for every refusal, whichever of the two shapes carried it. A refusal test asserts `isError`, and
 *   when it matters which layer refused, `offered`.
 * @structure makeAgent · openSession · mcpRpc · callTool · toolNames · toolJson · McpSession · McpAgent
 * @usage
 *   import { registerOwner } from './owner-login.js';
 *   import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
 *   const alice = await registerOwner(BASE, `alice${Date.now()}`);
 *   const agent = await makeAgent(BASE, alice, ['memory:read']);
 *   const s = await openSession(BASE, agent.token);
 *   const r = await callTool(s, 'aimeat_memory_list', {});      // { isError, offered, data, text }
 * @version-history
 *   2026-10-17 — `offered: false` from SCOPE_DENIED reads the absence of the allow address
 *     (/v1/allow?): the old closing sentence "so the tool is offered" is gone, and a tool missing only
 *     one-press words is listed and answers SCOPE_DENIED with that address (permission ask).
 *   2026-10-16 — `offered: false` also from the SCOPE_DENIED answer a filtered-out tool now gives
 *     instead of "Tool X not found" (QA audit E5-04, merged beside W27).
 *   v1.0.1 — 2026-10-16 — callTool reads `offered: false` only from the SDK's sentence about the tool
 *     name; a handler refusal whose text says "not found" counted as not offered (QA audit W27).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27, F06a-01 and siblings).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};

/** An owner as registerOwner returns it; only the two fields this file reads. */
export interface OwnerLike { name: string; token: string }

/** An agent made by makeAgent, signed in with its own key. */
export interface McpAgent {
    name: string;
    gaii: string;
    token: string;
    privateKey: string;
    scopes: string[];
}

/** One session on /v1/mcp: the bearer token and the session id the initialize answer set. */
export interface McpSession { base: string; token: string; sessionId?: string; label: string }

async function postJson(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        });
        if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
        return { status: res.status, body: parsed };
    }
}

/**
 * Register an agent of `owner` holding exactly `scopes` (POST /v1/agents), then sign it in with its
 * own key (POST /v1/auth/token, gaii + timestamp signed). Throws with the status and the refusal when
 * either step fails, so a fixture problem never reads as an assertion about the tool.
 */
export async function makeAgent(base: string, owner: OwnerLike, scopes: string[], name?: string): Promise<McpAgent> {
    const agentName = name ?? `a${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`;
    const reg = await postJson(base, '/v1/agents', { name: agentName, owner: owner.name, scopes }, owner.token);
    if (reg.status !== 201) throw new Error(`agent ${agentName}: ${reg.status} ${JSON.stringify(reg.body?.error ?? reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privateKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(privateKey, 'base64'));
    const tok = await postJson(base, '/v1/auth/token', { gaii, timestamp, signature: Buffer.from(sig).toString('base64') });
    if (tok.status !== 200) throw new Error(`agent token ${agentName}: ${tok.status} ${JSON.stringify(tok.body?.error ?? tok.body)}`);
    return { name: agentName, gaii, token: tok.body.data.token as string, privateKey, scopes };
}

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;

/** One JSON-RPC request on the session. Answers the JSON-RPC message whose id matches. */
export async function mcpRpc(session: McpSession, method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${session.base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { _status: res.status, _raw: text }; }
}

/** Open a session with `token` (an agent's or an owner's) and send `initialize`. Throws when no session id comes back. */
export async function openSession(base: string, token: string, label = 'e2e-mcp'): Promise<McpSession> {
    const session: McpSession = { base, token, label };
    const init = await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: label, version: '1.0.0' },
    });
    if (!session.sessionId) throw new Error(`initialize gave no session id: ${JSON.stringify(init).slice(0, 300)}`);
    return session;
}

/** The text an MCP tool returns, parsed as JSON when it is JSON. */
export function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

/** Every tool name the session is offered, following the cursor. */
export async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** What one tools/call answered. */
export interface ToolAnswer {
    /** The call was refused, as an isError result or as a JSON-RPC error. */
    isError: boolean;
    /** False when the session was not offered the tool at all. */
    offered: boolean;
    /** The tool's text parsed as JSON, or `{ _text }`. */
    data: any;
    /** The tool's text, or the JSON-RPC error serialised. */
    text: string;
}

/** Call one tool and return the answer and whether it was refused. */
export async function callTool(session: McpSession, name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    const isError = body?.result?.isError === true || body?.error !== undefined;
    // Only the SDK's own sentence about the tool NAME: a handler's "NOT_FOUND: Contact not found" is a
    // refusal by an offered tool, and a looser pattern read it as "not offered". A tool the session's
    // permissions filtered out answers SCOPE_DENIED (src/mcp/scope-denied-answer.ts, QA audit E5-04).
    // Since 2026-10-17 (permission ask) an agent's tool whose missing words are all one-press stays on
    // the list, and its SCOPE_DENIED carries the allow address (/v1/allow?); a filtered-out tool's
    // SCOPE_DENIED hands the agent's page instead. So SCOPE_DENIED without /v1/allow? is "not offered".
    const notOffered = isError && (/Tool [\w.-]+ (?:not found|disabled)|unknown tool/i.test(text)
        || (/^SCOPE_DENIED: /.test(text) && !text.includes('/v1/allow?')));
    return { isError, offered: !notOffered, data: toolJson(body), text };
}
