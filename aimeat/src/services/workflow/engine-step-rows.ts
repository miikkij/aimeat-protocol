/**
 * @file src/services/workflow/engine-step-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How an extension step's input and answers become rows, and how a datapackage step
 *   reads them: the input templated, an action called page by page or once per value with the
 *   answers merged, a dotted path walked, and a row flattened through a column mapping. Pure helpers,
 *   moved out of engine-steps.ts unchanged to satisfy max-file-lines.
 * @structure templateInput · runPaged · runForEach · mapColumns · atPath (setAtPath inside)
 * @usage  imported by engine-steps.ts dispatchExtensionStep() and dispatchDataPackageStep()
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved from engine-steps.ts unchanged, to keep that file under the 800-line
 *     limit.
 */
import type { SystemRunResult } from '../extension-system-run.js';
import { template } from './engine-util.js';
import type { WorkflowStep } from '../../models/workflow-schemas.js';

/**
 * Substitute `{var}` into the STRING leaves of a step's input, one level deep plus arrays of
 * strings. Numbers, booleans and nested objects pass through untouched: templating is for keys and
 * labels, and silently stringifying a number would make `{ window: 7 }` arrive as `"7"`.
 */
export function templateInput(input: Record<string, unknown> | undefined, vars: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === 'string') out[k] = template(v, vars);
    else if (Array.isArray(v)) out[k] = v.map(item => (typeof item === 'string' ? template(item, vars) : item));
    else out[k] = v;
  }
  return out;
}

/**
 * Call an action page by page and merge the pages into one result.
 *
 * WHY A STEP NEEDS THIS AT ALL. Real registries page. `laake-fi` caps at 500 rows on a set of 718,
 * so one call answers `truncated: true` and a package built from it holds five-sevenths of the data
 * with nothing anywhere saying so. Without paging the only honest choices were to publish a fraction
 * or to leave the producer unbound.
 *
 * The merged value KEEPS THE LAST PAGE'S ENVELOPE, with `items_at` replaced by every row collected,
 * plus two fields that did not exist before:
 *   - `pagesFetched`
 *   - `complete` — false when the loop stopped at `max_pages` rather than at the end of the data.
 *
 * `complete` is the point of the whole thing. "Did we get all of it" becomes something a
 * success_signal can assert, instead of something nobody checks until a consumer notices their
 * numbers are wrong.
 *
 * STOPPING is deliberately three conditions, because a producer may signal the end in any of them:
 * a short page, reaching the reported total, or the author's hard limit. The last one is required
 * rather than defaulted — a producer that never reports completion must not loop forever, and the
 * person who wrote the workflow is the one who knows how big their data can get.
 */
export async function runPaged(
  paging: NonNullable<Extract<NonNullable<WorkflowStep['action']>, { kind: 'extension' }>['paging']>,
  baseInput: Record<string, unknown>,
  call: (input: Record<string, unknown>, page: number) => Promise<SystemRunResult>,
): Promise<SystemRunResult> {
  const items: unknown[] = [];
  let last: SystemRunResult = { result: null, reads: [], writes: [] };
  const reads = new Set<string>();
  const writes = new Set<string>();
  let complete = false;
  let page = 0;

  for (; page < paging.max_pages; page++) {
    // A page that fails THROWS, which fails the step. Merging what arrived before it and calling
    // that a result is the covering fallback this design refuses everywhere else: the package would
    // be short and nothing would say why.
    last = await call({ ...baseInput, [paging.offset_param]: page * paging.page_size }, page + 1);
    for (const r of last.reads) reads.add(r);
    for (const w of last.writes) writes.add(w);

    const pageItems = atPath(last.result, paging.items_at);
    if (!Array.isArray(pageItems)) {
      throw new Error(`paging: nothing at "${paging.items_at}" on page ${page + 1} — the path is wrong, `
        + 'or the producer changed shape');
    }
    items.push(...pageItems);

    const total = paging.total_at ? Number(atPath(last.result, paging.total_at)) : NaN;
    const reachedTotal = Number.isFinite(total) && items.length >= total;
    // A short page is the end of the data for a producer that reports no total, and a harmless
    // extra stop condition for one that does.
    if (reachedTotal || pageItems.length < paging.page_size) { complete = true; page++; break; }
  }

  const merged = (last.result && typeof last.result === 'object')
    ? { ...(last.result as Record<string, unknown>) }
    : {} as Record<string, unknown>;
  setAtPath(merged, paging.items_at, items);
  merged.pagesFetched = page;
  merged.complete = complete;
  return { result: merged, reads: [...reads], writes: [...writes] };
}

/**
 * One row through a column mapping. No mapping means the row as it is.
 *
 * A path that is missing yields NULL rather than dropping the column: a row that lost a field is a
 * visible gap, not a table that changed shape between runs. An array at the end of a path becomes
 * one delimited cell rather than its first element — a notice carries several CPV codes, and a
 * column that says so beats one that hides the rest.
 */
export function mapColumns(row: Record<string, unknown>, columns: Record<string, string> | undefined): Record<string, unknown> {
  if (!columns) return row;
  const flat: Record<string, unknown> = {};
  for (const [column, path] of Object.entries(columns)) {
    const value = atPath(row, path);
    flat[column] = Array.isArray(value) ? value.join(';') : (value === undefined ? null : value);
  }
  return flat;
}

/**
 * Call an action once per value and merge the answers.
 *
 * THE OTHER SHAPE A REAL PRODUCER HAS. `kumppani` answers about ONE company per call, so a package
 * covering ten companies is ten calls. Paging varies an offset over one query; this varies a
 * parameter over a list. They share everything else, including the field that matters: `complete`,
 * so "did every call land" is assertable rather than assumed.
 *
 * A call that fails throws, which fails the step. Ten companies of which one could not be read is
 * not a package about ten companies, and quietly publishing nine is the loss this refuses.
 */
export async function runForEach(
  forEach: NonNullable<Extract<NonNullable<WorkflowStep['action']>, { kind: 'extension' }>['for_each']>,
  baseInput: Record<string, unknown>,
  vars: Record<string, string>,
  call: (input: Record<string, unknown>, n: number) => Promise<SystemRunResult>,
): Promise<SystemRunResult> {
  const items: unknown[] = [];
  const reads = new Set<string>();
  const writes = new Set<string>();
  let last: SystemRunResult = { result: null, reads: [], writes: [] };
  let done = 0;

  for (const raw of forEach.values) {
    const value = template(raw, vars);
    last = await call({ ...baseInput, [forEach.param]: value }, done + 1);
    for (const r of last.reads) reads.add(r);
    for (const w of last.writes) writes.add(w);

    const answerItems = atPath(last.result, forEach.items_at);
    if (!Array.isArray(answerItems)) {
      throw new Error(`for_each: nothing at "${forEach.items_at}" for ${forEach.param}=${value} — the path is `
        + 'wrong, or the producer changed shape');
    }
    items.push(...answerItems);
    done++;
  }

  const merged = (last.result && typeof last.result === 'object')
    ? { ...(last.result as Record<string, unknown>) }
    : {} as Record<string, unknown>;
  setAtPath(merged, forEach.items_at, items);
  merged.callsMade = done;
  // Every value was called or the loop threw, so reaching here IS completeness. It is written down
  // anyway, because a signal should be able to assert the same thing for paging and for this.
  merged.complete = done === forEach.values.length;
  return { result: merged, reads: [...reads], writes: [...writes] };
}

/** Write into a dotted path, creating the objects on the way. Only used to put the merged rows back
 *  where the producer had its page, so the envelope a signal reads keeps its shape. */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** Walk a dotted path into a value. Returns undefined the moment a segment is missing, so a caller
 *  can tell "the path is wrong" from "the array was empty" — which are different bugs. */
export function atPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cursor: unknown = value;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
