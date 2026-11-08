/**
 * @file agent-session-rules.test.ts
 * @description `pnpm rules:for` (scripts/agent-session.mjs) names the same rule files Claude Code
 *   loads for a path, read from the rules' own `paths`, so an agent other than Claude Code gets the
 *   same rules (instruction audit, 2026-11-08).
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-session-rules.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ruleFiles, rulesFor } from '../../scripts/agent-session.mjs';

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
