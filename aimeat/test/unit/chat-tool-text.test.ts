/**
 * @file test/unit/chat-tool-text.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat surface's short listing of its start tools (src/mcp/chat-tool-text.ts):
 *   what it cuts, and what it never cuts. v31 K63.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { listedForChat, firstSentence } from '../../src/mcp/chat-tool-text.js';

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', maxLength: 1024, description: 'Memory entry key (hierarchical, slash-separated, e.g. "a/b"). More text here.' },
    note: { type: 'string', maxLength: 40, description: 'A short note. It is optional.' },
    extra: { type: 'number', description: 'Rarely needed.' },
    prov: { type: 'object', required: ['level'], description: 'How it was made.', properties: {
      level: { type: 'string', enum: ['original', 'ai-generated'], description: 'The level.' },
      model: { type: 'string', description: 'Your model.' },
      sources: { type: 'array', items: { type: 'object', properties: { url: { type: 'string', description: 'x' } } } },
    } },
  },
};

describe('the chat listing of a start tool', () => {
  it('keeps a first sentence whole across "e.g."', () => {
    expect(firstSentence('Memory entry key (hierarchical, slash-separated, e.g. "a/b"). More text here.'))
      .toBe('Memory entry key (hierarchical, slash-separated, e.g. "a/b").');
  });

  it('cuts texts and big limits, keeps types, small limits and what is required', () => {
    const out = listedForChat(SCHEMA, { note: '' }, { prov: ['level', 'model'] }, ['extra', 'key']);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(out.$schema).toBeUndefined();
    expect(props.key).toEqual({ type: 'string', description: 'Memory entry key (hierarchical, slash-separated, e.g. "a/b").' });
    expect(props.note).toEqual({ type: 'string', maxLength: 40 });
    expect(props.extra).toBeUndefined();
    expect(Object.keys(props.prov.properties as object)).toEqual(['level', 'model']);
    expect((props.prov.properties as Record<string, Record<string, unknown>>).level).toEqual({ type: 'string', enum: ['original', 'ai-generated'] });
    expect(out.required).toEqual(['key']);
    // The input is not changed.
    expect((SCHEMA.properties.key as Record<string, unknown>).maxLength).toBe(1024);
  });
});
