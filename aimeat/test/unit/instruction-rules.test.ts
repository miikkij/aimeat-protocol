/**
 * @file test/unit/instruction-rules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text rules of `pnpm check:instructions` (scripts/lib/instruction-rules.mjs), on the
 *   sentences the instruction review of 2026-11-14 found and on the ones that must pass.
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
import { describe, expect, it } from 'vitest';
import { instructionPathProblems, liveCountProblems, missingAgentsRules } from '../../scripts/lib/instruction-rules.mjs';

describe('a live count in CLAUDE.md', () => {
    it('refuses the counts that went stale', () => {
        expect(liveCountProblems('the **Platform Development Notes** workspace (`ws-mslunjvcgxj`, 166 documents)', 'CLAUDE.md')).toHaveLength(2);
        expect(liveCountProblems('**App Development Notes** (`ws-mslr8u99kzk`, 44).', 'CLAUDE.md')).toHaveLength(1);
        expect(liveCountProblems('so they are current: 57 live on aimeat.io', 'CLAUDE.md')).toHaveLength(1);
        expect(liveCountProblems('43 archived notes discuss MongoDB', 'CLAUDE.md')[0]).toContain('CLAUDE.md:1');
    });

    it('passes a rule, a size, a date and a small fixed number', () => {
        const fine = [
            'a subject of at most 72 characters and a body of at most 600',
            'listing every app origin passed with 2 apps and took down every app subdomain at 76',
            'Up to eight Claude Code sessions; three owners; port 40050; on 2026-11-04',
        ].join('\n');
        expect(liveCountProblems(fine, 'CLAUDE.md')).toEqual([]);
    });
});

describe('what AGENTS.md has to carry', () => {
    it('names each rule it leaves out', () => {
        expect(missingAgentsRules('# AGENTS.md\nRead CLAUDE.md.')).toHaveLength(2);
    });

    it('passes when both rules are there', () => {
        const text = '## This repository is public\nNothing names an organisation node.\nAsk first: release tags and CI builds.';
        expect(missingAgentsRules(text)).toEqual([]);
    });
});

describe('a backticked repository path', () => {
    const tree = new Set(['scripts/git-commit.sh', 'src/tool-dispatch/index.ts', '.claude/rules']);
    const exists = (p: string) => tree.has(p);

    it('refuses a path that names nothing', () => {
        const problems = instructionPathProblems('the wrapper is in `src/cli/connect/tool-call.ts:120`.', '.claude/agents/x.md', exists);
        expect(problems).toEqual(['.claude/agents/x.md:1 names `src/cli/connect/tool-call.ts`, which is not in the repository.']);
    });

    it('passes a real path and everything that is not a path', () => {
        const text = [
            '`bash scripts/git-commit.sh <file>` and `scripts/git-commit.sh`, `src/tool-dispatch/index.ts:165`, `.claude/rules/`',
            '`https://example.com/x`, `node:aimeat-dev-session`, `user:alice/skill`, `/v1/mcp`, `~/.claude/projects`',
            '`origin/main`, `.worktrees/<name>`, `src/**/x.ts`, `{a,b}/c`, `cc-<owner>-<tag>`, `../docs/internal/`',
        ].join('\n');
        expect(instructionPathProblems(text, 'AGENTS.md', exists)).toEqual([]);
    });
});
