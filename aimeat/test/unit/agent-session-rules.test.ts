/**
 * @file agent-session-rules.test.ts
 * @description `pnpm rules:for` (scripts/agent-session.mjs) names the same rule files Claude Code
 *   loads for a path, read from the rules' own `paths`, so an agent other than Claude Code gets the
 *   same rules (instruction audit, 2026-11-08).
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-session-rules.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-08 — findBash: Git Bash on Windows, never the WSL launcher in System32.
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { findBash, ruleFiles, rulesFor } from '../../scripts/agent-session.mjs';

const names = (paths: string[]) => rulesFor(paths).map((r: { file: string }) => r.file).sort();

describe('rules:for', () => {
    it('reads every rule file and each one names its paths', () => {
        const all = ruleFiles();
        expect(all.length).toBeGreaterThanOrEqual(10);
        for (const r of all) expect(r.paths.length, r.file).toBeGreaterThan(0);
    });

    it('names the backend and security rules for a route', () => {
        const hit = names(['aimeat/src/routes/apps/read.ts']);
        expect(hit).toContain('.claude/rules/backend.md');
        expect(hit).toContain('.claude/rules/security.md');
        expect(hit).not.toContain('.claude/rules/frontend.md');
    });

    it('names the frontend rule for a page, and accepts a Windows path', () => {
        expect(names(['aimeat\\public\\views\\home.js'])).toContain('.claude/rules/frontend.md');
    });

    it('names nothing for a file no rule covers', () => {
        expect(names(['README.md'])).toEqual([]);
    });
});

describe('the bash that runs the hooks', () => {
    const git = 'C:\\Program Files\\Git';
    const gitBash = `${git}\\bin\\bash.exe`;
    const onDisk = (paths: string[]) => (p: string) => paths.includes(p);

    it('is Git Bash on Windows, found from git --exec-path, never System32 (the WSL launcher)', () => {
        const found = findBash('win32', {}, onDisk([gitBash, 'C:\\Windows\\System32\\bash.exe']), () => 'C:/Program Files/Git/mingw64/libexec/git-core');
        expect(found).toBe(gitBash);
    });

    it('falls back to Program Files when git does not answer, and says null when there is no Git Bash', () => {
        expect(findBash('win32', { ProgramFiles: 'C:\\Program Files' }, onDisk([gitBash]), () => '')).toBe(gitBash);
        expect(findBash('win32', { ProgramFiles: 'C:\\Program Files' }, onDisk(['C:\\Windows\\System32\\bash.exe']), () => '')).toBeNull();
    });

    it('is plain bash elsewhere, and AIMEAT_BASH wins everywhere', () => {
        expect(findBash('linux', {}, () => false, () => '')).toBe('bash');
        expect(findBash('win32', { AIMEAT_BASH: 'D:\\tools\\bash.exe' }, () => false, () => '')).toBe('D:\\tools\\bash.exe');
    });
});
