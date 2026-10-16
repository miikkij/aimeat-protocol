/**
 * @file test/unit/mcp-tool-fault.test.ts
 * @description A node MCP tool that fails inside the node: the log line, the operator's fault report
 *   and the answer the AI reads, through the same registration chain mcp/index.ts uses
 *   (mcp/tool-registrar.ts). A tool that throws is logged with its stack, reported, and answered
 *   INTERNAL_ERROR with the request id and no exception text; a typed refusal keeps its text; a
 *   caught internal error a tool returns is handled as a throw; a caught error with authored text
 *   keeps it. And a call to a tool the session's permissions filter out answers SCOPE_DENIED with
 *   the word it needs, not "not found" (QA audit E1-01, D2-01, F5-02, E2-02, E5-01, E5-04).
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-tool-fault.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit E1-01, D2-01, F5-02, E2-02, E5-01, E5-04).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import winston from 'winston';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const reports: Array<Record<string, unknown>> = [];
vi.mock('../../src/services/system-fault-report.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/system-fault-report.js')>();
  return { ...real, reportSystemFault: vi.fn(async (_deps: unknown, input: Record<string, unknown>) => { reports.push(input); }) };
});

const { logger } = await import('../../src/utils/logger.js');
const { toolRegistrar } = await import('../../src/mcp/tool-registrar.js');
const { withCaughtError } = await import('../../src/mcp/tool-fault.js');
const { answerScopeDeniedTools } = await import('../../src/mcp/scope-denied-answer.js');
const { enforcedScopesForTool } = await import('../../src/tool-catalog/scopes.js');
const { scopeIsCovered } = await import('../../src/utils/scope-coverage.js');

const lines: Array<Record<string, unknown>> = [];
const sink = new PassThrough();
sink.on('data', (chunk: Buffer) => {
  for (const l of chunk.toString('utf8').split('\n')) if (l) lines.push(JSON.parse(l) as Record<string, unknown>);
});
const transport = new winston.transports.Stream({ stream: sink, format: winston.format.json() });

/** The level without the colour codes the development format adds. */
const COLOUR_CODE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const levelOf = (l: Record<string, unknown>) => String(l.level).replace(COLOUR_CODE, '');

const CANARY = 'CANARY relation "secret_table" does not exist';
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

let client: Client;
let levelBefore = 'info';
let mcp: McpServer;

beforeAll(async () => {
  // The lines asserted here are warn and error; a run with a quieter AIMEAT_LOG_LEVEL must not hide them.
  levelBefore = logger.level;
  logger.level = 'info';
  logger.add(transport);
  mcp = new McpServer({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
  const deps = {
    scopes: () => ['memory:read'],
    principal: () => 'probebot#owner@probe-node',
    storage: {} as Storage,
    config: { nodeId: 'probe-node' } as unknown as AimeatConfig,
  };
  const register = toolRegistrar(mcp.tool.bind(mcp) as (...a: unknown[]) => unknown, deps);
  register('probe_throws', 'throws', {}, async () => { throw new Error(CANARY); });
  register('probe_refuses', 'refuses', {}, async () => {
    throw Object.assign(new Error('No record by that name.'), { code: 'NOT_FOUND', status: 404 });
  });
  register('probe_caught_internal', 'caught', {}, async () => {
    try { (undefined as unknown as { x: () => void }).x(); return fail('unreachable'); }
    catch (err) { return withCaughtError(fail(`Failed to probe: ${(err as Error).message}`), err); }
  });
  register('probe_caught_authored', 'caught', {}, async () => {
    const err = new Error('That name is already taken. Pick another.');
    return withCaughtError(fail(`Failed to publish app: ${err.message}`), err);
  });
  // The permission answer: aimeat_memory_write needs memory:write, which this session lacks, so it
  // is not registered (mcp/index.ts gate) and a call by name reaches the wrapped tools/call handler.
  answerScopeDeniedTools(mcp, {
    missingWords: (name) => enforcedScopesForTool(name).filter((w) => !scopeIsCovered(deps.scopes(), w)),
    principal: deps.principal,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'probe', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  logger.remove(transport);
  logger.level = levelBefore;
  await client?.close();
  await mcp?.close();
});

async function call(name: string): Promise<{ isError?: boolean; text: string }> {
  const r = await client.callTool({ name, arguments: {} }) as { isError?: boolean; content: Array<{ text?: string }> };
  return { isError: r.isError, text: r.content.map((c) => c.text ?? '').join('\n') };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('a tool that throws inside the node', () => {
  it('answers INTERNAL_ERROR with a request id and a next step, without the exception text', async () => {
    lines.length = 0; reports.length = 0;
    const r = await call('probe_throws');
    expect(r.isError).toBe(true);
    expect(r.text.startsWith('INTERNAL_ERROR: ')).toBe(true);
    expect(r.text).not.toContain('secret_table');
    expect(r.text).toMatch(/request id req-/);
    expect(r.text).toContain('support@operators');
  });

  it('writes one error line with the tool, the caller, the message and the stack', async () => {
    await tick();
    const line = lines.find((l) => levelOf(l) === 'error' && String(l.message).includes('probe_throws'));
    expect(line).toBeDefined();
    expect(line!.tool).toBe('probe_throws');
    expect(line!.principal).toBe('probebot#owner@probe-node');
    expect(line!.error).toBe(CANARY);
    expect(String(line!.stack)).toContain('mcp-tool-fault.test.ts');
    expect(String(line!.request_id)).toMatch(/^req-/);
  });

  it('sends the operator a fault report naming the tool', () => {
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ code: 'INTERNAL_ERROR', route: 'probe_throws', method: 'MCP' });
    expect(String(reports[0].shown)).not.toContain('secret_table');
  });
});

describe('what is not a fault', () => {
  it('a typed refusal keeps its code and text and is not reported', async () => {
    reports.length = 0;
    const r = await call('probe_refuses');
    expect(r.text.startsWith('NOT_FOUND: No record by that name.')).toBe(true);
    expect(reports).toHaveLength(0);
  });

  it('a caught internal error a tool returns is handled as a fault', async () => {
    reports.length = 0; lines.length = 0;
    const r = await call('probe_caught_internal');
    expect(r.text.startsWith('INTERNAL_ERROR: ')).toBe(true);
    expect(r.text).not.toContain('Cannot read');
    expect(reports).toHaveLength(1);
    await tick();
    expect(lines.some((l) => levelOf(l) === 'error' && l.tool === 'probe_caught_internal')).toBe(true);
  });

  it('a caught error with authored text keeps the text, leaves a warn line and no report', async () => {
    reports.length = 0; lines.length = 0;
    const r = await call('probe_caught_authored');
    expect(r.text.startsWith('Failed to publish app: That name is already taken.')).toBe(true);
    expect(reports).toHaveLength(0);
    await tick();
    expect(lines.some((l) => levelOf(l) === 'warn' && l.tool === 'probe_caught_authored')).toBe(true);
  });
});

describe('a tool the session may not use', () => {
  it('answers SCOPE_DENIED with the permission it needs, not "not found"', async () => {
    const r = await call('aimeat_memory_write');
    expect(r.isError).toBe(true);
    expect(r.text.startsWith('SCOPE_DENIED: ')).toBe(true);
    expect(r.text).toContain('"memory:write"');
    expect(r.text).not.toMatch(/not found/i);
  });

  it('a tool that does not exist still answers not found', async () => {
    const r = await call('aimeat_no_such_tool');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not found/i);
  });
});
