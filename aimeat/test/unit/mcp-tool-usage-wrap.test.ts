/**
 * @file mcp-tool-usage-wrap.test.ts
 * @description The MCP measurement wrapper. It sits between every tool registration and its
 *   handler, so the three things it must never do are the three things tested here: change what a
 *   tool returns, swallow what a tool throws, or miss a call.
 *
 *   It also has to survive `mcp.tool`'s five overloads, which is why it matches on "last argument
 *   that is a function" rather than on arity. The overload test is the one that would go red the
 *   first time the SDK adds a signature.
 *
 *   Design: docs/internal/telemetria/02-design.md
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-tool-usage-wrap.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { wrapToolHandler } from '../../src/mcp/tool-usage-wrap.js';
import { resetUsageBuffer, pendingUsageCalls } from '../../src/services/usage/usage-buffer.js';

const PRINCIPAL = 'claude#alice@node-1';

/** Stand-in registrar: keeps whatever handler it was given so a test can call it. */
function registrar() {
  const registered: Record<string, (...a: unknown[]) => unknown> = {};
  const register = (...args: unknown[]) => {
    const name = args[0] as string;
    const last = args[args.length - 1];
    if (typeof last === 'function') registered[name] = last as (...a: unknown[]) => unknown;
    return undefined;
  };
  return { registered, register };
}

beforeEach(() => resetUsageBuffer());

describe('the wrapper does not change what a tool does', () => {
  it('passes the arguments through and returns the handler result unchanged', async () => {
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    wrapped('aimeat_memory_write', async (args: unknown) => ({ echoed: args }));

    const result = await registered.aimeat_memory_write({ key: 'k' });
    expect(result).toEqual({ echoed: { key: 'k' } });
  });

  it('rethrows a handler error untouched', async () => {
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    wrapped('aimeat_failing', async () => { throw new TypeError('boom'); });

    // Swallowing here would turn a failing tool into a silently failing one, which is the opposite
    // of what measuring it is for.
    await expect(registered.aimeat_failing()).rejects.toThrow('boom');
  });
});

describe('the wrapper records', () => {
  it('one call, with the tool name, the principal and a duration', async () => {
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    wrapped('aimeat_memory_write', async () => ({ ok: true }));

    await registered.aimeat_memory_write({});

    const recorded = pendingUsageCalls({ surface: 'mcp' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].coordinate).toBe('aimeat_memory_write');
    expect(recorded[0].actorGaii).toBe(PRINCIPAL);
    expect(recorded[0].actorKind).toBe('agent');
    expect(recorded[0].ownerGhii).toBe('alice@node-1');
    expect(recorded[0].outcome).toBe('ok');
    expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('a thrown error as an error, not as a success', async () => {
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    wrapped('aimeat_failing', async () => { throw new TypeError('boom'); });

    await expect(registered.aimeat_failing()).rejects.toThrow();

    const [row] = pendingUsageCalls({ surface: 'mcp' });
    expect(row.outcome).toBe('error');
    expect(row.reason).toBe('TypeError');
  });

  it('an isError result as an error, even though nothing was thrown', async () => {
    // The MCP way of failing without throwing. Counting it as a success would make the tools that
    // fail most often look like the healthiest ones on a chart.
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    wrapped('aimeat_soft_fail', async () => ({ content: [], isError: true }));

    await registered.aimeat_soft_fail();

    const [row] = pendingUsageCalls({ surface: 'mcp' });
    expect(row.outcome).toBe('error');
    expect(row.reason).toBe('tool_error_result');
  });

  it('reads the principal at CALL time, not at registration time', async () => {
    // Registration happens once per session; the identity closure is what the session binds. A
    // wrapper that captured the value would attribute every later call to whoever registered first.
    let principal = 'alice@node-1';
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => principal);
    wrapped('aimeat_x', async () => ({}));

    principal = 'eco:drum#bob@node-1';
    await registered.aimeat_x();

    const [row] = pendingUsageCalls({ surface: 'mcp' });
    expect(row.actorGaii).toBe('eco:drum#bob@node-1');
    expect(row.actorKind).toBe('eco');
  });
});

describe('overload tolerance', () => {
  it('wraps the handler in every mcp.tool shape, because it is always the last argument', async () => {
    const shapes: unknown[][] = [
      ['t1', async () => ({ shape: 1 })],
      ['t2', 'a description', async () => ({ shape: 2 })],
      ['t3', { schema: true }, async () => ({ shape: 3 })],
      ['t4', 'desc', { schema: true }, async () => ({ shape: 4 })],
      ['t5', 'desc', { schema: true }, { annotations: true }, async () => ({ shape: 5 })],
    ];
    const { registered, register } = registrar();
    const wrapped = wrapToolHandler(register, () => PRINCIPAL);
    for (const args of shapes) wrapped(...args);

    for (const name of ['t1', 't2', 't3', 't4', 't5']) await registered[name]();

    const recorded = pendingUsageCalls({ surface: 'mcp' });
    expect(recorded.map(r => r.coordinate).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('registers unchanged when the last argument is not a function', () => {
    // Nothing to measure, and nothing to break: the registrar sees exactly what it was given.
    const seen: unknown[][] = [];
    const wrapped = wrapToolHandler((...args: unknown[]) => { seen.push(args); return undefined; }, () => PRINCIPAL);
    wrapped('t', { notAHandler: true });
    expect(seen).toEqual([['t', { notAHandler: true }]]);
    expect(pendingUsageCalls({ surface: 'mcp' })).toHaveLength(0);
  });
});
