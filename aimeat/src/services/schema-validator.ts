/**
 * @file schema-validator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Schema-lock validation service — compiles JSON Schemas (Ajv, cached) and
 *   validates memory writes against the applicable lock. Also validates schemas themselves
 *   before they are registered (validateSchemaItself). Since v1.2.0 every memory write is
 *   also checked against the workspace manifest's write guards (services/write-guards.ts)
 *   here, so one call site covers the REST, MCP and publish surfaces alike.
 * @version-history
 *   v1.2.0 — 2026-07-07 — TARGET-009 S1: validateMemoryWrite runs checkWriteGuard first
 *     (create_only / requires_expected_version manifest policies); optional writeCtx carries
 *     the publish path's expected_version.
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

// Compiled validator cache — key = JSON.stringify(schema). Bounded as an LRU (memory audit
// 2026-08-17): the values are COMPILED FUNCTIONS with closures, the keys arrive from
// user-authored workflow schemas, and an unbounded map of generated code is the most
// expensive kind of heap growth there is. Map iteration order is insertion order, so
// delete+set on hit makes the first key the least recently used.
const validatorCache = new Map<string, ValidateFunction>();
const VALIDATOR_CACHE_MAX = 200;

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = validatorCache.get(key);
  if (hit) {
    validatorCache.delete(key);
    validatorCache.set(key, hit);
    return hit;
  }
  const compiled = ajv.compile(schema);
  if (validatorCache.size >= VALIDATOR_CACHE_MAX) {
    validatorCache.delete(validatorCache.keys().next().value as string);
  }
  validatorCache.set(key, compiled);
  return compiled;
}

export function clearValidatorCache(): void {
  validatorCache.clear();
}

/**
 * Validate a value against a JSON Schema using the shared (cached) ajv. Returns ok + ajv messages.
 * If the schema itself is invalid, ok:false with the compile error (a bad schema must not pass).
 * Used by the workflow `json_schema` signal leaf — see services/workflow/eval-context.ts.
 */
export function validateValueAgainstSchema(value: unknown, schema: Record<string, unknown>): { ok: boolean; errors?: string[] } {
  let validate: ValidateFunction;
  try { validate = getValidator(schema); }
  catch (err) { return { ok: false, errors: [`invalid schema: ${(err as Error).message}`] }; }
  const ok = validate(value) as boolean;
  return ok ? { ok: true } : { ok: false, errors: (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`) };
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
  storage: Storage,
  writeCtx?: import('./write-guards.js').WriteGuardCtx
): Promise<ValidationResult> {
  // Write guards run first: a conflicting write in a guarded namespace is refused before any
  // schema work, whatever surface it came through (REST memory write, MCP, publish).
  const { checkWriteGuard } = await import('./write-guards.js');
  const guard = await checkWriteGuard(memoryKey, value, storage, writeCtx);
  if (!guard.valid) return guard;

  const schemaRecord = await storage.findApplicableSchema(memoryKey);

  if (!schemaRecord) {
    return { valid: true }; // No schema = no validation
  }

  // Apply schema_mode: 'strict' → add additionalProperties: false
  const schemaToValidate = { ...schemaRecord.schemaJson };
  if (schemaRecord.schemaMode === 'strict' && schemaToValidate.type === 'object') {
    (schemaToValidate as Record<string, unknown>).additionalProperties = false;
  }

  // A schema lock is registered by the principal, and a self-referential `$ref` compiled against a
  // deeply-nested value can recurse the validator to a stack overflow (CodeQL
  // resource-exhaustion-from-deep-object-traversal, AI-triage 2026-08-23). The value is size-capped
  // upstream but not depth-capped, so bound the nesting BEFORE validation, measured iteratively so
  // the check itself cannot overflow. 64 is far past any legitimate memory record.
  if (exceedsMaxDepth(value, 64)) {
    return {
      valid: false,
      errors: [{ path: '/', message: 'value is nested too deeply (max 64 levels)', schema_rule: 'maxDepth' }],
      schemaKey: schemaRecord.keyPattern,
    };
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
/**
 * True if `value` nests deeper than `max` levels of objects/arrays. Iterative (explicit stack) so
 * measuring the depth of a pathological value cannot itself overflow the call stack.
 */
export function exceedsMaxDepth(value: unknown, max: number): boolean {
  const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 0 }];
  while (stack.length) {
    const { v, d } = stack.pop() as { v: unknown; d: number };
    if (v === null || typeof v !== 'object') continue;
    if (d > max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
      stack.push({ v: child, d: d + 1 });
    }
  }
  return false;
}

export function validateSchemaItself(schema: Record<string, unknown>): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err: unknown) {
    return (err as Error).message;
  }
}
