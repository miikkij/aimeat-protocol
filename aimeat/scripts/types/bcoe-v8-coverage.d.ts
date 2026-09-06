/**
 * @file scripts/types/bcoe-v8-coverage.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of @bcoe/v8-coverage 1.x, which ships JavaScript and no declaration. Only
 *   what scripts/e2e-coverage.ts calls; the types mirror the V8 inspector's Profiler.ScriptCoverage.
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial.
 */
declare module '@bcoe/v8-coverage' {
    export interface RangeCov { startOffset: number; endOffset: number; count: number }
    export interface FunctionCov { functionName: string; ranges: RangeCov[]; isBlockCoverage: boolean }
    export interface ScriptCov { scriptId: string; url: string; functions: FunctionCov[] }
    export interface ProcessCov { result: ScriptCov[] }
    export function mergeProcessCovs(processCovs: ReadonlyArray<ProcessCov>): ProcessCov;
}
