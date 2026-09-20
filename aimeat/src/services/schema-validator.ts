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
 *   v1.4.0 — 2026-09-20 — validateValueAgainstSchema asks a validator WITHOUT allErrors first, and
 *     builds the full violation list only for a value under 256 kB. The depth bound added earlier
 *     the same day did not answer the finding, and CodeQL was right to keep it open: the cost is
 *     in the WIDTH, not the depth. Measured on 40 000 refused fields: 40 001 error objects, each
 *     carrying a copy of its data because this validator is `verbose`, against two. A value over
 *     the ceiling gets the first violation and a line saying the rest was not counted, which is
 *     enough to fix a record (CodeQL resource-exhaustion-from-deep-object-traversal, alert 1643).
 *   v1.3.0 — 2026-09-13 — A violation names the property it is about (`must NOT have additional
 *     properties: "b"`, the accepted values of an enum), on both validators, and
 *     validateValueAgainstSchema also returns `violations` with path, rule and params. The batch
 *     publish kept only the generic message, so a publish refused by one new field repeated
 *     "/ must NOT have additional properties" per record and never said which field.
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
import { logger } from '../utils/logger.js';

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

// The same validator without allErrors: it stops at the first violation, so its cost does not grow
// with the number of things wrong in the value. See getFirstErrorValidator for why the untrusted
// door asks this one first.
const ajvFirstError = new AjvClass({ allErrors: false, verbose: true }) as {
  compile: (schema: object) => ValidateFunction;
  addKeyword: (def: { keyword: string }) => void;
};
addFormats(ajvFirstError);
ajvFirstError.addKeyword({ keyword: 'x-default' });

// Compiled validator cache — key = JSON.stringify(schema). Bounded as an LRU (memory audit
// 2026-08-17): the values are COMPILED FUNCTIONS with closures, the keys arrive from
// user-authored workflow schemas, and an unbounded map of generated code is the most
// expensive kind of heap growth there is. Map iteration order is insertion order, so
// delete+set on hit makes the first key the least recently used.
const validatorCache = new Map<string, ValidateFunction>();
const firstErrorCache = new Map<string, ValidateFunction>();
const VALIDATOR_CACHE_MAX = 200;

/**
 * How big a value may be before the full violation list is worth building for it.
 *
 * A quarter of the per-value memory ceiling (1024 kB, src/config.ts). Above it the caller gets the
 * first violation and a line saying so, which is enough to fix a record and cannot be turned into
 * a denial of service by a caller who sends a wide one.
 */
const FULL_ERRORS_MAX_BYTES = 256 * 1024;

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  return fromCache(validatorCache, ajv, schema);
}

/**
 * The same schema compiled to stop at the FIRST violation.
 *
 * `allErrors` is what makes a violation list worth reading, and ajv's own documentation says not to
 * use it on untrusted data: the validator walks the whole value and can build an error object per
 * violation, so a value with a hundred thousand refused fields costs a hundred thousand objects
 * (CodeQL js/resource-exhaustion-from-deep-object-traversal). A depth bound does not answer that,
 * because the cost is in the WIDTH. So the untrusted door asks this one first: it stops at the
 * first violation whatever arrives, and the full list is compiled only for a value small enough
 * that the list is worth having.
 */
function getFirstErrorValidator(schema: Record<string, unknown>): ValidateFunction {
  return fromCache(firstErrorCache, ajvFirstError, schema);
}

function fromCache(
  cache: Map<string, ValidateFunction>,
  compiler: { compile: (schema: object) => ValidateFunction },
  schema: Record<string, unknown>,
): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const compiled = compiler.compile(schema);
  if (cache.size >= VALIDATOR_CACHE_MAX) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, compiled);
  return compiled;
}

export function clearValidatorCache(): void {
  validatorCache.clear();
}

/** One schema violation, in the shape every door hands back. */
export interface SchemaViolation {
  path: string;
  message: string;
  schema_rule: string;
  params?: Record<string, unknown>;
}

type AjvError = NonNullable<ValidateFunction['errors']>[number];

/**
 * Ajv's message with the name it is about. Ajv puts the offending property of an
 * `additionalProperties` refusal, and the accepted values of an `enum`, in `params` and leaves the
 * message generic, so a caller reading only the message saw "must NOT have additional properties"
 * once per record and nothing saying which property. `required` and `type` already name theirs.
 */
function namedMessage(err: AjvError): string {
  const base = err.message ?? 'Unknown validation error';
  const p = (err.params ?? {}) as Record<string, unknown>;
  if (typeof p.additionalProperty === 'string') return `${base}: "${p.additionalProperty}"`;
  if (typeof p.unevaluatedProperty === 'string') return `${base}: "${p.unevaluatedProperty}"`;
  if (Array.isArray(p.allowedValues)) return `${base}: ${JSON.stringify(p.allowedValues)}`;
  if ('allowedValue' in p) return `${base}: ${JSON.stringify(p.allowedValue)}`;
  return base;
}

function toViolations(errors: ValidateFunction['errors']): SchemaViolation[] {
  return (errors ?? []).map(err => ({
    path: err.instancePath || '/',
    message: namedMessage(err),
    schema_rule: err.keyword,
    params: err.params as Record<string, unknown>,
  }));
}

/**
 * Validate a value against a JSON Schema using the shared (cached) ajv. Returns ok + one message per
 * violation (path first, then what is wrong and the name it is about), and `violations` with the path,
 * rule and params beside each message, which is what the single-write door has always returned.
 * If the schema itself is invalid, ok:false with the compile error (a bad schema must not pass).
 * Used by the workflow `json_schema` signal leaf — see services/workflow/eval-context.ts.
 */
export function validateValueAgainstSchema(
  value: unknown, schema: Record<string, unknown>,
): { ok: boolean; errors?: string[]; violations?: SchemaViolation[] } {
  // THE FIRST PASS STOPS AT THE FIRST VIOLATION, whatever arrives. The four callers all pass a
  // value somebody else chose — a workspace record draft, an app tool's input, an offer's
  // prerequisites, a workflow signal — and a full violation list costs an object per violation, so
  // a value with a hundred thousand refused fields is a hundred thousand objects this node builds
  // on a stranger's say-so (CodeQL resource-exhaustion-from-deep-object-traversal, alert 1643).
  let first: ValidateFunction;
  try { first = getFirstErrorValidator(schema); }
  catch (err) { return { ok: false, errors: [`invalid schema: ${(err as Error).message}`] }; }
  if (exceedsMaxDepth(value, 64)) {
    return { ok: false, errors: ['/ value is nested too deeply (max 64 levels)'] };
  }
  if (first(value) as boolean) return { ok: true };

  // It is wrong, so the caller wants to know everything that is wrong with it — but only for a
  // value small enough that the answer cannot be turned into a denial of service. Above the
  // ceiling the first violation is what comes back, with a line saying the rest was not counted.
  const firstViolations = toViolations(first.errors);
  if (sizeOf(value) > FULL_ERRORS_MAX_BYTES) {
    return {
      ok: false,
      errors: [...firstViolations.map(v => `${v.path} ${v.message}`),
        `(only the first violation is listed: the value is over ${FULL_ERRORS_MAX_BYTES / 1024} kB)`],
      violations: firstViolations,
    };
  }
  const validate = getValidator(schema);
  const ok = validate(value) as boolean;
  if (ok) return { ok: true };
  const violations = toViolations(validate.errors);
  return { ok: false, errors: violations.map(v => `${v.path} ${v.message}`), violations };
}

/**
 * How many bytes the value is as JSON, and Infinity when it will not serialise.
 *
 * Infinity is the honest answer rather than a fallback: JSON.stringify throws on a cycle or a
 * BigInt, and a value the node cannot even write down is exactly the one not to build a full
 * violation list for. The caller reads it as "over the ceiling", which is the safe side.
 */
function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch (err) {
    logger.debug('schema-validator: value does not serialise, so it counts as over the listing ceiling',
      { error: String(err) });
    return Infinity;
  }
}

export function removeFromCache(schema: Record<string, unknown>): void {
  const key = JSON.stringify(schema);
  validatorCache.delete(key);
  firstErrorCache.delete(key);
}

export interface ValidationResult {
  valid: boolean;
  errors?: SchemaViolation[];
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
    errors: toViolations(validate.errors),
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
