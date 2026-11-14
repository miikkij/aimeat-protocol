/**
 * @file scripts/cold-agent/claude-project-dir.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removes the per-directory project folder the `claude` CLI writes for a temporary
 *   working directory the cold-agent scripts made, once the run has its transcript.
 *
 *   WHY. Every `claude -p` call keeps its session under ~/.claude/projects/<the cwd, mangled>. The
 *   cold-agent runs and the large-context generator start each call in a fresh mkdtemp directory and
 *   delete that directory afterwards, but the project folder stayed: 858 folders under projects/ on
 *   the main machine by 2026-11-14, most of them `...-Temp-aimeat-cold-agent-*` and
 *   `...-Temp-aimeat-ctx-large-*`, each holding a transcript the run had already copied from stdout
 *   (instruction review 2026-11-14, M17).
 *
 *   SAFETY. The CLI names the folder by replacing every character that is not a letter or a digit
 *   with `-` (C:\Users\a\AppData\Local\Temp\aimeat-cold-agent-x becomes
 *   C--Users-a-AppData-Local-Temp-aimeat-cold-agent-x). Only a folder whose name starts with the
 *   mangled prefix of the temporary directories this caller makes, and is longer than it, is removed;
 *   any other name is left alone.
 * @structure claudeProjectName · claudeProjectsRoot · removeClaudeProjectDir
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The folder name the CLI gives a working directory: every non-alphanumeric character becomes `-`. */
export function claudeProjectName(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Where the CLI keeps its project folders: CLAUDE_CONFIG_DIR, or ~/.claude. */
export function claudeProjectsRoot(env: NodeJS.ProcessEnv = process.env): string {
    return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

/**
 * Remove the CLI's project folder for `cwd` when its name starts with the mangled `prefix` (the
 * mkdtemp prefix the caller used). True when a folder was removed.
 */
export function removeClaudeProjectDir(cwd: string, prefix: string, root: string = claudeProjectsRoot()): boolean {
    const name = claudeProjectName(cwd);
    const guard = claudeProjectName(prefix);
    if (!name.startsWith(guard) || name.length <= guard.length) return false;
    const dir = join(root, name);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
}
