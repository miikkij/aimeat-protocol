/**
 * @file test/unit/cold-agent-project-dir.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cold-agent scripts remove the `claude` CLI's project folder for the temporary
 *   directory they made, and nothing else (scripts/cold-agent/claude-project-dir.ts; instruction
 *   review 2026-11-14, M17). The folder names are the shapes measured under ~/.claude/projects.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectName, removeClaudeProjectDir } from '../../scripts/cold-agent/claude-project-dir.js';

const root = mkdtempSync(join(tmpdir(), 'aimeat-claude-projects-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function folder(name: string): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.jsonl'), '{}\n');
    return dir;
}

describe('the claude CLI project folder of a cold-agent run', () => {
    it('is named the way the CLI names it', () => {
        expect(claudeProjectName('C:\\Users\\alice\\AppData\\Local\\Temp\\aimeat-cold-agent-build-app-St6jdR'))
            .toBe('C--Users-alice-AppData-Local-Temp-aimeat-cold-agent-build-app-St6jdR');
        expect(claudeProjectName('E:\\dev\\repo\\.worktrees\\cc-alice-x')).toBe('E--dev-repo--worktrees-cc-alice-x');
        expect(claudeProjectName('/tmp/aimeat-ctx-large-a1_b')).toBe('-tmp-aimeat-ctx-large-a1-b');
    });

    it('is removed when it belongs to a temporary directory the caller made', () => {
        const prefix = 'C:\\Users\\alice\\AppData\\Local\\Temp\\aimeat-cold-agent-';
        const cwd = `${prefix}skill_x_1-Ab12Cd`;
        const dir = folder(claudeProjectName(cwd));
        expect(removeClaudeProjectDir(cwd, prefix, root)).toBe(true);
        expect(existsSync(dir)).toBe(false);
    });

    it('leaves every other folder alone, the bare prefix included', () => {
        const prefix = 'C:\\Users\\alice\\AppData\\Local\\Temp\\aimeat-cold-agent-';
        const repo = folder(claudeProjectName('E:\\dev\\repo'));
        expect(removeClaudeProjectDir('E:\\dev\\repo', prefix, root)).toBe(false);
        const bare = folder(claudeProjectName(prefix));
        expect(removeClaudeProjectDir(prefix, prefix, root)).toBe(false);
        expect(existsSync(repo) && existsSync(bare)).toBe(true);
        expect(removeClaudeProjectDir(`${prefix}missing-1`, prefix, root)).toBe(false);
    });
});
