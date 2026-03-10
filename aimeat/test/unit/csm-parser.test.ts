import { describe, it, expect } from 'vitest';
import { parseCsm, validateCsm, csmToJsonSchema } from '../../src/services/csm-parser.js';

const MINIMAL_CSM = `
csm: "1.0"
service:
  name: test-service
  type: directory
  description: A test service
  version: "1.0"
schema_mode: open
data_schema:
  required:
    name:
      type: string
      min: 1
      max: 100
  optional:
    description:
      type: string
      max: 500
consent_requirements:
  visibility_default: federation
  requires_consent: true
  consent_purpose: Directory listing
  data_retention: until_revoked
moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [name]
  detail_view: [name, description]
  search_fields: [name]
`;

describe('parseCsm', () => {
  it('parses valid YAML into CsmDefinition', () => {
    const def = parseCsm(MINIMAL_CSM);
    expect(def.version).toBe('1.0');
    expect(def.service.name).toBe('test-service');
    expect(def.service.type).toBe('directory');
    expect(def.service.description).toBe('A test service');
  });

  it('parses data_schema correctly', () => {
    const def = parseCsm(MINIMAL_CSM);
    expect(def.dataSchema.required).toHaveProperty('name');
    expect(def.dataSchema.required.name.type).toBe('string');
    expect(def.dataSchema.required.name.min).toBe(1);
    expect(def.dataSchema.required.name.max).toBe(100);
    expect(def.dataSchema.optional).toHaveProperty('description');
  });

  it('parses consent_requirements', () => {
    const def = parseCsm(MINIMAL_CSM);
    expect(def.consentRequirements.visibilityDefault).toBe('federation');
    expect(def.consentRequirements.requiresConsent).toBe(true);
    expect(def.consentRequirements.consentPurpose).toBe('Directory listing');
  });

  it('parses moderation settings', () => {
    const def = parseCsm(MINIMAL_CSM);
    expect(def.moderation.flagsEnabled).toBe(true);
    expect(def.moderation.autoHideThreshold).toBe(5);
    expect(def.moderation.appealsEnabled).toBe(false);
  });

  it('parses ui_hints', () => {
    const def = parseCsm(MINIMAL_CSM);
    expect(def.uiHints.listView).toEqual(['name']);
    expect(def.uiHints.detailView).toEqual(['name', 'description']);
    expect(def.uiHints.searchFields).toEqual(['name']);
  });

  it('handles schema_mode strict', () => {
    const yaml = MINIMAL_CSM.replace('schema_mode: open', 'schema_mode: strict');
    const def = parseCsm(yaml);
    expect(def.schemaMode).toBe('strict');
  });

  it('defaults missing optional fields', () => {
    const minimal = `
csm: "1.0"
service:
  name: bare
  type: forum
  description: Minimal
data_schema:
  required:
    title:
      type: string
  optional: {}
`;
    const def = parseCsm(minimal);
    expect(def.service.author).toBeUndefined();
    expect(def.consentRequirements.dataRetention).toBe('until_revoked');
    expect(def.uiHints.listView).toEqual([]);
  });

  it('parses semantic annotation on service', () => {
    const yaml = `
csm: "1.0"
service:
  name: semantictest
  type: directory
  description: Test
  semantic:
    "@context":
      schema: "https://schema.org/"
    "@type": "LocalBusiness"
data_schema:
  required:
    name:
      type: string
`;
    const def = parseCsm(yaml);
    expect(def.service.semantic).toBeDefined();
    expect(def.service.semantic!['@type']).toBe('LocalBusiness');
  });
});

describe('validateCsm', () => {
  it('returns empty array for valid CSM', () => {
    const def = parseCsm(MINIMAL_CSM);
    const errors = validateCsm(def);
    expect(errors).toEqual([]);
  });

  it('rejects missing service.name', () => {
    const yaml = MINIMAL_CSM.replace('name: test-service', 'name: ""');
    const def = parseCsm(yaml);
    const errors = validateCsm(def);
    expect(errors).toContain('service.name is required');
  });

  it('accepts any service type (free-form string)', () => {
    const yaml = MINIMAL_CSM.replace('type: directory', 'type: custom_type');
    const def = parseCsm(yaml);
    const errors = validateCsm(def);
    expect(errors.some(e => e.includes('service.type'))).toBe(false);
  });

  it('rejects missing required fields in data_schema', () => {
    const yaml = `
csm: "1.0"
service:
  name: test
  type: directory
  description: Test
data_schema:
  required: {}
  optional:
    opt:
      type: string
`;
    const def = parseCsm(yaml);
    const errors = validateCsm(def);
    expect(errors).toContain('data_schema.required must have at least one field');
  });

  it('rejects field without type', () => {
    const yaml = `
csm: "1.0"
service:
  name: test
  type: directory
  description: Test
data_schema:
  required:
    name:
      min: 1
  optional: {}
`;
    const def = parseCsm(yaml);
    const errors = validateCsm(def);
    expect(errors.some(e => e.includes('missing type'))).toBe(true);
  });
});

describe('csmToJsonSchema', () => {
  it('generates valid JSON Schema from CSM', () => {
    const def = parseCsm(MINIMAL_CSM);
    const schema = csmToJsonSchema(def);
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.required).toEqual(['name']);
  });

  it('includes string constraints', () => {
    const def = parseCsm(MINIMAL_CSM);
    const schema = csmToJsonSchema(def);
    const nameSchema = (schema.properties as Record<string, Record<string, unknown>>).name;
    expect(nameSchema.type).toBe('string');
    expect(nameSchema.minLength).toBe(1);
    expect(nameSchema.maxLength).toBe(100);
  });

  it('includes optional fields without requiring them', () => {
    const def = parseCsm(MINIMAL_CSM);
    const schema = csmToJsonSchema(def);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.description).toBeDefined();
    expect(props.description.type).toBe('string');
    // 'description' should NOT be in required
    expect((schema.required as string[]).includes('description')).toBe(false);
  });

  it('adds additionalProperties: false for strict mode', () => {
    const yaml = MINIMAL_CSM.replace('schema_mode: open', 'schema_mode: strict');
    const def = parseCsm(yaml);
    const schema = csmToJsonSchema(def);
    expect(schema.additionalProperties).toBe(false);
  });

  it('handles array fields', () => {
    const yaml = `
csm: "1.0"
service:
  name: test
  type: directory
  description: Test
data_schema:
  required:
    tags:
      type: array
      items: string
      max: 20
  optional: {}
`;
    const def = parseCsm(yaml);
    const schema = csmToJsonSchema(def);
    const tagsSchema = (schema.properties as Record<string, Record<string, unknown>>).tags;
    expect(tagsSchema.type).toBe('array');
    expect(tagsSchema.items).toEqual({ type: 'string' });
    expect(tagsSchema.maxItems).toBe(20);
  });

  it('handles integer fields', () => {
    const yaml = `
csm: "1.0"
service:
  name: test
  type: directory
  description: Test
data_schema:
  required:
    age:
      type: integer
      min: 0
      max: 150
  optional: {}
`;
    const def = parseCsm(yaml);
    const schema = csmToJsonSchema(def);
    const ageSchema = (schema.properties as Record<string, Record<string, unknown>>).age;
    expect(ageSchema.type).toBe('integer');
    expect(ageSchema.minimum).toBe(0);
    expect(ageSchema.maximum).toBe(150);
  });
});
