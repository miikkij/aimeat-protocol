/**
 * @file src/services/csm/infer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A CSM (Community Service Manifest) definition inferred from one sample JSON object: the
 *   draft POST /v1/csm/draft and the MCP tool aimeat_csm action "from_sample" answer, so a person can
 *   say "this is what my program sends" instead of writing the YAML. Pure: no storage, no clock.
 *
 *   The rules, which docs/csm-spec.md section 7 and the parser (csm-parser.ts) decide between them:
 *     - a number with no fraction is `integer`, any other number `number`, true/false `boolean`;
 *     - a string that is an ISO 8601 date and time WITH a zone (Z or +hh:mm) is `string` with format
 *       `date-time`, a bare YYYY-MM-DD is format `date` (ajv-formats, which the schema lock uses,
 *       refuses a date-time without a zone, so one without a zone stays a plain string);
 *     - a nested object is `object` with its own properties, every one of them required, which is the
 *       parser's default for a nested property with no `default`;
 *     - an array takes its element type from its first element; an empty array is an array of anything;
 *     - every top-level key present in the sample is in `data_schema.required`; a key whose value is
 *       null cannot say its type, so it goes to `optional` as a string and says so in its description;
 *     - no limit (min, max, enum, pattern) is guessed: one sample cannot say how long a name may be.
 *   Nesting stops at MAX_DEPTH: a deeper object is an `object` with no properties.
 * @structure MAX_DEPTH · CsmInference · inferCsmFromSample(name, sample, opts) · inferField(value, depth)
 * @usage
 *   const inferred = inferCsmFromSample('ruuvi-nakyma', { temperature: 21.5, at: '2026-11-07T10:00:00Z' });
 *   if (!inferred.ok) → 400; else parseCsm(inferred.yaml) is the definition
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM draft from a sample; Jouni, 2026-11-07).
 */
import { stringify as stringifyYaml } from 'yaml';
import type { CsmFieldDef } from '../csm-parser.js';

/** How deep nested objects and arrays are followed. */
export const MAX_DEPTH = 8;

/** A full ISO 8601 date and time with a zone: what ajv-formats' date-time accepts. */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;
/** A calendar date alone. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type CsmInference =
  | { ok: true; yaml: string; document: Record<string, unknown> }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The field definition one sample value implies. Null is answered by the caller, never here. */
export function inferField(value: unknown, depth = 0): CsmFieldDef {
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'string') {
    if (DATE_TIME_RE.test(value) && !Number.isNaN(Date.parse(value))) return { type: 'string', format: 'date-time' };
    if (DATE_RE.test(value) && !Number.isNaN(Date.parse(value))) return { type: 'string', format: 'date' };
    return { type: 'string' };
  }
  if (Array.isArray(value)) {
    const first = value.find(v => v !== null && v !== undefined);
    if (first === undefined || depth >= MAX_DEPTH) return { type: 'array' };
    return { type: 'array', items: inferField(first, depth + 1) };
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return { type: 'object' };
    const properties: Record<string, CsmFieldDef> = {};
    for (const [k, v] of Object.entries(value)) {
      properties[k] = v === null || v === undefined
        ? { type: 'string', required: false, description: 'Null in the sample, so its type is a guess.' }
        : inferField(v, depth + 1);
    }
    return Object.keys(properties).length ? { type: 'object', properties } : { type: 'object' };
  }
  return { type: 'string' };
}

/**
 * The CSM document (the YAML's own snake_case shape) and its YAML text for one sample. Refuses a
 * sample that is not an object with at least one key that is not null, because data_schema.required
 * must name at least one field (csm-parser.ts validateCsm).
 */
export function inferCsmFromSample(
  name: string,
  sample: unknown,
  opts: { serviceType?: string; description?: string } = {},
): CsmInference {
  if (!isPlainObject(sample)) return { ok: false, error: 'sample must be one JSON object, as the program sends it' };
  const required: Record<string, CsmFieldDef> = {};
  const optional: Record<string, CsmFieldDef> = {};
  for (const [key, value] of Object.entries(sample)) {
    if (value === null || value === undefined) {
      optional[key] = { type: 'string', description: 'Null in the sample, so its type is a guess.' };
    } else {
      required[key] = inferField(value, 1);
    }
  }
  if (Object.keys(required).length === 0) {
    return { ok: false, error: 'sample needs at least one field with a value that is not null' };
  }
  const document: Record<string, unknown> = {
    csm: '1.0',
    service: {
      name,
      type: opts.serviceType?.trim() || 'data',
      description: opts.description?.trim() || `The data a program sends for ${name}, inferred from one sample.`,
      version: '1.0',
    },
    schema_mode: 'open',
    data_schema: {
      required,
      ...(Object.keys(optional).length ? { optional } : {}),
    },
  };
  return { ok: true, yaml: stringifyYaml(document), document };
}
