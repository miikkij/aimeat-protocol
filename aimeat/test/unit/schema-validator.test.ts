import { describe, it, expect, beforeEach } from 'vitest';
import { validateSchemaItself, clearValidatorCache } from '../../src/services/schema-validator.js';

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
