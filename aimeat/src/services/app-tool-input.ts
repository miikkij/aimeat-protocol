/**
 * @file src/services/app-tool-input.ts
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
 * @structure checkAppToolInput(tool, input) · AppToolInputCheck
 * @usage
 *   const input = applyLockedInput(tool, rawInput);
 *   const check = checkAppToolInput(tool, input);
 *   if (!check.ok) return fail(`INVALID_INPUT: ${check.message}`);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { validateValueAgainstSchema, type SchemaViolation } from './schema-validator.js';

export type AppToolInputCheck =
  | { ok: true }
  | { ok: false; message: string; missing: string[]; violations: SchemaViolation[] };

/**
 * Validate `input` (already merged with the tool's locked input) against the tool's published
 * `inputSchema`. A tool with no schema, or with one that does not compile, passes.
 */
export function checkAppToolInput(
  tool: { name: string; inputSchema?: Record<string, unknown> },
  input: Record<string, unknown>,
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
  return {
    ok: false,
    message: `tool "${tool.name}" input does not match its published schema: ${parts.join('; ')}.${tail}`
      + ' The full schema is in the app\'s tool manifest (aimeat_app_tools_get).',
    missing,
    violations: res.violations,
  };
}
