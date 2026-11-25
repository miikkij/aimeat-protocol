/**
 * @file test/unit/declared-answer-size.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The size of one tool answer is the setting mcp.tool_answer_chars, and every tool
 *   declares it to the client. Covers the default, the value that turns the limit off, the size a
 *   tool declares (inside what Claude Code accepts) and the registration wrapper that writes it into
 *   a tool's `_meta`.
 * @version-history
 *   2026-11-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { nodeLimitsDefaults } from '../../src/config/node-limits.js';
import {
  TOOL_ANSWER_CHARS_DEFAULT, CLIENT_RESULT_CEILING_CHARS, toolAnswerBudgetChars, declaredResultChars,
} from '../../src/models/answer-budget.js';
import { RESULT_SIZE_META_KEY, withDeclaredAnswerSize } from '../../src/mcp/declared-answer-size.js';
import { NODE_LIMITS_CONFIG_FIELDS } from '../../src/services/config/schema-node-limits.js';

describe('mcp.tool_answer_chars', () => {
  it('defaults to 250 000 characters, and the environment sets another value', () => {
    expect(nodeLimitsDefaults({}).mcpToolAnswerChars).toBe(250_000);
    expect(TOOL_ANSWER_CHARS_DEFAULT).toBe(250_000);
    expect(nodeLimitsDefaults({ AIMEAT_MCP_TOOL_ANSWER_CHARS: '64000' }).mcpToolAnswerChars).toBe(64_000);
    // A value that is not a whole number of 0 or more leaves the default.
    expect(nodeLimitsDefaults({ AIMEAT_MCP_TOOL_ANSWER_CHARS: 'many' }).mcpToolAnswerChars).toBe(250_000);
    expect(nodeLimitsDefaults({ AIMEAT_MCP_TOOL_ANSWER_CHARS: '-1' }).mcpToolAnswerChars).toBe(250_000);
  });

  it('is a mutable config row that takes a whole number from 0 to 10 000 000', () => {
    const row = NODE_LIMITS_CONFIG_FIELDS.find(f => f.dotPath === 'mcp.tool_answer_chars');
    expect(row).toBeDefined();
    expect(row!.immutable).toBe(false);
    expect(row!.envVar).toBe('AIMEAT_MCP_TOOL_ANSWER_CHARS');
    for (const ok of [0, 40_000, 250_000, 10_000_000]) expect(row!.validate!(ok)).toBe(true);
    for (const bad of [-1, 1.5, 10_000_001, '250000', null]) expect(row!.validate!(bad)).toBe(false);
  });

  it('0 is no limit, and the limit in force is the setting', () => {
    expect(toolAnswerBudgetChars({ mcpToolAnswerChars: 64_000 })).toBe(64_000);
    expect(toolAnswerBudgetChars({ mcpToolAnswerChars: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('a tool declares the limit, and never more than the client accepts', () => {
    expect(declaredResultChars({ mcpToolAnswerChars: 250_000 })).toBe(250_000);
    expect(declaredResultChars({ mcpToolAnswerChars: 2_000_000 })).toBe(CLIENT_RESULT_CEILING_CHARS);
    expect(declaredResultChars({ mcpToolAnswerChars: 0 })).toBe(CLIENT_RESULT_CEILING_CHARS);
    expect(CLIENT_RESULT_CEILING_CHARS).toBe(500_000);
  });
});

describe('withDeclaredAnswerSize', () => {
  const capture = () => {
    const seen: unknown[][] = [];
    return { seen, register: (...args: unknown[]) => { seen.push(args); return 'registered'; } };
  };
  const handler = async () => ({ content: [] });

  it('writes the size into the _meta of a tool registered as (name, config, handler)', () => {
    const { seen, register } = capture();
    const wrapped = withDeclaredAnswerSize(register, () => 250_000);
    expect(wrapped('aimeat_x', { description: 'd', annotations: { readOnlyHint: true } }, handler)).toBe('registered');
    expect(seen[0][0]).toBe('aimeat_x');
    expect(seen[0][1]).toEqual({ description: 'd', annotations: { readOnlyHint: true }, _meta: { [RESULT_SIZE_META_KEY]: 250_000 } });
    expect(seen[0][2]).toBe(handler);
    expect(RESULT_SIZE_META_KEY).toBe('anthropic/maxResultSizeChars');
  });

  it('reads the size at each registration, so a server built after the setting changed declares the new value', () => {
    const { seen, register } = capture();
    let chars = 250_000;
    const wrapped = withDeclaredAnswerSize(register, () => chars);
    wrapped('a', {}, handler);
    chars = 40_000;
    wrapped('b', {}, handler);
    expect((seen[0][1] as any)._meta[RESULT_SIZE_META_KEY]).toBe(250_000);
    expect((seen[1][1] as any)._meta[RESULT_SIZE_META_KEY]).toBe(40_000);
  });

  it('keeps the _meta a tool set itself, its own size included, and does not change the config it was given', () => {
    const { seen, register } = capture();
    const wrapped = withDeclaredAnswerSize(register, () => 250_000);
    const own = { description: 'd', _meta: { ui: { resourceUri: 'ui://x' }, [RESULT_SIZE_META_KEY]: 90_000 } };
    wrapped('aimeat_y', own, handler);
    expect((seen[0][1] as any)._meta).toEqual({ ui: { resourceUri: 'ui://x' }, [RESULT_SIZE_META_KEY]: 90_000 });
    expect(Object.keys(own._meta)).toHaveLength(2);
    const plain = { description: 'd' };
    wrapped('aimeat_z', plain, handler);
    expect('_meta' in plain).toBe(false);
  });

  it('passes a call that is not the (name, config, handler) form as it came', () => {
    const { seen, register } = capture();
    const wrapped = withDeclaredAnswerSize(register, () => 250_000);
    wrapped('legacy', 'a description', handler);
    wrapped('no-handler', { description: 'd' });
    expect(seen[0]).toEqual(['legacy', 'a description', handler]);
    expect(seen[1]).toEqual(['no-handler', { description: 'd' }]);
  });
});
