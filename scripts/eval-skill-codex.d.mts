/**
 * @file scripts/eval-skill-codex.d.mts
 * @description Types for eval-skill-codex.mjs, so its unit test (aimeat/test/unit/eval-skill-codex.test.ts) can import it.
 * @version-history
 *   v1.0.0 -- 2026-11-26 -- Initial.
 */
export class CodexEvalError extends Error {}
export interface Grader { file: string; type: 'regex' | 'llm' | 'tool_used'; pattern?: string; flags?: string; match?: 'contains' | 'not_contains'; tool?: string; rubric?: string }
export interface EvalCase { name: string; prompt: string; meta: Record<string, unknown> & { runs?: number; timeout_seconds?: number }; graders: Grader[] }
export interface GraderResult { file: string; pass: boolean; indicator?: boolean; why?: string }
export interface CodexOptions { runs?: number; model?: string; judgeModel?: string; caseGlob?: string; concurrency: number; dryRun: boolean }
export function parseFrontmatter(text: string): { meta: Record<string, any>; body: string };
export function loadSuite(suiteDir: string, caseGlob?: string): EvalCase[];
export function gradeRegex(grader: Pick<Grader, 'pattern' | 'flags' | 'match'>, answer: string): boolean;
export function readEvents(jsonl: string): { commands: string[]; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number } };
export function skillFired(commands: string[], name: string): boolean;
export function scoreRun(graders: Grader[], answer: string, judged: Record<string, { pass: boolean; why?: string }>, fired: boolean): { score: number; results: GraderResult[] };
export function planCalls(cases: EvalCase[], runs: number): number;
export function writeCodexHome(home: string, paths?: { realHome?: string; userSkills?: string }): string;
export function syncAuthBack(home: string, original: string, realHome?: string): 'unchanged' | 'copied back' | 'both changed';
export function parseCodexArgs(argv: string[]): CodexOptions;
export function runCodexEval(args: { skill: { name: string; dir?: string; skillMd?: string }; suiteDir: string; options: CodexOptions; log?: (line: string) => void }): Promise<unknown>;
