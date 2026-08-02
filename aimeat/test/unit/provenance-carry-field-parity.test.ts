/**
 * @file provenance-carry-field-parity.test.ts
 * @description Guards the connector's DECLARE path against the failure that has now cost four
 *   rounds: a provenance field exists in the schema, is accepted and typed, and is then silently
 *   dropped on the way to the node. No error, no log — the write succeeds and the field is simply
 *   not in the record.
 *
 *   The reason it keeps recurring is a two-surface split. `src/mcp/ai-provenance-input.ts` is the
 *   NODE's own MCP surface; `src/cli/connect/ai-provenance-carry.ts` is what BOTH the shell
 *   `aimeat connect call` path and the connector's MCP tools go through — and crews reach the node
 *   only through `aimeat connect serve`. Adding a field to the first changes nothing a crew can
 *   observe. `provider` was added to the first and not the second.
 *
 *   So this test derives its expectations FROM the schema rather than restating them: every field
 *   AiProvenanceBlockSchema accepts must reach the declare body. A new field forgotten in the
 *   mapping fails here instead of going quiet in production.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial: schema→body parity + the model/provider generator merge.
 */
import { describe, it, expect } from 'vitest';
import { toDeclareBody } from '../../src/cli/connect/ai-provenance-carry.js';
import { AiProvenanceBlockSchema, type AiProvenanceToolInput } from '../../src/mcp/ai-provenance-input.js';

/**
 * Where each accepted input field must land in the declare body. Renames and nestings are spelled
 * out so the test asserts the real contract rather than a shape-shaped guess.
 */
const FIELD_DESTINATIONS: Record<string, (body: Record<string, unknown>) => unknown> = {
  level: (b) => b.level,
  method: (b) => b.method,
  human_involvement: (b) => b.humanInvolvement,
  model: (b) => (b.generator as Record<string, unknown> | undefined)?.model,
  provider: (b) => (b.generator as Record<string, unknown> | undefined)?.provider,
  sources: (b) => b.sources,
  notes: (b) => b.notes,
};

/** A declaration exercising every field the schema accepts. */
const FULL_INPUT: AiProvenanceToolInput = AiProvenanceBlockSchema.parse({
  level: 'ai-generated',
  method: 'synthesized',
  human_involvement: 'light-review',
  model: 'nvidia/nemotron-nano-12b-v2-vl',
  provider: 'openrouter',
  sources: [{ url: 'https://example.org/a', title: 'A', role: 'quoted' }],
  notes: 'carried through the connector',
});

describe('every schema field reaches the declare body', () => {
  it('has a documented destination for each field the schema accepts', () => {
    // If this fails, a field was added to the schema without deciding where it lands. Add it to
    // FIELD_DESTINATIONS and to toDeclareBody — the whole point is that omission is loud.
    const schemaFields = Object.keys(AiProvenanceBlockSchema.shape).sort();
    expect(schemaFields).toEqual(Object.keys(FIELD_DESTINATIONS).sort());
  });

  it('carries every field through to the body', () => {
    const body = toDeclareBody(FULL_INPUT, 'the content');
    for (const [field, read] of Object.entries(FIELD_DESTINATIONS)) {
      expect(read(body), `${field} was dropped on the way to POST /v1/provenance`).toBeDefined();
    }
  });
});

describe('generator merges model and provider', () => {
  it('carries both — neither overwrites the other', () => {
    const generator = toDeclareBody(FULL_INPUT, 'c').generator as Record<string, unknown>;
    expect(generator).toEqual({ model: 'nvidia/nemotron-nano-12b-v2-vl', provider: 'openrouter' });
  });

  it('emits generator for provider alone — the node requires no field inside it', () => {
    const input = AiProvenanceBlockSchema.parse({ level: 'ai-generated', provider: 'openrouter' });
    expect(toDeclareBody(input, 'c').generator).toEqual({ provider: 'openrouter' });
  });

  it('emits generator for model alone', () => {
    const input = AiProvenanceBlockSchema.parse({ level: 'ai-generated', model: 'anthropic/claude-opus-5' });
    expect(toDeclareBody(input, 'c').generator).toEqual({ model: 'anthropic/claude-opus-5' });
  });

  it('omits generator entirely when neither is declared', () => {
    const input = AiProvenanceBlockSchema.parse({ level: 'original' });
    expect(toDeclareBody(input, 'c')).not.toHaveProperty('generator');
  });
});

describe('the error naming valid fields stays truthful', () => {
  it('names every schema field, so a caller is not told a real field does not exist', async () => {
    const { parseDeclarationInput, ProvenanceCarryError } = await import('../../src/cli/connect/ai-provenance-carry.js');
    let message = '';
    try { parseDeclarationInput('not an object'); }
    catch (err) { expect(err).toBeInstanceOf(ProvenanceCarryError); message = (err as Error).message; }
    for (const field of Object.keys(AiProvenanceBlockSchema.shape)) {
      expect(message, `the "valid fields" message omits ${field}`).toContain(field);
    }
  });
});
