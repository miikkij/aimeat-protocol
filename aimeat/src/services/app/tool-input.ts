/**
 * @file src/services/app/tool-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Checks what a caller sends to an app's tool against the `inputSchema` the tool's
 *   manifest publishes, BEFORE the call is metered or the extension runs, and names every problem at
 *   once.
 *
 *   WHY. The node passed input through unchecked, so the only check was the extension's own, and
 *   an extension that stops at its first missing field makes a caller learn the schema one refusal
 *   at a time: Lifecycle Central's decision_record took five calls on 2026-09-19 to learn five
 *   required fields its manifest had listed all along. Checked here, one refusal names them all, on
 *   both doors (the MCP tool and the REST route), for every app.
 *
 *   A SCHEMA THAT DOES NOT COMPILE IS NOT ENFORCED. The manifest field is documentation first and has
 *   never been validated as a JSON Schema, so a live manifest may carry a keyword the validator does
 *   not know. Refusing every call to such a tool would break a working integration for a fault in
 *   its documentation; the call goes through as it always has, and the extension still checks.
 *
 *   THE REFUSAL CARRIES THE FIELDS. Naming only the wrong field and the required ones left the caller
 *   to guess the rest: an agent that sent `note` to a heartbeat was told `note` is not accepted and
 *   which two fields are required, and not that `sessionId` and `sessionUrl` exist or what type each
 *   field is. The manifest that holds the answer is one call away, but it holds every tool of the
 *   app (57 kB for one app on 2026-11-21), so agents skipped it and guessed again: 803 of 5 982
 *   aimeat_app_tool_invoke calls failed in thirty days. The refusal now lists every field the tool
 *   accepts with its type and limits, names the skills bound to the app when the caller has them,
 *   and says how to read this one tool's schema, so the next call can be the right one.
 * @structure checkAppToolInput(tool, input, opts?) · describeAcceptedFields(schema) · AppToolInputCheck
 * @usage
 *   const input = applyLockedInput(tool, rawInput);
 *   const check = checkAppToolInput(tool, input);
 *   if (!check.ok) return fail(`INVALID_INPUT: ${check.message}`);
 * @version-history
 *   2026-11-21 — The refusal lists the accepted fields with their types and limits, names the skills
 *     bound to the app (opts.skills), and points at aimeat_app_tools_get with `tool`.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { validateValueAgainstSchema, type SchemaViolation } from '../schema-validator.js';

export type AppToolInputCheck =
  | { ok: true }
  | { ok: false; message: string; missing: string[]; violations: SchemaViolation[] };

/** The most fields a refusal lists, and the longest the list may grow, so a huge schema stays readable. */
const MAX_FIELDS_LISTED = 40;
const MAX_FIELD_TEXT = 2400;

type JsonSchema = Record<string, unknown>;

function typeOf(s: JsonSchema): string {
  if (Array.isArray(s.enum)) return `one of ${(s.enum as unknown[]).map(v => JSON.stringify(v)).join(' | ')}`;
  if (s.const !== undefined) return `exactly ${JSON.stringify(s.const)}`;
  const alternatives = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null) as JsonSchema[] | null;
  if (alternatives) return alternatives.map(a => (a && typeof a === 'object' ? typeOf(a) : '?')).join(' or ');
  const t = Array.isArray(s.type) ? (s.type as string[]).join(' or ') : typeof s.type === 'string' ? s.type : 'any';
  if (t === 'array') {
    const items = s.items && typeof s.items === 'object' && !Array.isArray(s.items) ? typeOf(s.items as JsonSchema) : 'any';
    return `list of ${items}`;
  }
  return t;
}

function limitsOf(s: JsonSchema): string[] {
  const out: string[] = [];
  const range = (min: unknown, max: unknown, unit: string) => {
    const lo = typeof min === 'number' ? min : undefined;
    const hi = typeof max === 'number' ? max : undefined;
    if (lo !== undefined && hi !== undefined) out.push(`${lo} to ${hi}${unit}`);
    else if (lo !== undefined) out.push(`at least ${lo}${unit}`);
    else if (hi !== undefined) out.push(`at most ${hi}${unit}`);
  };
  range(s.minLength, s.maxLength, ' characters');
  range(s.minimum, s.maximum, '');
  range(s.minItems, s.maxItems, ' items');
  if (typeof s.format === 'string') out.push(s.format);
  if (typeof s.pattern === 'string') out.push(`matching /${s.pattern}/`);
  return out;
}

/**
 * Every top-level field a tool's schema accepts, as one line a caller can act on:
 * `id (string, required); now (string, date-time); area (list of string)`. Ends with "No other field
 * is accepted." when the schema refuses extra fields. Empty when the schema names no properties.
 */
export function describeAcceptedFields(schema: JsonSchema): string {
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties as Record<string, JsonSchema> : {};
  const names = Object.keys(props);
  if (names.length === 0) return '';
  const requiredList = Array.isArray(schema.required) ? (schema.required as unknown[]).filter(r => typeof r === 'string') as string[] : [];
  const required = new Set(requiredList);
  // Required fields first, in the schema's `required` order, so a cut list still names what the call
  // cannot do without; then the rest by name. Not the properties' own order: PostgreSQL keeps a
  // stored schema as jsonb, which reorders an object's keys, and the two backends must answer alike.
  const ordered = [
    ...requiredList.filter(n => names.includes(n)),
    ...names.filter(n => !required.has(n)).sort(),
  ];
  const parts: string[] = [];
  let length = 0;
  for (const name of ordered.slice(0, MAX_FIELDS_LISTED)) {
    const s = props[name] && typeof props[name] === 'object' ? props[name] : {};
    const facts = [typeOf(s), ...limitsOf(s), ...(required.has(name) ? ['required'] : [])];
    const part = `${name} (${facts.join(', ')})`;
    if (length + part.length > MAX_FIELD_TEXT) break;
    parts.push(part);
    length += part.length + 2;
  }
  const left = names.length - parts.length;
  const more = left > 0 ? `; and ${left} more field${left > 1 ? 's' : ''}` : '';
  const closed = schema.additionalProperties === false ? ' No other field is accepted.' : '';
  return `Accepted fields: ${parts.join('; ')}${more}.${closed}`;
}

/**
 * Validate `input` (already merged with the tool's locked input) against the tool's published
 * `inputSchema`. A tool with no schema, or with one that does not compile, passes. `opts.skills`
 * are the refs of the skills bound to the tool's app that the caller can load; the refusal names them.
 */
export function checkAppToolInput(
  tool: { name: string; inputSchema?: Record<string, unknown> },
  input: Record<string, unknown>,
  opts: { skills?: string[]; app?: { owner: string; name: string } } = {},
): AppToolInputCheck {
  const schema = tool.inputSchema;
  if (!schema || Object.keys(schema).length === 0) return { ok: true };
  const res = validateValueAgainstSchema(input, schema);
  // No `violations` on a failure means the schema itself did not compile: not enforced (see header).
  if (res.ok || !res.violations) return { ok: true };

  const missing: string[] = [];
  const other: string[] = [];
  for (const v of res.violations) {
    const prop = (v.params as { missingProperty?: unknown } | undefined)?.missingProperty;
    if (v.schema_rule === 'required' && typeof prop === 'string') {
      missing.push(v.path === '/' ? prop : `${v.path.slice(1).replace(/\//g, '.')}.${prop}`);
    } else {
      other.push(`${v.path === '/' ? 'input' : v.path.slice(1).replace(/\//g, '.')} ${v.message}`);
    }
  }
  const parts: string[] = [];
  if (missing.length) parts.push(`missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  if (other.length) parts.push(other.join('; '));
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter(r => typeof r === 'string') : [];
  const tail = required.length ? ` The tool requires: ${required.join(', ')}.` : '';
  const fields = describeAcceptedFields(schema);
  const skills = (opts.skills ?? []).filter(Boolean);
  const skillLine = skills.length
    ? ` How this app's tools are used is in skill ${skills.map(s => `"${s}"`).join(', ')}: load it with aimeat_skill_get before the next call.`
    : '';
  const read = opts.app
    ? `aimeat_app_tools_get { app_id: "${opts.app.name}", owner: "${opts.app.owner}", tool: "${tool.name}" }`
    : `aimeat_app_tools_get with tool: "${tool.name}"`;
  return {
    ok: false,
    message: `tool "${tool.name}" input does not match its published schema: ${parts.join('; ')}.${tail}`
      + (fields ? ` ${fields}` : '')
      + skillLine
      + ` This tool's whole schema: ${read}.`,
    missing,
    violations: res.violations,
  };
}
