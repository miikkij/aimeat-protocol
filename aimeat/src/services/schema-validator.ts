/**
 * @file schema-validator.ts
 * @description Schema-lock validation service — compiles JSON Schemas (Ajv, cached) and
 *   validates memory writes against the applicable lock. Also validates schemas themselves
 *   before they are registered (validateSchemaItself).
 * @version-history
 *   v1.1.0 — 2026-06-10 — Register "x-default" as a no-op annotation keyword (UI pre-fill
 *     hint, e.g. "currentUser") so strict-mode schema locks accept generated schemas.
 */
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { Storage } from '../storage/interface.js';
import { getStats } from './stats.js';

// CJS-ESM interop: ajv and ajv-formats are CJS packages
const require = createRequire(import.meta.url);
 
const ajvPkg = require('ajv');
const formatsPkg = require('ajv-formats');
 

const AjvClass = ajvPkg.default ?? ajvPkg;
const addFormats = formatsPkg.default ?? formatsPkg;

 
const ajv = new AjvClass({ allErrors: true, verbose: true }) as {
  compile: (schema: object) => ValidateFunction;
  addKeyword: (def: { keyword: string }) => void;
};
addFormats(ajv);
// "x-default" is a UI annotation (e.g. "currentUser" pre-fills the signed-in identity in
// workspace record forms). Register it as a no-op keyword so strict-mode compile accepts it.
ajv.addKeyword({ keyword: 'x-default' });

// Compiled validator cache — key = JSON.stringify(schema)
const validatorCache = new Map<string, ValidateFunction>();

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  if (!validatorCache.has(key)) {
    validatorCache.set(key, ajv.compile(schema));
  }
  return validatorCache.get(key)!;
}

export function clearValidatorCache(): void {
  validatorCache.clear();
}

export function removeFromCache(schema: Record<string, unknown>): void {
  validatorCache.delete(JSON.stringify(schema));
}

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    schema_rule: string;
    params?: Record<string, unknown>;
  }>;
  schemaKey?: string;
}

export async function validateMemoryWrite(
  memoryKey: string,
  value: unknown,
  storage: Storage
): Promise<ValidationResult> {
  const schemaRecord = await storage.findApplicableSchema(memoryKey);

  if (!schemaRecord) {
    return { valid: true }; // No schema = no validation
  }

  // Apply schema_mode: 'strict' → add additionalProperties: false
  const schemaToValidate = { ...schemaRecord.schemaJson };
  if (schemaRecord.schemaMode === 'strict' && schemaToValidate.type === 'object') {
    (schemaToValidate as Record<string, unknown>).additionalProperties = false;
  }

  const validate = getValidator(schemaToValidate);
  const isValid = validate(value);

  getStats()?.increment('schema_validations');
  if (!isValid) getStats()?.increment('schema_validation_failures');

  if (isValid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map(err => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      schema_rule: err.keyword,
      params: err.params as Record<string, unknown>,
    })),
    schemaKey: schemaRecord.keyPattern,
  };
}

/**
 * Validate a schema itself — is the given object a valid JSON Schema?
 * Returns null if ok, error message if not.
 */
export function validateSchemaItself(schema: Record<string, unknown>): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err: unknown) {
    return (err as Error).message;
  }
}
