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
 * @structure srcProgram(area?) — the program plus the source files under src/, optionally narrowed;
 *   GATE_SCAN_EXCLUDE + inGateScope() — all of src/ less tests, generated, static and data
 * @usage
 *   const { program, files } = srcProgram();                       // all of src/
 *   const { program, files } = srcProgram(/[/\\]src[/\\]routes[/\\]/);  // one area
 *   const scanned = srcProgram().files.filter(f => inGateScope(f.fileName));
 * @version-history
 *   v1.2.0 — 2026-10-18 — GATE_SCAN_EXCLUDE and inGateScope(): the identity gates scan all of src/
 *     less an exclusion list (wish wish-identiteettitarkistukset-kaupank-yntikoodiin-ja-kolmeen-muuh).
 *   v1.1.0 — 2026-09-05 — Built once per process. Five hook gates each built it (62 s of every
 *     commit), and check-invariants now runs them in one process against one program.
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
    const program = fullProgram();
    const files = program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && /[/\\]src[/\\]/.test(f.fileName)
        && !f.fileName.includes('node_modules')
        && (area === undefined || area.test(f.fileName)));
    return { program, files };
}

/**
 * What a gate that reads "all of src/" leaves out, each with its reason. An exclusion list rather than
 * an inclusion list, so a directory added tomorrow is scanned by default: until 2026-10-18 the two
 * identity gates named `routes|services|mcp`, and `src/commerce`, `src/auth`, `src/middleware`,
 * `src/tool-dispatch` and four more directories (24.6 % of the lines added since 2026-09-27) were
 * never read while both gates reported green.
 */
export const GATE_SCAN_EXCLUDE: ReadonlyArray<{ pattern: RegExp; why: string }> = [
    { pattern: /[/\\]__tests__[/\\]|\.test\.ts$/, why: 'unit tests: fixtures, not request handling' },
    { pattern: /\.generated\.ts$|[/\\]src[/\\]generated[/\\]/, why: 'generated: fixed by its generator, not by hand' },
    { pattern: /[/\\]src[/\\]static[/\\]/, why: 'static: served browser code, never sees a verified token' },
    { pattern: /[/\\]src[/\\]data[/\\]/, why: 'data: seeded content (skills, templates, catalogues)' },
];

/** Is this file inside the scan of a gate that reads all of src/ less GATE_SCAN_EXCLUDE? */
export function inGateScope(fileName: string): boolean {
    return /[/\\]src[/\\]/.test(fileName) && !GATE_SCAN_EXCLUDE.some(x => x.pattern.test(fileName));
}

let cached: ts.Program | undefined;

/**
 * The whole tree, built once per process. Building it is 8–10 s, and five gates in the pre-commit
 * hook each did so on their own: 62 s of one commit was the same parse repeated. `check-invariants`
 * runs them in one process, and every gate keeps working alone because the first call builds and
 * the rest reuse. `area` above narrows what a gate LOOKS at, never what the compiler binds, so the
 * cached program is a superset of what any single gate built for itself.
 */
function fullProgram(): ts.Program {
    if (cached) return cached;
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    cached = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Forces the binder to run, which is what sets `node.parent`. See the header: leaving this out
    // does not fail, it silently answers nothing.
    cached.getTypeChecker();
    return cached;
}
