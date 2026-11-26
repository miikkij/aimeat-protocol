/**
 * @file src/services/owner-export/json-stream.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description JSON text a piece at a time, for a value whose lists are read in pages (ExportList).
 *   JSON.stringify of the whole export built one string, and on the largest account of a production
 *   node that string passed V8's limit (RangeError: Invalid string length, 2026-11-26). Here each plain
 *   value is stringified on its own and an ExportList is written as an array an element at a time, so
 *   no string is larger than one element, and the caller writes each piece to a response or a ZIP entry
 *   as it comes, waiting for the stream to take it (backpressure is the caller's).
 * @structure jsonPieces(value) · sectionsAsJsonObject(sections, prefix?) · ndjsonPieces(list)
 * @usage
 *   for await (const piece of sectionsAsJsonObject(ownerExportSections(...))) res.write(piece);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { ExportList } from './account-sections.js';

/** A plain object one of whose values is an ExportList: it is written key by key. */
function holdsList(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof ExportList)
    && Object.values(v as Record<string, unknown>).some(x => x instanceof ExportList);
}

/** The JSON text of `value`, in pieces. Plain values exactly as JSON.stringify writes them. */
export async function* jsonPieces(value: unknown): AsyncGenerator<string> {
  if (value instanceof ExportList) {
    yield '[';
    let first = true;
    for await (const item of value.items()) {
      if (!first) yield ',';
      first = false;
      yield* jsonPieces(item);
    }
    yield ']';
    return;
  }
  if (holdsList(value)) {
    yield '{';
    let first = true;
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      yield `${first ? '' : ','}${JSON.stringify(k)}:`;
      first = false;
      yield* jsonPieces(v);
    }
    yield '}';
    return;
  }
  // undefined as an element writes null, as JSON.stringify does inside an array.
  yield JSON.stringify(value) ?? 'null';
}

/**
 * The sections as one JSON object `{"key":value,…}`, after `prefix` (the envelope's opening, for the
 * REST route), and closed with `suffix`.
 */
export async function* sectionsAsJsonObject(
  sections: AsyncIterable<[string, unknown]>, prefix = '{', suffix = '}',
): AsyncGenerator<string> {
  yield prefix;
  let first = true;
  for await (const [key, value] of sections) {
    if (value === undefined) continue;
    yield `${first ? '' : ','}${JSON.stringify(key)}:`;
    first = false;
    yield* jsonPieces(value);
  }
  yield suffix;
}

/** One JSON line per element of a list, for an NDJSON file. */
export async function* ndjsonPieces(items: AsyncIterable<unknown>): AsyncGenerator<string> {
  for await (const item of items) {
    let line = '';
    for await (const piece of jsonPieces(item)) line += piece;
    yield `${line}\n`;
  }
}
