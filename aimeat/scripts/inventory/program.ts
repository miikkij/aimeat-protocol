/**
 * @file scripts/inventory/program.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The compiler's own view of `src/`, built once and the same way for every analyser and
 *   every gate that reads the source.
 *
 *   WHY IT IS SHARED. Nine scripts carried their own copy of these eight lines by 2026-09-04 — four
 *   gates and five inventory builders — and the copies had already drifted: some excluded
 *   `node_modules`, some did not, and each repeated the one line that is easy to leave out and
 *   impossible to notice missing.
 *
 *   THAT LINE IS `getTypeChecker()`. `createProgram` parses; it does not BIND, and `node.parent` is
 *   set by the binder. Without the call every parent is undefined, so any walk that asks "what
 *   encloses this" silently answers nothing — not an error, an empty result. It cost one analyser its
 *   enclosing-function attribution on the day it was written, and a copy that omits it looks exactly
 *   like a copy that does not.
 * @structure srcProgram(area?) — the program plus the source files under src/, optionally narrowed
 * @usage
 *   const { program, files } = srcProgram();                       // all of src/
 *   const { program, files } = srcProgram(/[/\\]src[/\\]routes[/\\]/);  // one area
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from the nine scripts that each had it.
 */
import ts from 'typescript';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `aimeat/`, from this file's own location rather than from the caller's cwd. */
export const AIMEAT = resolve(HERE, '..', '..');

export interface SrcProgram {
    program: ts.Program;
    /** Non-declaration files under src/, in the order the compiler lists them. */
    files: ts.SourceFile[];
}

/**
 * @param area optional pattern the file path must match, for a gate that only reads one part of the
 *   tree. Written against the full path, so it must allow both separators: `/[/\\]src[/\\]routes/`.
 */
export function srcProgram(area?: RegExp): SrcProgram {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Forces the binder to run, which is what sets `node.parent`. See the header: leaving this out
    // does not fail, it silently answers nothing.
    program.getTypeChecker();
    const files = program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && /[/\\]src[/\\]/.test(f.fileName)
        && !f.fileName.includes('node_modules')
        && (area === undefined || area.test(f.fileName)));
    return { program, files };
}
