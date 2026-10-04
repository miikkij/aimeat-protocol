/**
 * @file src/mcp/null-as-absent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A `null` sent for an optional field that does not accept null is read as the field
 *   left out, on every tool of an MCP server.
 *
 *   WHY. Several MCP clients fill an optional field the model left out with `null`: CrewAI builds a
 *   pydantic model from the tool's JSON Schema, gives every optional field the default None, and
 *   dumps it whole, nested objects included. A zod `.optional()` refuses null, so the call failed
 *   with "expected string, received null at todos[0].description" before the tool ran. Found by
 *   crewfive on a hosted place, 2026-10-03: their onboarding repeated one step 13 times. Every tool
 *   with an optional field inside an object was open to it, which is why the fix is here and not in
 *   one tool's schema.
 *
 *   WHAT IT DOES. The SDK checks the arguments in `validateToolInput` before any handler runs. When
 *   that check fails, this parses again with each `null` removed ONLY at a path where the schema
 *   refused that exact null, and repeats while that removes something. A field that accepts null
 *   (`.nullable()`, `.nullish()`: `task_start`, CORS `origins`, a crew `choice`) never fails on it,
 *   so its null is never touched and still means "clear". A null in an array is left alone, because
 *   removing an item would move the others. When the repaired arguments still fail, the original
 *   error is thrown, so the caller reads what it sent wrong and not a message about a repair.
 *
 *   The published JSON Schema does not change: a client that reads it still sees an optional string.
 * @structure treatNullAsAbsent · nullPathsRefused · withoutKeys
 * @usage treatNullAsAbsent(mcp) right after `new McpServer(...)`, before any tool is called.
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema, safeParseAsync, type AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';

/** How many rounds of removal before giving up. Each round removes every refused null it can see. */
const MAX_ROUNDS = 8;

type Path = Array<string | number>;
interface Issue { path?: PropertyKey[]; errors?: Issue[][] }

function valueAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/** The paths in `args` that hold null and that one of the issues refused. Union branches included. */
export function nullPathsRefused(issues: Issue[], args: unknown, prefix: Path = []): Path[] {
  const out: Path[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...((issue.path ?? []).filter((k): k is string | number => typeof k !== 'symbol'))];
    if (path.length > 0 && valueAt(args, path) === null) {
      const parent = valueAt(args, path.slice(0, -1));
      // An object key only: an array item removed would shift every item after it.
      if (parent !== null && typeof parent === 'object' && !Array.isArray(parent)) out.push(path);
    }
    for (const branch of issue.errors ?? []) out.push(...nullPathsRefused(branch, args, path));
  }
  return out;
}

/** A copy of `args` without the keys at these paths. The caller's object is not changed. */
export function withoutKeys(args: unknown, paths: Path[]): unknown {
  const copy = structuredClone(args);
  for (const path of paths) {
    const parent = valueAt(copy, path.slice(0, -1));
    if (parent && typeof parent === 'object') delete (parent as Record<string | number, unknown>)[path[path.length - 1]];
  }
  return copy;
}

function holdsNull(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  return Object.values(v as Record<string, unknown>).some(holdsNull);
}

type Validate = (tool: { inputSchema?: unknown }, args: unknown, toolName: string) => Promise<unknown>;

/** Read a refused null on an optional field as the field left out, for every tool on `mcp`. */
export function treatNullAsAbsent(mcp: McpServer): void {
  const server = mcp as unknown as { validateToolInput: Validate };
  const original = server.validateToolInput.bind(mcp) as Validate;
  server.validateToolInput = async (tool, args, toolName) => {
    try {
      return await original(tool, args, toolName);
    } catch (err) {
      if (!tool.inputSchema || !holdsNull(args)) throw err;
      const schema = (normalizeObjectSchema(tool.inputSchema as AnySchema) ?? tool.inputSchema) as AnySchema;
      let repaired = args;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await safeParseAsync(schema, repaired);
        if (result.success) return result.data;
        const issues = ((result as { error?: { issues?: Issue[] } }).error?.issues) ?? [];
        const paths = nullPathsRefused(issues, repaired);
        if (paths.length === 0) break;
        repaired = withoutKeys(repaired, paths);
      }
      throw err;
    }
  };
}
