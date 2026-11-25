/**
 * @file scripts/lib/instruction-rules.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text rules `pnpm check:instructions` holds the instruction files to, as pure
 *   functions so a unit test can feed them a sentence.
 *
 *   WHY. The instruction review of 2026-11-14 found the same three kinds of decay by reading:
 *   - LIVE COUNTS. CLAUDE.md said Platform Development Notes held 166 documents when the node had
 *     504, and App Development Notes 44 when it had 151. A count of something that grows by design
 *     is wrong a week after it is written, and the reader cannot tell which numbers still hold.
 *   - AGENTS.MD LOST THE RULES THAT BITE. The file for Codex, Cursor and the rest did not say the
 *     repository is public or that a release tag waits for the developer, so an agent that reads only
 *     it could name an organisation node in a commit or tag a release.
 *   - PATHS THAT MOVED. A rule pointed at `withDeclaredInputOnly` in a file it had left; agent files
 *     named paths nobody checked.
 *   - REPLACED RULES STAYED. On 2026-11-25 AGENTS.md still said `pnpm ready` ran on GitHub on a
 *     ready/<session> branch and that the full sweep waited for approval, and three guides still
 *     named `pnpm gate` as the last step, ten days after CLAUDE.md replaced both.
 * @structure liveCountProblems(text, file) · missingAgentsRules(text) ·
 *   supersededProblems(text, file) · instructionPathProblems(text, file, exists)
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (instruction review 2026-11-14, TP8.1 and TP8.5).
 *   v1.1.0 -- 2026-11-26 -- AGENTS.md must carry the merge rule, and supersededProblems() refuses a
 *     line that states a rule CLAUDE.md has replaced (wish-same-repo-tooling-for-codex-and-claude-code-agents-md-held-t).
 */

/**
 * A number of ten or more followed, within one word, by a noun for something the node or the repo
 * accumulates; or a count written after a workspace id (`ws-…`, 44).
 */
const LIVE_COUNT = /\b\d{2,}(?:,\d{3})*\s+(?:[a-z-]+\s+)?(?:documents|docs|notes|boards|apps|records|skills|worktrees|wishes|incidents|claims|members|organisms)\b/gi;
const LIVE_LIVE = /\b\d{2,}(?:,\d{3})*\s+live\b/gi;
const WS_COUNT = /`ws-[a-z0-9]+`\s*,\s*\d+/g;

/**
 * Every live count in an always-loaded instruction file.
 * @param {string} text
 * @param {string} file
 * @returns {string[]}
 */
export function liveCountProblems(text, file) {
    const out = [];
    text.split('\n').forEach((line, i) => {
        for (const re of [LIVE_COUNT, LIVE_LIVE, WS_COUNT]) {
            for (const m of line.matchAll(re)) {
                out.push(`${file}:${i + 1} carries a live count ("${m[0]}"), which grows by design and goes stale. Name the place and let the reader count.`);
            }
        }
    });
    return out;
}

/** What AGENTS.md has to say, because an agent that reads only it must not miss these. */
const AGENTS_RULES = [
    { what: 'the public-repository rule ("This repository is public" and that no organisation node is named)', test: (t) => /this repository is public/i.test(t) && /organisation node/i.test(t) },
    { what: 'the release-tag rule (release tags and CI builds wait for the developer)', test: (t) => /release tags?/i.test(t) && /CI builds?/i.test(t) },
    { what: 'the merge rule (finished work reaches main through `pnpm ready`, and nobody is asked)', test: (t) => /`pnpm ready`/.test(t) && /nobody is asked/i.test(t) },
];

/**
 * Statements CLAUDE.md has replaced. Each one stood in AGENTS.md or a guide for days after the rule
 * moved, and an agent that read it there did the old thing: asked before a sweep nobody runs by hand,
 * or ran `pnpm gate` as the last step. Matched per line, so a sentence that names the old command in
 * another sense (`pnpm gate` as a local picture) passes.
 */
const SUPERSEDED = [
    { re: /ready\/<session>/i, now: '`pnpm ready` runs on this machine, and the public origin takes no branch but main (CLAUDE.md, Git, 2026-11-22)' },
    { re: /`pnpm ready`[^.\n]*\bon GitHub\b/i, now: '`pnpm ready` runs on this machine, and the public origin takes no branch but main (CLAUDE.md, Git, 2026-11-22)' },
    { re: /\bgreen (?:`pnpm )?gate`? is what\b/i, now: 'a green `pnpm ready` is what "done" needs (CLAUDE.md, Git, 2026-11-15)' },
    { re: /`pnpm gate` (?:once|is what says)/i, now: 'finished work runs `pnpm check:fast` once, then `pnpm ready` (CLAUDE.md, Git, 2026-11-15)' },
    { re: /\bfull (?:E2E )?sweep\b[^.\n]*(?:approv|asks for it)/i, now: 'nobody starts the full sweep by hand: `pnpm ready` runs it when the change needs it and the nightly every night (CLAUDE.md, Git and Gates)' },
    { re: /\bask first\b[^.\n]*\bfull (?:E2E )?sweep\b/i, now: 'nobody starts the full sweep by hand: `pnpm ready` runs it when the change needs it and the nightly every night (CLAUDE.md, Git and Gates)' },
];

/**
 * Lines that still state a rule CLAUDE.md has replaced.
 * @param {string} text
 * @param {string} file
 * @returns {string[]}
 */
export function supersededProblems(text, file) {
    const out = [];
    text.split('\n').forEach((line, i) => {
        for (const s of SUPERSEDED) {
            const m = s.re.exec(line);
            if (m) out.push(`${file}:${i + 1} states a replaced rule ("${m[0]}"). Now: ${s.now}.`);
        }
    });
    return out;
}

/**
 * The rules AGENTS.md leaves out.
 * @param {string} text
 * @returns {string[]}
 */
export function missingAgentsRules(text) {
    return AGENTS_RULES.filter((r) => !r.test(text)).map((r) => `AGENTS.md does not carry ${r.what}.`);
}

/** A backticked token that reads as a path inside the repository. */
const TICKED = /`([^`\s]+)`/g;

/**
 * Backticked repository paths that name nothing. A token counts as a path when it holds a `/`, is
 * not a URL, an absolute path, a route, a skill ref or a placeholder, and has no glob or brace.
 * `exists(p)` answers for a path relative to the repository root or to `aimeat/`.
 * @param {string} text
 * @param {string} file
 * @param {(p: string) => boolean} exists
 * @returns {string[]}
 */
export function instructionPathProblems(text, file, exists) {
    const out = [];
    text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(TICKED)) {
            let token = m[1].replace(/[.,;:)]+$/, '').replace(/:\d+(?:-\d+)?$/, '');
            if (!token.includes('/')) continue;
            if (/^[a-z][a-z0-9+.-]*:/i.test(token)) continue;          // https://, node:, user:, app:
            if (/^[/~$\\]|^\.\.?\//.test(token)) continue;            // absolute, home, variable, relative
            if (/[<>*{}[\]|=?]/.test(token)) continue;                 // placeholder, glob, brace, query
            if (/^(?:v\d|[A-Z][A-Za-z]*\/)/.test(token)) continue;      // a route or a ref like Session/…
            if (/^(?:origin|upstream|refs|HEAD)\//.test(token)) continue; // a git ref
            token = token.replace(/\/$/, '');
            if (!exists(token)) out.push(`${file}:${i + 1} names \`${token}\`, which is not in the repository.`);
        }
    });
    return out;
}
