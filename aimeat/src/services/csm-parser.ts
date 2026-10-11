/**
 * @file src/services/csm-parser.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CSM (Community Service Model) parser: parses a YAML service definition into a typed
 *   CsmDefinition, validates its structure/consent/moderation/uiHints blocks, and converts its data
 *   schema into a JSON Schema for the generic validation layer.
 *
 * @structure
 *   - CsmDefinition / CsmFieldDef / CsmServiceType: the parsed CSM type model
 *   - parseCsm(yaml): YAML → CsmDefinition
 *   - validateCsm(def): returns a list of structural/semantic validation errors
 *   - csmToJsonSchema(def): CSM data schema → JSON Schema
 *
 * @version-history
 *   v1.2.0 — 2026-10-11 — A field limit may be written as its JSON Schema keyword (minLength,
 *     maxLength, minimum, maximum, minItems, maxItems) as well as min/max, and `default` and
 *     `description` reach the compiled schema. An object field's `required: [names]` list decides
 *     which of its properties are required, and a nested property with a `default` is optional.
 *     The seven runtime templates had stated their limits in those names, which the parser dropped,
 *     so every seeded schema enforced no length, range or item limit (docs audit 2026-10-11).
 *   v1.1.0 — 2026-09-08 — validateCsm checks service.semantic's prefixes. The spec had listed the
 *     semantic block under "not currently validated", so a manifest could name a vocabulary nobody
 *     defined and the node copied it into the memory key's semanticContext unexamined.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { parse as parseYaml } from 'yaml';
import { annotationErrors } from '../utils/onto-context.js';

// ── CSM Types ──

/** Service type is a free-form string — CSM authors define their own types. */
export type CsmServiceType = string;

export type CsmVisibilityDefault = 'private' | 'dmz' | 'local' | 'federation' | 'public';

/**
 * One field of a CSM data schema. A limit is written either as `min`/`max`, which the parser maps to
 * the keyword the field's type needs, or as that JSON Schema keyword itself (`minLength`, `maximum`,
 * `maxItems` and the rest), because people and AIs write those names. When a field states both, the
 * JSON Schema keyword wins.
 */
export interface CsmFieldDef {
  type: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  description?: string;
  enum?: string[];
  format?: string;
  items?: string | CsmFieldDef;
  properties?: Record<string, CsmFieldDef>;
  /**
   * On a nested property: `false` makes it optional in its parent object. On an object field: a list
   * of its property names, which then decides alone which of them are required (JSON Schema's own
   * shape). Without a list, a nested property is required unless it says `required: false` or
   * states a `default`.
   */
  required?: boolean | string[];
}

/** The field keys the parser reads. Anything else in a field definition has no effect. */
export const CSM_FIELD_KEYS: readonly string[] = [
  'type', 'min', 'max', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems',
  'default', 'enum', 'format', 'items', 'properties', 'required', 'description',
];

export interface CsmDefinition {
  version: string;
  service: {
    name: string;
    type: CsmServiceType;
    description: string;
    version: string;
    author?: string;
    semantic?: {
      '@context'?: Record<string, string>;
      '@type'?: string;
      [key: string]: unknown;
    };
  };
  schemaMode: 'open' | 'strict';
  dataSchema: {
    required: Record<string, CsmFieldDef>;
    optional: Record<string, CsmFieldDef>;
  };
  consentRequirements: {
    visibilityDefault: 'private' | 'dmz' | 'local' | 'federation' | 'public';
    requiresConsent: boolean;
    consentPurpose: string;
    dataRetention: string;
  };
  moderation: {
    flagsEnabled: boolean;
    autoHideThreshold: number;
    appealsEnabled: boolean;
  };
  uiHints: {
    listView: string[];
    detailView: string[];
    searchFields: string[];
    sortOptions?: string[];
    cardImageField?: string;
  };
}

// ── Parser ──

export function parseCsm(yamlContent: string): CsmDefinition {
  const raw = parseYaml(yamlContent) as Record<string, unknown>;

  const service = raw.service as Record<string, unknown> | undefined;
  const dataSchema = raw.data_schema as Record<string, unknown> | undefined;
  const consent = raw.consent_requirements as Record<string, unknown> | undefined;
  const moderation = raw.moderation as Record<string, unknown> | undefined;
  const uiHints = raw.ui_hints as Record<string, unknown> | undefined;

  return {
    version: String(raw.csm ?? '1.0'),
    service: {
      name: String(service?.name ?? ''),
      type: String(service?.type ?? 'directory') as CsmServiceType,
      description: String(service?.description ?? ''),
      version: String(service?.version ?? '1.0'),
      author: service?.author ? String(service.author) : undefined,
      semantic: service?.semantic && typeof service.semantic === 'object'
        ? service.semantic as CsmDefinition['service']['semantic']
        : undefined,
    },
    schemaMode: (raw.schema_mode === 'strict' ? 'strict' : 'open') as 'open' | 'strict',
    dataSchema: {
      required: (dataSchema?.required ?? {}) as Record<string, CsmFieldDef>,
      optional: (dataSchema?.optional ?? {}) as Record<string, CsmFieldDef>,
    },
    consentRequirements: {
      visibilityDefault: String(consent?.visibility_default ?? 'federation') as CsmVisibilityDefault,
      requiresConsent: consent?.requires_consent !== false,
      consentPurpose: String(consent?.consent_purpose ?? ''),
      dataRetention: String(consent?.data_retention ?? 'until_revoked'),
    },
    moderation: {
      flagsEnabled: moderation?.flags_enabled !== false,
      autoHideThreshold: Number(moderation?.auto_hide_threshold ?? 5),
      appealsEnabled: moderation?.appeals_enabled === true,
    },
    uiHints: {
      listView: Array.isArray(uiHints?.list_view) ? (uiHints.list_view as string[]) : [],
      detailView: Array.isArray(uiHints?.detail_view) ? (uiHints.detail_view as string[]) : [],
      searchFields: Array.isArray(uiHints?.search_fields) ? (uiHints.search_fields as string[]) : [],
      sortOptions: Array.isArray(uiHints?.sort_options) ? (uiHints.sort_options as string[]) : undefined,
      cardImageField: uiHints?.card_image_field ? String(uiHints.card_image_field) : undefined,
    },
  };
}

// ── Validator ──

export function validateCsm(def: CsmDefinition): string[] {
  const errors: string[] = [];

  if (!def.version) errors.push('csm version is required');
  if (!def.service.name) errors.push('service.name is required');
  if (!def.service.type) errors.push('service.type is required');
  if (!def.service.description) errors.push('service.description is required');

  // Validate data_schema: must have at least one required field
  const reqKeys = Object.keys(def.dataSchema.required);
  if (reqKeys.length === 0) {
    errors.push('data_schema.required must have at least one field');
  }

  // Validate field types
  const allFields = { ...def.dataSchema.required, ...def.dataSchema.optional };
  for (const [name, field] of Object.entries(allFields)) {
    if (!field.type) errors.push(`data_schema field "${name}" is missing type`);
    requiredListErrors(name, field, errors);
  }

  // Validate consent requirements
  if (!['private', 'dmz', 'local', 'federation', 'public'].includes(def.consentRequirements.visibilityDefault)) {
    errors.push('consent_requirements.visibility_default must be one of: private, dmz, local, federation, public');
  }

  // The semantic block, if there is one. The CSM spec listed this under "not currently validated",
  // and a manifest registered with `@type: shop:Directory` was stored, served and copied into the
  // key's semanticContext with nothing anywhere able to say what `shop:` meant.
  for (const message of annotationErrors(def.service.semantic)) {
    errors.push(`service.semantic: ${message}`);
  }

  return errors;
}

/** An object field's `required` list may name only its own properties, at any depth. */
function requiredListErrors(path: string, field: CsmFieldDef, errors: string[]): void {
  if (!field || typeof field !== 'object') return;
  if (Array.isArray(field.required)) {
    const props = field.properties ?? {};
    for (const name of field.required) {
      if (!(name in props)) errors.push(`data_schema field "${path}": required names "${name}", which is not one of its properties`);
    }
  }
  for (const [name, prop] of Object.entries(field.properties ?? {})) requiredListErrors(`${path}.${name}`, prop, errors);
  if (field.items && typeof field.items === 'object') requiredListErrors(`${path}[]`, field.items, errors);
}

// ── JSON Schema Generator ──

/** A field's limit, read from its JSON Schema keyword first and from `min`/`max` second. */
function limit(field: CsmFieldDef, keyword: keyof CsmFieldDef, short: 'min' | 'max'): number | undefined {
  const value = field[keyword] ?? field[short];
  return typeof value === 'number' ? value : undefined;
}

/** Copy a limit into the schema under its JSON Schema keyword, when the field states one. */
function setLimit(schema: Record<string, unknown>, field: CsmFieldDef, keyword: keyof CsmFieldDef, short: 'min' | 'max'): void {
  const value = limit(field, keyword, short);
  if (value !== undefined) schema[keyword] = value;
}

/** Is this nested property required in its parent object? See CsmFieldDef.required. */
function nestedRequired(parent: CsmFieldDef, name: string, prop: CsmFieldDef): boolean {
  if (Array.isArray(parent.required)) return parent.required.includes(name);
  if (prop.required === false) return false;
  if (prop.required === true) return true;
  return prop.default === undefined;
}

function fieldDefToJsonSchema(field: CsmFieldDef): Record<string, unknown> {
  const schema: Record<string, unknown> = {};

  switch (field.type) {
    case 'string':
      schema.type = 'string';
      setLimit(schema, field, 'minLength', 'min');
      setLimit(schema, field, 'maxLength', 'max');
      if (field.enum) schema.enum = field.enum;
      if (field.format) schema.format = field.format;
      break;

    case 'number':
      schema.type = 'number';
      setLimit(schema, field, 'minimum', 'min');
      setLimit(schema, field, 'maximum', 'max');
      break;

    case 'integer':
      schema.type = 'integer';
      setLimit(schema, field, 'minimum', 'min');
      setLimit(schema, field, 'maximum', 'max');
      break;

    case 'boolean':
      schema.type = 'boolean';
      break;

    case 'array':
      schema.type = 'array';
      if (field.items) {
        schema.items = typeof field.items === 'string'
          ? { type: field.items }
          : fieldDefToJsonSchema(field.items as CsmFieldDef);
      }
      setLimit(schema, field, 'minItems', 'min');
      setLimit(schema, field, 'maxItems', 'max');
      break;

    case 'object':
      schema.type = 'object';
      if (field.properties) {
        const props: Record<string, unknown> = {};
        const req: string[] = [];
        for (const [pName, pDef] of Object.entries(field.properties)) {
          props[pName] = fieldDefToJsonSchema(pDef);
          if (nestedRequired(field, pName, pDef)) req.push(pName);
        }
        schema.properties = props;
        if (req.length > 0) schema.required = req;
      }
      break;

    default:
      schema.type = field.type;
  }

  if (field.default !== undefined) schema.default = field.default;
  if (typeof field.description === 'string') schema.description = field.description;

  return schema;
}

export function csmToJsonSchema(def: CsmDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(def.dataSchema.required)) {
    properties[name] = fieldDefToJsonSchema(field);
    required.push(name);
  }

  for (const [name, field] of Object.entries(def.dataSchema.optional)) {
    properties[name] = fieldDefToJsonSchema(field);
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  if (def.schemaMode === 'strict') {
    schema.additionalProperties = false;
  }

  return schema;
}
