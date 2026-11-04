/**
 * @file scripts/lib/private-terms.d.mts
 * @description Types for private-terms.mjs, so TypeScript tests can import it.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
export interface Line { where: string; text: string }
export interface Compiled { term: string; needle: string; re: RegExp }
export interface Hit { where: string; term: string; text: string }
export function parseTerms(text: string): string[];
export function compileTerms(terms: string[]): Compiled[];
export function findHits(lines: Iterable<Line>, compiled: Compiled[]): Hit[];
export function addedLines(out: string): Line[];
export function deriveTerms(input: {
    host?: string; nodeId?: string;
    people?: { name?: string; id?: string }[];
    apps?: { name?: string; filename?: string }[];
    organisms?: string[]; extra?: string[];
}): string[];
