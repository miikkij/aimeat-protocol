/**
 * @file scripts/prototype-mcp-v2.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Does the MCP 2026-07-28 SDK carry this node's tool surface? Run it and find out.
 *
 *   THE POINT IS A NUMBER, NOT AN OPINION. The question "what would moving to MCP v2 cost" was
 *   answered twice from reading, and both answers were wrong: the first said the SDK did not exist
 *   (it does — `@modelcontextprotocol/server` 2.0.0, published the same day as the spec), the second
 *   assumed the tool registrations would need rewriting. This registers the REAL catalogue on a real
 *   v2 server, serves it over real HTTP, and knocks on it three ways.
 *
 *   WHAT IT PROVES, in the order it prints:
 *     1. how many of this node's published tools register on a v2 server, unchanged
 *     2. whether `server/discover` — mandatory in 2026-07-28 — answers without a handshake
 *     3. whether a STATELESS request works: no `initialize`, no session id, version in `_meta`
 *     4. whether a client speaking the revision we ship today (2025-06-18) is still served
 *
 *   THE FOURTH IS THE ONE THAT DECIDES ANYTHING. Migrating is worth discussing only if the clients
 *   in the field — Claude, Cursor, the connector fleet — keep working through the same door.
 *
 *   IT REGISTERS TOOLS AND ANSWERS NOTHING REAL. Every handler returns a marker; this is a shape
 *   test, not a second node. Nothing here touches storage, identity or a credential.
 * @usage cd aimeat && pnpm exec tsx scripts/prototype-mcp-v2.ts
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, on branch mcp-v2-prototype.
 */
import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';
import type { ToolInputField } from '../src/mcp/catalog/definitions/types.js';

const PORT = 41777;

/** One catalogue field as Zod, the way the node's own registrations build them. */
function zodFor(field: ToolInputField) {
  const base = field.type === 'number' ? z.number()
    : field.type === 'boolean' ? z.boolean()
      : field.type === 'array' ? z.array(z.string())
        : field.type === 'object' ? z.record(z.string(), z.unknown())
          : z.string();
  const described = base.describe(field.description);
  return field.required ? described : described.optional();
}

/** The public tool surface, registered on a v2 server exactly as the node registers it on v1. */
function buildServer(): { server: McpServer; registered: number; failed: Array<[string, string]> } {
  const server = new McpServer(
    { name: 'AIMEAT v2 prototype', version: '0.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  let registered = 0;
  const failed: Array<[string, string]> = [];
  for (const def of CLI_FALLBACK_TOOL_DEFINITIONS) {
    if (!def.visibility.publicMcp) continue;
    const shape: Record<string, ReturnType<typeof zodFor>> = {};
    for (const [name, field] of Object.entries(def.input)) shape[name] = zodFor(field);
    try {
      // THE SAME CALL THE NODE ALREADY MAKES. v2 keeps `registerTool(name, config, cb)` and still
      // accepts a raw Zod shape for `inputSchema`, so if this loop is quiet the 306 registrations
      // in src/mcp/ are not the migration's problem.
      server.registerTool(
        def.name,
        { description: def.description, inputSchema: shape },
        async () => ({ content: [{ type: 'text' as const, text: 'prototype' }] }),
      );
      registered++;
    } catch (err) {
      failed.push([def.name, String(err)]);
    }
  }
  return { server, registered, failed };
}

/** POST one JSON-RPC body and give back the status and the parsed answer. */
async function rpc(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // A v2 answer arrives as SSE whenever the client says it accepts one, so the body is
  // `event: message\ndata: {...}` and not bare JSON. Reading it as JSON is what made the first run
  // report three empty 200s and look like the SDK refusing — the probe was wrong, not the server.
  // By CONTENT-TYPE, never by looking for "data:" in the text. The first version searched the body,
  // and a tool DESCRIPTION containing those five characters made it shred a perfectly good JSON
  // answer into nothing — a probe reporting "0 tools" about a server that had just listed 306.
  const data = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
    : text;
  let parsed: any = null;
  try { parsed = JSON.parse(data); } catch { parsed = { _raw: text.slice(0, 300) }; }
  return { status: res.status, body: parsed };
}

function say(ok: boolean, label: string, detail: string): void {
  console.log(`  ${ok ? 'YES' : 'NO '}  ${label.padEnd(52)} ${detail}`);
}

async function main(): Promise<void> {
  const { registered, failed } = buildServer();

  const handler = createMcpHandler(() => buildServer().server);
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const answer = await handler.fetch(request);
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    res.end(answer.body ? Buffer.from(await answer.arrayBuffer()) : undefined);
  });
  await new Promise<void>(r => http.listen(PORT, '127.0.0.1', r));

  console.log('\nMCP v2 (2026-07-28 SDK) against this node\'s real tool catalogue\n');
  say(failed.length === 0, 'the published tools register unchanged',
    `${registered} registered, ${failed.length} refused`);
  for (const [name, err] of failed.slice(0, 5)) console.log(`        ${name}: ${err.slice(0, 120)}`);

  // The SAME modern envelope every 2026-07-28 request carries. Asked bare, this answered "Method
  // not found" and looked like the SDK not implementing a mandatory RPC; it implements it and was
  // refusing the shape.
  const modern = {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 'aimeat-probe', version: '0.0.0' },
    },
  };
  const discover = await rpc(
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: modern },
    { 'Mcp-Method': 'server/discover' },
  );
  say(discover.status === 200 && !!discover.body?.result,
    'server/discover answers with no handshake',
    `${discover.status} serves ${JSON.stringify(discover.body?.result?.supportedVersions ?? discover.body?.error?.message ?? '')}`);

  // `_meta` rides INSIDE `params`, not beside it. The first run put it at the top level and got
  // "the request body is not a valid JSON-RPC message", which reads exactly like the SDK refusing
  // the stateless model and was the probe being wrong.
  const stateless = await rpc({
    jsonrpc: '2.0', id: 2, method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        // REQUIRED ON EVERY REQUEST in the stateless model, because there is no handshake left to
        // have said it once. The SDK names the missing key rather than answering a bare 400, which
        // is how this probe found its own second mistake in one run.
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'aimeat-probe', version: '0.0.0' },
      },
    },
    // `Mcp-Method` is new in 2026-07-28 and REQUIRED on a Streamable HTTP POST: the method has to be
    // readable by a proxy that will not parse the body. A node behind nginx gains a routing and
    // rate-limiting handle from it, which is worth knowing before the migration rather than after.
  }, { 'Mcp-Method': 'tools/list' });
  const listed = stateless.body?.result?.tools?.length ?? 0;
  say(stateless.status === 200 && listed > 0,
    'tools/list works stateless, no initialize, no session',
    `${stateless.status}, ${listed} tools`);

  const legacyInit = await rpc({
    jsonrpc: '2.0', id: 3, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
  });
  say(legacyInit.status === 200 && !!legacyInit.body?.result,
    'a client on the revision we ship today is still served',
    `${legacyInit.status} ${legacyInit.body?.result?.protocolVersion ?? legacyInit.body?.error?.message ?? ''}`);

  console.log('\n--- raw answers ---');
  console.log('discover  :', JSON.stringify(discover.body).slice(0, 300));
  console.log('stateless :', JSON.stringify(stateless.body).slice(0, 300));
  console.log('legacy    :', JSON.stringify(legacyInit.body).slice(0, 300));
  http.close();
}

main().catch(err => { console.error(err); process.exit(1); });
