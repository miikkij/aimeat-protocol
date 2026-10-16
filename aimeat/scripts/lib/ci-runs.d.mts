export interface WorkflowState {
    state: 'green' | 'red' | 'unknown';
    runId?: number; sha?: string; title?: string; url?: string; at?: string; conclusion?: string;
    redRuns?: number; redSince?: string; redAtLeast?: boolean;
    running?: { sha: string; url: string };
    failedJobs?: string[];
}
export interface CiState {
    slug: string; fetchedAt?: number; source: 'live' | 'cache' | 'stale' | 'none'; ageMs?: number; error?: string;
    ci: WorkflowState; nightly: WorkflowState;
}
export interface WorkflowRun {
    id: number; status: string; conclusion: string | null; head_sha: string; html_url: string;
    created_at: string; display_title?: string; event?: string; name?: string;
}
export const CI_WORKFLOW: string;
export const NIGHTLY_WORKFLOW: string;
export function repoSlug(cwd?: string): string;
export function cachePath(cwd?: string): string;
export function apiGet(path: string, query?: string): Promise<unknown>;
export function summarise(runs: WorkflowRun[]): WorkflowState;
export function readCiState(opts?: { cwd?: string; maxAgeMs?: number }): Promise<CiState>;
export function describeState(state: CiState): string[];
export function runsForCommit(slug: string, workflow: string, sha: string): Promise<WorkflowRun[]>;
