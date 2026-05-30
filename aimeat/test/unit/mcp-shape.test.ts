/**
 * @file mcp-shape.test.ts
 * @description Unit tests for the shared MCP response-shaping helpers (src/mcp/catalog/shape.ts).
 *   shapeResponse() is the single piece of logic both MCP surfaces share for response_format,
 *   so it must correctly handle the server's bare-array/record payloads AND the connector's
 *   REST-wrapped payloads, and must degrade safely when field names don't match.
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 1 (F5): cover concise projection + empty-projection guard
 */
import { describe, it, expect } from 'vitest';
import { shapeResponse, descriptionFor, truncateResult, jsonContent, structuredResult } from '../../src/mcp/catalog/shape.js';

describe('shapeResponse — response_format projection', () => {
  it('returns data unchanged for detailed / undefined format', () => {
    const record = { key: 'k', value: 'v', visibility: 'private', version: 3, updated_at: 'x' };
    expect(shapeResponse('aimeat_memory_read', 'detailed', record)).toEqual(record);
    expect(shapeResponse('aimeat_memory_read', undefined, record)).toEqual(record);
  });

  it('projects a single record to conciseFields (memory_read -> key,value)', () => {
    const record = { key: 'k', value: 'v', visibility: 'private', version: 3, updated_at: 'x' };
    expect(shapeResponse('aimeat_memory_read', 'concise', record)).toEqual({ key: 'k', value: 'v' });
  });

  it('projects each element of a bare array (server list shape)', () => {
    const arr = [
      { key: 'a', owner_gaii: 'o@n', visibility: 'private', tags: ['t'], version: 1, updated_at: 'u1' },
      { key: 'b', owner_gaii: 'o@n', visibility: 'public', tags: [], version: 2, updated_at: 'u2' },
    ];
    expect(shapeResponse('aimeat_memory_list', 'concise', arr)).toEqual([
      { key: 'a', visibility: 'private', tags: ['t'], updated_at: 'u1' },
      { key: 'b', visibility: 'public', tags: [], updated_at: 'u2' },
    ]);
  });

  it('projects the nested array via concisePath and keeps the wrapper (connector REST shape)', () => {
    const wrapped = {
      items: [{ key: 'a', owner_gaii: 'o@n', visibility: 'private', tags: [], version: 1, updated_at: 'u1' }],
      total: 1,
    };
    expect(shapeResponse('aimeat_memory_list', 'concise', wrapped)).toEqual({
      items: [{ key: 'a', visibility: 'private', tags: [], updated_at: 'u1' }],
      total: 1,
    });
  });

  it('handles catalogue_search id/action_id either-name (REST uses id, server uses action_id)', () => {
    const restShape = { actions: [{ id: 'act-1', display_name: 'Foo', category: 'c', provider_gaii: 'p@n', pricing: {} }] };
    expect(shapeResponse('aimeat_catalogue_search', 'concise', restShape)).toEqual({
      actions: [{ id: 'act-1', display_name: 'Foo', category: 'c' }],
    });
  });

  it('empty-projection guard: returns the original record when no conciseFields match', () => {
    const mismatched = { totally: 'different', shape: 1 };
    expect(shapeResponse('aimeat_memory_read', 'concise', mismatched)).toEqual(mismatched);
  });

  it('is a no-op for tools that declare no conciseFields', () => {
    const balance = { balance: 100, in_escrow: 5, available: 95 };
    expect(shapeResponse('aimeat_wallet_balance', 'concise', balance)).toEqual(balance);
  });
});

describe('truncateResult — output-size backstop', () => {
  it('returns text unchanged when under the limit', () => {
    const text = '{"ok":true}';
    expect(truncateResult(text, 1000)).toBe(text);
  });

  it('wraps over-limit text in a valid-JSON truncation envelope with a preview', () => {
    const big = 'x'.repeat(500);
    const out = truncateResult(big, 100);
    const parsed = JSON.parse(out);
    expect(parsed._truncated).toBe(true);
    expect(parsed.total_chars).toBe(500);
    expect(parsed.shown_chars).toBe(100);
    expect(parsed.preview).toHaveLength(100);
    expect(parsed.hint).toMatch(/narrow/i);
  });

  it('jsonContent applies the truncation backstop', () => {
    const huge = { blob: 'y'.repeat(2000) };
    const res = jsonContent(huge, 200);
    expect(res.content[0].type).toBe('text');
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed._truncated).toBe(true);
  });

  it('jsonContent passes small payloads through untouched', () => {
    const res = jsonContent({ a: 1 });
    expect(JSON.parse(res.content[0].text)).toEqual({ a: 1 });
  });
});

describe('structuredResult — text + structuredContent (F4)', () => {
    it('wraps a bare array as { items, count } for structuredContent, keeps array in text', () => {
        const arr = [{ key: 'a' }, { key: 'b' }];
        const res = structuredResult('aimeat_work_inbox', undefined, arr);
        expect(res.structuredContent).toEqual({ items: arr, count: 2 });
        expect(JSON.parse(res.content[0].text)).toEqual(arr); // text stays a bare array (back-compat)
    });

    it('passes an object through as structuredContent', () => {
        const obj = { balance: 100, in_escrow: 5, available: 95 };
        const res = structuredResult('aimeat_wallet_balance', undefined, obj);
        expect(res.structuredContent).toEqual(obj);
        expect(JSON.parse(res.content[0].text)).toEqual(obj);
    });

    it('applies concise projection before structuring', () => {
        const record = { key: 'k', value: 'v', visibility: 'private', version: 9, updated_at: 'x' };
        const res = structuredResult('aimeat_memory_read', 'concise', record);
        expect(res.structuredContent).toEqual({ key: 'k', value: 'v' });
    });
});

describe('descriptionFor — canonical catalog descriptions', () => {
  it('returns the catalog description for a registered tool', () => {
    expect(descriptionFor('aimeat_memory_read')).toMatch(/memory entry/i);
  });

  it('throws for an unknown tool so nothing ships without catalog metadata', () => {
    expect(() => descriptionFor('aimeat_not_a_real_tool')).toThrow(/Missing tool definition/);
  });
});
