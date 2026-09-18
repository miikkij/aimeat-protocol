/**
 * @file mcp-error-next-step.test.ts
 * @description An MCP tool that fails tells the agent what to do next, in the failure itself: try
 *   once more with what the message asks for, and when that does not work, tell the people who run
 *   the node. The rule existed on REST (middleware/envelope.ts appends the support hint to every
 *   error) and, for MCP, only in the tail of the server instructions that several clients cut
 *   off. These cases hold the three things the wrapper must get right: every failure carries the
 *   step, nothing that succeeded is touched, and a tool that already said it is not told twice.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-error-next-step.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial (wish-mcp-virheilmoituksiin-seuraava-askel-...).
 */
import { describe, it, expect } from 'vitest';
import { withErrorNextStep, NEXT_STEP_TEXT } from '../../src/mcp/error-next-step.js';

function registrar() {
  const registered: Record<string, (...a: unknown[]) => unknown> = {};
  const register = (...args: unknown[]) => {
    const last = args[args.length - 1];
    if (typeof last === 'function') registered[args[0] as string] = last as (...a: unknown[]) => unknown;
    return undefined;
  };
  return { registered, register };
}

describe('a failing tool says what to do next', () => {
  it('appends the step to an isError result and keeps what the tool said first', async () => {
    const { registered, register } = registrar();
    withErrorNextStep(register)('aimeat_task_get', async () => ({ content: [{ type: 'text', text: 'Task not found' }], isError: true }));

    const result = await registered.aimeat_task_get() as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Task not found');
    expect(result.content[1].text).toBe(NEXT_STEP_TEXT);
    expect(NEXT_STEP_TEXT).toContain('support@operators');
  });

  it('leaves a successful result exactly as the tool returned it', async () => {
    const { registered, register } = registrar();
    const ok = { content: [{ type: 'text', text: '{"saved":true}' }] };
    withErrorNextStep(register)('aimeat_memory_write', async () => ok);
    expect(await registered.aimeat_memory_write()).toBe(ok);
  });

  it('does not repeat itself when the tool already names the operators', async () => {
    const { registered, register } = registrar();
    withErrorNextStep(register)('aimeat_crew_try', async () => ({ content: [{ type: 'text', text: 'Refused. Ask support@operators to enable crews.' }], isError: true }));
    const result = await registered.aimeat_crew_try() as { content: unknown[] };
    expect(result.content).toHaveLength(1);
  });

  it('rethrows what a tool throws, untouched', async () => {
    const { registered, register } = registrar();
    withErrorNextStep(register)('aimeat_failing', async () => { throw new TypeError('boom'); });
    await expect(registered.aimeat_failing()).rejects.toThrow('boom');
  });

  it('registers unchanged when the last argument is not a function', () => {
    const seen: unknown[][] = [];
    withErrorNextStep((...args: unknown[]) => { seen.push(args); return undefined; })('t', { notAHandler: true });
    expect(seen).toEqual([['t', { notAHandler: true }]]);
  });
});
