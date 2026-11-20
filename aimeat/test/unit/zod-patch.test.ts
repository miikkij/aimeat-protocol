/**
 * @file zod-patch.test.ts
 * @description patchOf(): a partial-update schema keeps no default, so a field the caller left out
 *   stays out of the parsed update instead of coming back as its default (docs/pitfalls.md §127, now
 *   the gate check:partial-defaults).
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { patchOf } from '../../src/utils/zod-patch.js';

const Record = z.object({
  name: z.string(),
  pep: z.enum(['no', 'yes', 'unknown']).default('unknown'),
  officers: z.array(z.string()).default([]),
  identity: z.object({ level: z.string() }).nullable().default(null),
  later: z.string().default('x').optional(),
  prefilled: z.object({ low: z.number().default(60) }).prefault({}),
  months: z.object({ low: z.number(), high: z.number() }).default({ low: 60, high: 12 }),
}).strict();

describe('patchOf', () => {
  it('leaves out every field the caller did not send, defaulted or not', () => {
    const out = patchOf(Record).parse({ name: 'carol' });
    expect(out).toEqual({ name: 'carol' });
  });

  it('keeps a field the caller did send, with its own value', () => {
    expect(patchOf(Record).parse({ pep: 'yes', identity: null, officers: ['alice'] }))
      .toEqual({ pep: 'yes', identity: null, officers: ['alice'] });
  });

  it('still validates what was sent', () => {
    expect(patchOf(Record).safeParse({ pep: 'maybe' }).success).toBe(false);
    expect(patchOf(Record).safeParse({ identity: 'high' }).success).toBe(false);
  });

  it('keeps the object mode of the schema it was given', () => {
    expect(patchOf(Record).safeParse({ other: 1 }).success).toBe(false);
    expect(patchOf(Record.passthrough()).parse({ other: 1 })).toEqual({ other: 1 });
  });

  it('is .partial() for a schema with no defaults', () => {
    const Plain = z.object({ a: z.string(), b: z.number().optional() }).strict();
    expect(patchOf(Plain).parse({})).toEqual(Plain.partial().parse({}));
    expect(patchOf(Plain).parse({ a: 'x' })).toEqual({ a: 'x' });
  });
});
