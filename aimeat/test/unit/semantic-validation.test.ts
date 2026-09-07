import { describe, it, expect } from 'vitest';
import { SemanticAnnotationSchema } from '../../src/models/schemas.js';

describe('SemanticAnnotationSchema', () => {
  it('accepts empty object', () => {
    const result = SemanticAnnotationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts @context with string values', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@context': {
        schema: 'https://schema.org/',
        qudt: 'http://qudt.org/schema/qudt/',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts @type string', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@type': 'LocalBusiness',
    });
    expect(result.success).toBe(true);
  });

  it('accepts full semantic annotation with passthrough fields', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@context': { schema: 'https://schema.org/' },
      '@type': 'Event',
      'schema:startDate': '2026-06-15',
      'schema:location': 'Helsinki',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data['schema:startDate']).toBe('2026-06-15');
      expect(result.data['schema:location']).toBe('Helsinki');
    }
  });

  it('passes through arbitrary ontology-specific fields', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@type': 'QuantityValue',
      'qudt:unit': 'DEG_C',
      'qudt:value': 21.5,
      custom_field: [1, 2, 3],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data['qudt:unit']).toBe('DEG_C');
      expect(result.data['qudt:value']).toBe(21.5);
      expect(result.data.custom_field).toEqual([1, 2, 3]);
    }
  });
});

/**
 * The prefix check. Everything above this line passed before it existed and still does — a bare
 * type and a default-context prefix were always the common case, and neither is what was broken.
 * What was broken is below: an annotation could name a vocabulary nobody defined and be stored,
 * served and federated as though it meant something.
 */
describe('SemanticAnnotationSchema — undeclared prefixes', () => {
  it('refuses a @type whose prefix no @context defines', () => {
    const result = SemanticAnnotationSchema.safeParse({ '@type': 'foo:Bar' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('foo:');
      expect(result.error.issues[0].message).toContain('@context');
    }
  });

  it('accepts that same @type once the prefix is declared', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@context': { foo: 'https://example.org/foo#' },
      '@type': 'foo:Bar',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a prefix from the default context without it being declared', () => {
    for (const type of ['schema:Person', 'skos:Concept', 'aimeat:MemoryRecord', 'prov:Entity', 'saref:Device']) {
      expect(SemanticAnnotationSchema.safeParse({ '@type': type }).success).toBe(true);
    }
  });

  it('accepts a full IRI as the type', () => {
    const result = SemanticAnnotationSchema.safeParse({ '@type': 'https://example.org/ontology/Thing' });
    expect(result.success).toBe(true);
  });

  it('refuses an undeclared prefix on a PROPERTY, not just on @type', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@type': 'schema:Person',
      'nope:favouriteColour': 'blue',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain('nope:');
  });

  it('refuses an undeclared prefix inside a NESTED node', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@type': 'schema:Person',
      'schema:address': { '@type': 'weird:PostalAddress', 'schema:addressLocality': 'Helsinki' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('weird:');
      expect(result.error.issues[0].message).toContain('schema:address');
    }
  });

  it('lets a nested node use a prefix the root declared', () => {
    // A context declared once is in force all the way down. The first version of the check did not
    // carry the parent's map into the child and refused this, which would have refused our own
    // published ontology document.
    const result = SemanticAnnotationSchema.safeParse({
      '@context': { ex: 'https://example.org/ontology/' },
      '@type': 'ex:Reading',
      'ex:sensor': { '@type': 'ex:Probe', 'ex:depth': 12 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts the interest-profile annotation the spec documents', () => {
    const result = SemanticAnnotationSchema.safeParse({
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      '@type': 'schema:Person',
      'schema:knowsAbout': ['birdwatching', 'TypeScript'],
      'schema:address': {
        '@type': 'schema:PostalAddress',
        'schema:addressLocality': 'Helsinki',
        'schema:addressCountry': 'FI',
      },
      'aimeat:availability': 'open',
    });
    expect(result.success).toBe(true);
  });

  it('leaves a plain data field alone however it is spelled', () => {
    // A colon inside a URL value, a time, or a Windows path is not a prefixed name and must not be
    // read as one — the check is about KEYS and @type, never about what a value happens to contain.
    const result = SemanticAnnotationSchema.safeParse({
      '@type': 'schema:Event',
      'schema:url': 'https://example.org/a:b',
      'schema:startDate': '2026-06-15T10:30:00Z',
      note: 'ratio 3:1',
    });
    expect(result.success).toBe(true);
  });
});
