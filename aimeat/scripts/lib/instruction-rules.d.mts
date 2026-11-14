/**
 * @file scripts/lib/instruction-rules.d.mts
 * @description Types for instruction-rules.mjs, so check-instructions.ts and its test can import it.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
export function liveCountProblems(text: string, file: string): string[];
export function missingAgentsRules(text: string): string[];
export function instructionPathProblems(text: string, file: string, exists: (p: string) => boolean): string[];
