/**
 * @file scripts/agent-session.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What Claude Code does for a session by itself, as commands any coding agent can run:
 *   Codex, Cursor, Copilot, Gemini CLI, OpenHands and the rest (AGENTS.md).
 *
 *   WHY. Claude Code runs `.claude/hooks/session-start.sh` when a session starts, makes a worktree
 *   with `.claude/hooks/worktree-create.sh`, and loads a rule from `.claude/rules/` when it opens a
 *   file the rule's `paths` name. Another agent got none of it and had to find the files itself
 *   (AGENTS.md said so), so the same repository gave two clients two different sets of rules and
 *   checks. The instruction audit of 2026-11-08 named that difference. These commands run the same
 *   scripts and read the same rule files, so there is one source and nothing to keep in step.
 *
 *     pnpm agent:start                 what the SessionStart hook prints: the ritual, the session
 *                                      name, the worktree, main's CI and the board to read
 *     pnpm agent:worktree <name>       .worktrees/<name> at origin/main with its own install and
 *                                      test environment, as the WorktreeCreate hook makes it
 *     pnpm rules:for <path> [<path>…]  the rule files that cover these paths, to read before the edit
 * @structure ruleFiles() · rulesFor(paths) · findBash() · main
 * @usage cd aimeat && pnpm rules:for src/routes/apps/read.ts public/views/home.js
 * @version-history
 *   v1.1.0 — 2026-11-08 — The hooks run in Git Bash on Windows, found from `git --exec-path`, never the
 *     first `bash` on PATH, which is the WSL launcher in System32 (instruction audit re-check, round 2).
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, matchesGlob, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = join(ROOT, '.claude', 'rules');
const HOOKS = join(ROOT, '.claude', 'hooks');
// pnpm sets INIT_CWD to where the command was typed, which the root package.json's `cd aimeat` hides.
const CALLER_CWD = process.env.INIT_CWD || process.cwd();

/** Every rule file with the globs of its frontmatter `paths`. */
export function ruleFiles() {
    return readdirSync(RULES).filter(f => f.endsWith('.md')).map(f => {
        const text = readFileSync(join(RULES, f), 'utf8');
        const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        const paths = [...head.matchAll(/^\s*-\s*["']?([^"'\r\n]+)["']?\s*$/gm)].map(m => m[1].trim());
        return { file: `.claude/rules/${f}`, paths };
    });
}

/** The rule files whose `paths` cover at least one of the given repository paths. */
export function rulesFor(repoPaths) {
    const norm = repoPaths.map(p => p.replace(/\\/g, '/').replace(/^\.\//, ''));
    return ruleFiles().filter(r => r.paths.some(g => norm.some(p => matchesGlob(p, g))));
}

/**
 * The bash that runs the hooks. On Windows this is Git Bash, found from git itself, never the first
 * `bash` on PATH: that is C:\Windows\System32\bash.exe, the WSL launcher, which runs the hook in a
 * Linux distribution (or fails when none is installed) with a different git and different paths.
 * The re-check of the instruction audit (2026-11-08) found exactly that order on this machine.
 * AIMEAT_BASH names another bash. Returns null when no Git Bash is found.
 */
export function findBash(platform = process.platform, env = process.env, exists = existsSync, gitExecPath = () => {
    const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
}) {
    if (env.AIMEAT_BASH) return env.AIMEAT_BASH;
    if (platform !== 'win32') return 'bash';
    const candidates = [];
    // `<git>/mingw64/libexec/git-core` (or `<git>/libexec/git-core`): Git's root is above `mingw64`.
    const execPath = gitExecPath();
    if (execPath) {
        const root = execPath.replace(/[\\/]+$/, '').replace(/[\\/](?:mingw64|mingw32|clangarm64)?[\\/]?libexec[\\/]git-core$/i, '');
        candidates.push(win32.join(root, 'bin', 'bash.exe'), win32.join(root, 'usr', 'bin', 'bash.exe'));
    }
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs')]) {
        if (base) candidates.push(win32.join(base, 'Git', 'bin', 'bash.exe'));
    }
    return candidates.find(p => exists(p)) ?? null;
}

function runHook(script, input) {
    const bash = findBash();
    if (!bash) {
        console.error(`Could not find Git Bash to run ${script}. Install Git for Windows (it ships bin\\bash.exe), or set AIMEAT_BASH to a bash.exe. The bash in C:\\Windows\\System32 is WSL and is not used.`);
        process.exit(1);
    }
    const r = spawnSync(bash, [join(HOOKS, script)], { cwd: ROOT, input, stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.error) {
        console.error(`Could not run ${bash} for ${script} (${r.error.message}). Set AIMEAT_BASH to a working bash.`);
        process.exit(1);
    }
    process.exit(r.status ?? 1);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'start') {
    // No JSON on stdin: the hook then prints no Claude Code session id, and everything else.
    runHook('session-start.sh', '');
} else if (cmd === 'worktree') {
    const name = args[0];
    if (!name) { console.error('Usage: pnpm agent:worktree <name>   (for example agent-<you>-<tag>)'); process.exit(1); }
    runHook('worktree-create.sh', JSON.stringify({ worktree_name: name, cwd: ROOT }));
} else if (cmd === 'rules') {
    if (args.length === 0) { console.error('Usage: pnpm rules:for <path> [<path>…]   (paths of the files you will edit)'); process.exit(1); }
    const repoPaths = args.map(a => relative(ROOT, resolve(CALLER_CWD, a)));
    const hits = rulesFor(repoPaths);
    if (hits.length === 0) console.log('No path rule covers these files. CLAUDE.md and AGENTS.md still apply.');
    else {
        console.log('Read these before you edit (Claude Code loads them by itself; you read them):');
        for (const r of hits) console.log(`  ${r.file}`);
    }
} else if (cmd !== undefined) {
    console.error(`Unknown command "${cmd}". Use start, worktree <name> or rules <path…>.`);
    process.exit(1);
}
