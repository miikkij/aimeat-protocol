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
