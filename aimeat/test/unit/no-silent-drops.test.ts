/**
 * @file test/unit/no-silent-drops.test.ts
 * @description Three places where part of a request used to vanish without a word, and now the
 *   answer names it (pitfall analysis 2026-11-21, registry cluster "silent drops"):
 *   - a task create body's fields the task schema does not take (`tags`): ignoredCreateFields;
 *   - a workspace create's schemaRef with no schema under `schemas`, which locks nothing:
 *     ignoredProvisionFields;
 *   - a strict lock over a schema that says additionalProperties: true refuses an extra field, and
 *     the refusal now says the strict lock closed it (explainStrictClose, on the write path).
 *   Real in-memory SQLite for the lock. Seen red first: none of the three functions existed, and the
 *   refusal's message had no word about the lock.
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-silent-drops.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { validateMemoryWrite, explainStrictClose } from '../../src/services/schema-validator.js';
import { ignoredCreateFields } from '../../src/services/agent/task-write.js';
import { ignoredProvisionFields } from '../../src/services/workspace/provision.js';

describe('a task create names the fields it does not take', () => {
  it('names tags and a misspelt field, and nothing the schema reads', () => {
    expect(ignoredCreateFields({ title: 'T', description: 'd', tags: ['x'], titel: 'typo', start: 'confirm' }))
      .toEqual(['tags', 'titel']);
  });
  it('names nothing for a body of known fields, an empty body or a non-object', () => {
    expect(ignoredCreateFields({ title: 'T', rules: [], idempotency_key: 'k' })).toEqual([]);
    expect(ignoredCreateFields({})).toEqual([]);
    expect(ignoredCreateFields(null)).toEqual([]);
    expect(ignoredCreateFields(['tags'])).toEqual([]);
  });
});

describe('a workspace create names what locks nothing', () => {
  const records = (ns: string, extra: Record<string, unknown> = {}) => ({ name: ns, namespace: ns, mode: 'records', backing: 'memory', ...extra });

  it('names a records space whose schemaRef has no schema under `schemas`', () => {
    const out = ignoredProvisionFields([records('deals', { schemaRef: 'schema:deal@1' })], {});
    expect(out.map(o => o.field)).toEqual(['manifest.objectTypes[0].schemaRef']);
    expect(out[0].reason).toContain('deals');
  });

  it('names nothing when the schema is given, for a document space, or when no schemaRef was written', () => {
    expect(ignoredProvisionFields([records('deals', { schemaRef: 'schema:deal@1' })], { deals: { type: 'object' } })).toEqual([]);
    expect(ignoredProvisionFields([{ name: 'notes', namespace: 'notes', mode: 'document', schemaRef: 'x' }], {})).toEqual([]);
    expect(ignoredProvisionFields([records('deals')], {})).toEqual([]);
  });

  it('names a `schemas` entry that is not an object', () => {
    expect(ignoredProvisionFields([records('deals')], { deals: 'schema:deal@1' }).map(o => o.field)).toEqual(['schemas.deals']);
  });
});

describe('a strict lock over an open schema says it closed the field', () => {
  let storage: Storage;
  const now = '2026-11-21T10:00:00.000Z';
  const lock = (keyPattern: string, schemaJson: Record<string, unknown>, schemaMode: 'strict' | 'open') =>
    storage.setSchema({ keyPattern, applyTo: 'prefix', schemaJson, schemaMode, lockedBy: 'alice@node-test', setAt: now, updatedAt: now });
  beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

  it('refuses the extra field and the message names the strict lock', async () => {
    await lock('organism.o.w.ws-a.deals', { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true }, 'strict');
    const r = await validateMemoryWrite('organism.o.w.ws-a.deals.d1', { id: 'd1', colour: 'red' }, storage);
    expect(r.valid).toBe(false);
    expect(r.errors?.[0].message).toContain('"colour"');
    expect(r.errors?.[0].message).toContain('strict');
  });

  it('keeps the plain message when the schema itself does not say additionalProperties: true', async () => {
    await lock('organism.o.w.ws-b.deals', { type: 'object', properties: { id: { type: 'string' } } }, 'strict');
    const r = await validateMemoryWrite('organism.o.w.ws-b.deals.d1', { id: 'd1', colour: 'red' }, storage);
    expect(r.valid).toBe(false);
    expect(r.errors?.[0].message).not.toContain('strict');
  });

  it('admits the field under an open lock, and leaves other violations as they are', async () => {
    await lock('organism.o.w.ws-c.deals', { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true }, 'open');
    expect((await validateMemoryWrite('organism.o.w.ws-c.deals.d1', { id: 'd1', colour: 'red' }, storage)).valid).toBe(true);
    const typeErr = [{ path: '/id', message: 'must be string', schema_rule: 'type' }];
    expect(explainStrictClose(typeErr, { schemaJson: { type: 'object', additionalProperties: true }, schemaMode: 'strict' })).toEqual(typeErr);
  });
});
