/**
 * @file generator-debug.ts
 * @description Debug artifact writer for the service generator — saves prompts,
 *   generated code, test results, and logs to disk for easy debugging.
 *   Files are written to data/debug/generator/<projectId>/ in a structured
 *   folder layout with one subfolder per component.
 * @structure
 *   - GeneratorDebugWriter: per-project writer with methods for each artifact type
 *   - getDebugBasePath(): returns the base debug directory path
 *   - listDebugProjects(): lists all project IDs with debug data
 *   - listDebugFiles(): lists files for a specific project
 *   - readDebugFile(): reads a specific debug file
 *   - deleteDebugProject(): removes all debug data for a project
 * @usage
 *   import { GeneratorDebugWriter } from '../services/generator-debug.js';
 *   const debug = new GeneratorDebugWriter(projectId);
 *   await debug.writeComponentPrompt('ext-1', promptText);
 * @version-history
 *   v1.0.0 — 2026-03-23 — Initial implementation
 */

import { mkdir, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';

const DEBUG_BASE = join(process.cwd(), 'data', 'debug', 'generator');

/** Get the base debug directory path */
export function getDebugBasePath(): string {
  return DEBUG_BASE;
}

/**
 * Per-project debug writer. Creates folder structure and writes artifacts.
 * All writes are best-effort — failures are logged but don't throw.
 */
export class GeneratorDebugWriter {
  private projectPath: string;
  private logPath: string;

  constructor(private projectId: string) {
    this.projectPath = join(DEBUG_BASE, projectId);
    this.logPath = join(this.projectPath, 'logs', 'full-log.jsonl');
  }

  /** Ensure directory exists */
  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /** Write a file safely */
  private async safeWrite(filePath: string, content: string): Promise<void> {
    try {
      await this.ensureDir(join(filePath, '..'));
      await writeFile(filePath, content, 'utf-8');
    } catch (e) {
      console.error(`[generator-debug] Failed to write ${filePath}:`, (e as Error).message);
    }
  }

  /** Write project metadata (project record, interview spec, blueprint) */
  async writeProjectMeta(project: Record<string, unknown>, interviewSpec: unknown, blueprint: unknown): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'project.json'),
      JSON.stringify(project, null, 2),
    );
    if (interviewSpec) {
      await this.safeWrite(
        join(this.projectPath, 'interview-spec.json'),
        JSON.stringify(interviewSpec, null, 2),
      );
    }
    if (blueprint) {
      await this.safeWrite(
        join(this.projectPath, 'blueprint.json'),
        JSON.stringify(blueprint, null, 2),
      );
    }
  }

  /** Write the prompt sent to AI for component generation */
  async writeComponentPrompt(componentId: string, prompt: string): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'prompt.txt'),
      prompt,
    );
  }

  /** Write the AI-generated code */
  async writeComponentGenerated(componentId: string, code: string): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'generated.txt'),
      code,
    );
  }

  /** Write validation result */
  async writeValidation(componentId: string, result: Record<string, unknown>): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'validation.json'),
      JSON.stringify(result, null, 2),
    );
  }

  /** Write the test prompt sent to AI */
  async writeTestPrompt(componentId: string, prompt: string): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'test-prompt.txt'),
      prompt,
    );
  }

  /** Write AI-generated test code */
  async writeTestCode(componentId: string, code: string): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'test-code.js'),
      code,
    );
  }

  /** Write test execution result */
  async writeTestResult(componentId: string, result: Record<string, unknown>): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'components', componentId, 'test-result.json'),
      JSON.stringify(result, null, 2),
    );
  }

  /** Write fix round data */
  async writeFixRound(componentId: string, round: number, data: {
    fixPrompt?: string;
    fixResult?: string;
    validation?: Record<string, unknown>;
    testCode?: string;
    testResult?: Record<string, unknown>;
  }): Promise<void> {
    const dir = join(this.projectPath, 'components', componentId, `fix-round-${round}`);
    if (data.fixPrompt) await this.safeWrite(join(dir, 'fix-prompt.txt'), data.fixPrompt);
    if (data.fixResult) await this.safeWrite(join(dir, 'fix-result.txt'), data.fixResult);
    if (data.validation) await this.safeWrite(join(dir, 'validation.json'), JSON.stringify(data.validation, null, 2));
    if (data.testCode) await this.safeWrite(join(dir, 'test-code.js'), data.testCode);
    if (data.testResult) await this.safeWrite(join(dir, 'test-result.json'), JSON.stringify(data.testResult, null, 2));
  }

  /** Append a log entry (JSONL format — one JSON object per line) */
  async appendLog(entry: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ ...entry, timestamp: entry.timestamp || new Date().toISOString() }) + '\n';
    try {
      await this.ensureDir(join(this.projectPath, 'logs'));
      const { appendFile } = await import('node:fs/promises');
      await appendFile(this.logPath, line, 'utf-8');
    } catch (e) {
      console.error(`[generator-debug] Failed to append log:`, (e as Error).message);
    }
  }

  /** Write summary (overall result) */
  async writeSummary(summary: Record<string, unknown>): Promise<void> {
    await this.safeWrite(
      join(this.projectPath, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
  }
}

/* ── Admin API helpers ─────────────────────────────────────────────── */

/** List all project IDs that have debug data */
export async function listDebugProjects(): Promise<Array<{ projectId: string; createdAt: string; fileCount: number }>> {
  try {
    if (!existsSync(DEBUG_BASE)) return [];
    const entries = await readdir(DEBUG_BASE, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = join(DEBUG_BASE, entry.name);
        let createdAt = '';
        let fileCount = 0;
        try {
          const s = await stat(join(projectPath, 'project.json'));
          createdAt = s.mtime.toISOString();
        } catch { /* */ }
        try {
          fileCount = (await readdir(projectPath, { recursive: true })).length;
        } catch { /* */ }
        projects.push({ projectId: entry.name, createdAt, fileCount });
      }
    }
    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** List all files for a specific project (relative paths) */
export async function listDebugFiles(projectId: string): Promise<string[]> {
  const projectPath = join(DEBUG_BASE, projectId);
  try {
    if (!existsSync(projectPath)) return [];
    const files = await readdir(projectPath, { recursive: true });
    // Filter to files only (exclude directories) and normalize path separators
    const result = [];
    for (const f of files) {
      const fullPath = join(projectPath, f as string);
      try {
        const s = await stat(fullPath);
        if (s.isFile()) {
          result.push((f as string).split(sep).join('/'));
        }
      } catch { /* */ }
    }
    return result.sort();
  } catch {
    return [];
  }
}

/** Read a specific debug file */
export async function readDebugFile(projectId: string, filePath: string): Promise<string | null> {
  // Prevent path traversal
  const normalizedPath = filePath.replace(/\.\./g, '').replace(/^\//, '');
  const fullPath = join(DEBUG_BASE, projectId, normalizedPath);
  const resolvedRelative = relative(DEBUG_BASE, fullPath);
  if (resolvedRelative.startsWith('..') || resolvedRelative.includes('..')) return null;

  try {
    return await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/** Delete all debug data for a project */
export async function deleteDebugProject(projectId: string): Promise<boolean> {
  const projectPath = join(DEBUG_BASE, projectId);
  // Prevent path traversal
  const resolvedRelative = relative(DEBUG_BASE, projectPath);
  if (resolvedRelative.startsWith('..') || resolvedRelative.includes('..')) return false;

  try {
    await rm(projectPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
