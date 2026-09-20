/**
 * @file test/unit/schema-validator.test.ts
 * @description The schema-lock validator: schemas themselves, the compiled-validator cache, and the
 *   messages a failed validation hands back to whoever has to fix the record.
 * @version-history
 *   v1.1.0 — 2026-09-13 — A failed validation names the property it is about. The batch publish door
 *     answered "/ must NOT have additional properties" once per record with nothing saying which
 *     property, so a 150-record publish refused by one new field gave no way to find the field
 *     (appdev pitfall data/workspace-record-schema-is-strict).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateSchemaItself, clearValidatorCache, validateValueAgainstSchema, validateMemoryWrite,
} from '../../src/services/schema-validator.js';
import type { Storage } from '../../src/storage/interface.js';

describe('validateSchemaItself', () => {
  beforeEach(() => {
    clearValidatorCache();
  });

  it('accepts valid JSON Schema', () => {
    const result = validateSchemaItself({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    });
    expect(result).toBeNull();
  });

  it('accepts string type with constraints', () => {
    const result = validateSchemaItself({
      type: 'string',
      minLength: 1,
      maxLength: 100,
    });
    expect(result).toBeNull();
  });

  it('accepts array type', () => {
    const result = validateSchemaItself({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 50,
    });
    expect(result).toBeNull();
  });

  it('accepts number type with range', () => {
    const result = validateSchemaItself({
      type: 'number',
      minimum: 0,
      maximum: 100,
    });
    expect(result).toBeNull();
  });

  it('accepts enum type', () => {
    const result = validateSchemaItself({
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
    expect(result).toBeNull();
  });

  it('accepts nested object schema', () => {
    const result = validateSchemaItself({
      type: 'object',
      properties: {
        location: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            geo: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          required: ['city'],
        },
      },
    });
    expect(result).toBeNull();
  });

  it('accepts boolean type', () => {
    const result = validateSchemaItself({ type: 'boolean' });
    expect(result).toBeNull();
  });

  it('accepts additionalProperties: false', () => {
    const result = validateSchemaItself({
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    });
    expect(result).toBeNull();
  });
});

describe('a failed validation names what it is about', () => {
  beforeEach(() => {
    clearValidatorCache();
  });

  const strict = {
    type: 'object',
    properties: { a: {}, tila: { type: 'string', enum: ['uusi', 'asiakas'] } },
    additionalProperties: false,
  };

  it('an unwelcome property is named in the message', () => {
    const r = validateValueAgainstSchema({ a: 1, b: 2 }, strict);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain('"b"');
  });

  it('two unwelcome properties are two messages, each with its own name', () => {
    const r = validateValueAgainstSchema({ a: 1, b: 2, c: 3 }, strict);
    const joined = (r.errors ?? []).join(' | ');
    expect(joined).toContain('"b"');
    expect(joined).toContain('"c"');
  });

  it('an enum refusal lists the values it would have accepted', () => {
    const r = validateValueAgainstSchema({ tila: 'NOPE' }, strict);
    expect(r.errors?.[0]).toContain('uusi');
    expect(r.errors?.[0]).toContain('asiakas');
  });

  it('carries path, rule and params beside the message, the shape the single-write door has', () => {
    const r = validateValueAgainstSchema({ a: 1, b: 2 }, strict);
    const v = r.violations?.[0];
    expect(v?.path).toBe('/');
    expect(v?.schema_rule).toBe('additionalProperties');
    expect(v?.params).toMatchObject({ additionalProperty: 'b' });
    expect(v?.message).toContain('"b"');
  });

  it('a valid value answers ok with no messages', () => {
    const r = validateValueAgainstSchema({ a: 1, tila: 'uusi' }, strict);
    expect(r).toEqual({ ok: true });
  });

  it('the single-write door (a strict lock) names the property the same way', async () => {
    const storage = {
      findApplicableSchema: async () => ({
        keyPattern: 'organism.x.w.ws-1.crm.contacts', schemaMode: 'strict',
        schemaJson: { type: 'object', properties: { id: { type: 'string' } } },
      }),
      listAllMemory: async () => ({ items: [], total: 0 }),
    } as unknown as Storage;
    const r = await validateMemoryWrite('notes.contact.1', { id: 'c1', extra: true }, storage);
    expect(r.valid).toBe(false);
    expect(r.errors?.[0].message).toContain('"extra"');
    expect(r.errors?.[0].params).toMatchObject({ additionalProperty: 'extra' });
  });
});

describe('validateValueAgainstSchema — what a wide value costs', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };

  it('lists every violation while the value is small enough to be worth listing', () => {
    const r = validateValueAgainstSchema({ a: 1, b: 1, c: 1 }, schema);
    expect(r.ok).toBe(false);
    expect(r.violations?.length).toBe(3);
  });

  it('stops at the first violation on a value too wide to list, and says so', () => {
    // 40 000 refused fields. ajv with allErrors builds one error object per violation, and this
    // validator runs with `verbose`, so each object also carries a copy of the data it is about:
    // measured 40 001 objects for this value against the two below. The callers all pass a value
    // somebody else chose (CodeQL resource-exhaustion-from-deep-object-traversal, alert 1643).
    const wide: Record<string, unknown> = { a: 1 };
    for (let i = 0; i < 40_000; i++) wide[`k${i}`] = 'xxxxxxxxxx';

    const started = Date.now();
    const r = validateValueAgainstSchema(wide, schema);

    expect(r.ok).toBe(false);
    expect(r.violations?.length).toBe(1);
    expect(r.errors?.at(-1)).toMatch(/only the first violation is listed/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('answers a valid wide value the same as any other', () => {
    const wide: Record<string, unknown> = { a: 'x' };
    for (let i = 0; i < 40_000; i++) wide[`k${i}`] = 'xxxxxxxxxx';
    expect(validateValueAgainstSchema(wide, { type: 'object' }).ok).toBe(true);
  });

  it('refuses a value nested past the depth bound before it validates at all', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 80; i++) deep = { next: deep };
    const r = validateValueAgainstSchema(deep, { type: 'object' });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/nested too deeply/);
  });
});

describe('clearValidatorCache', () => {
  it('does not throw', () => {
    expect(() => clearValidatorCache()).not.toThrow();
  });

  it('can be called multiple times', () => {
    clearValidatorCache();
    clearValidatorCache();
    clearValidatorCache();
    // No assertion needed — just verifying no error
  });
});
