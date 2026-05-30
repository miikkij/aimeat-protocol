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
import { shapeResponse, descriptionFor } from '../../src/mcp/catalog/shape.js';

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

describe('descriptionFor — canonical catalog descriptions', () => {
  it('returns the catalog description for a registered tool', () => {
    expect(descriptionFor('aimeat_memory_read')).toMatch(/memory entry/i);
  });

  it('throws for an unknown tool so nothing ships without catalog metadata', () => {
    expect(() => descriptionFor('aimeat_not_a_real_tool')).toThrow(/Missing tool definition/);
  });
});
