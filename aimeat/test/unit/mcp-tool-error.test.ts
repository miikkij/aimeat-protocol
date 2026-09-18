/**
 * @file mcp-tool-error.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape a new MCP tool failure is written in, and that the next step still
 *   reaches it through the wrapper every tool is registered behind.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { toolError } from '../../src/mcp/tool-error.js';
import { withErrorNextStep, NEXT_STEP_TEXT } from '../../src/mcp/error-next-step.js';

describe('toolError', () => {
  it('writes CODE: message as one text block and marks the result as an error', () => {
    const out = toolError('NOT_FOUND', 'No template "x".');
    expect(out.isError).toBe(true);
    expect(out.content).toEqual([{ type: 'text', text: 'NOT_FOUND: No template "x".' }]);
  });

  it('gets the next step appended by the wrapper, once', async () => {
    let registered: ((...a: unknown[]) => Promise<{ content: { text: string }[] }>) | null = null;
    const register = (...args: unknown[]) => { registered = args[args.length - 1] as typeof registered; };
    withErrorNextStep(register as never)('a_tool', 'description', {}, async () => toolError('INVALID_INPUT', 'Part 9 does not exist.'));
    const result = await registered!();
    expect(result.content.map(c => c.text)).toEqual(['INVALID_INPUT: Part 9 does not exist.', NEXT_STEP_TEXT]);
  });
});
