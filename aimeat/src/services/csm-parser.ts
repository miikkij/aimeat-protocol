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
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { parse as parseYaml } from 'yaml';

// ── CSM Types ──

/** Service type is a free-form string — CSM authors define their own types. */
export type CsmServiceType = string;

export type CsmVisibilityDefault = 'private' | 'dmz' | 'local' | 'federation' | 'public';

export interface CsmFieldDef {
  type: string;
  min?: number;
  max?: number;
  enum?: string[];
  format?: string;
  items?: string | CsmFieldDef;
  properties?: Record<string, CsmFieldDef & { required?: boolean }>;
  required?: boolean;
}

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
  }

  // Validate consent requirements
  if (!['private', 'dmz', 'local', 'federation', 'public'].includes(def.consentRequirements.visibilityDefault)) {
    errors.push('consent_requirements.visibility_default must be one of: private, dmz, local, federation, public');
  }

  return errors;
}

// ── JSON Schema Generator ──

function fieldDefToJsonSchema(field: CsmFieldDef): Record<string, unknown> {
  const schema: Record<string, unknown> = {};

  switch (field.type) {
    case 'string':
      schema.type = 'string';
      if (field.min !== undefined) schema.minLength = field.min;
      if (field.max !== undefined) schema.maxLength = field.max;
      if (field.enum) schema.enum = field.enum;
      if (field.format) schema.format = field.format;
      break;

    case 'number':
      schema.type = 'number';
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      break;

    case 'integer':
      schema.type = 'integer';
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
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
      if (field.min !== undefined) schema.minItems = field.min;
      if (field.max !== undefined) schema.maxItems = field.max;
      break;

    case 'object':
      schema.type = 'object';
      if (field.properties) {
        const props: Record<string, unknown> = {};
        const req: string[] = [];
        for (const [pName, pDef] of Object.entries(field.properties)) {
          props[pName] = fieldDefToJsonSchema(pDef);
          if (pDef.required !== false) req.push(pName);
        }
        schema.properties = props;
        if (req.length > 0) schema.required = req;
      }
      break;

    default:
      schema.type = field.type;
  }

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
