/**
 * @file check-instructions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Guard for what Claude Code loads into every session before it has done anything.
 *   Two things are checked.
 *
 *   THE ALWAYS-LOADED SIZE. CLAUDE.md, plus any .claude/rules file without `paths`, enters the
 *   context of every session and of every subagent except Explore and Plan. On 2026-09-13 the root
 *   file was 58,475 bytes, about 14.6k tokens, of which roughly 32 kB applied only when certain code
 *   was touched; it had taken 87 commits since 2026-08-01, and nothing stopped the next sentence
 *   from landing there too. The path-specific half moved verbatim into .claude/rules/, and this
 *   ceiling holds the rest. Raising it is a decision to make out loud, never a way to get a commit
 *   through: first ask whether the new sentence holds in every session, whatever the session touches.
 *
 *   EVERY `paths` PATTERN MATCHES A TRACKED FILE. A path rule or skill whose glob names nothing
 *   never loads, and nothing says so. The skill aimeat-frontend-verify named `public/locales`, a
 *   directory that does not exist, until the same day.
 * @structure
 *   - trackedFiles(): `git ls-files` from the repository root
 *   - frontmatterPaths(text): the `paths` list of a markdown file's YAML frontmatter, or null
 *   - main(): always-loaded bytes vs CEILING_BYTES; every pattern of every rule and skill vs the tree
 * @usage
 *   cd aimeat && pnpm check:instructions      # gate (check:fast, CI)
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (wish-claude-code-scoped-to-this-repo-smaller-always-loaded-instru).
 *   v1.0.1 — 2026-09-14 — Ceiling 38,000 → 39,000 for the reply-language rules.
 *   v1.1.0 — 2026-09-19 — Three more checks, from finding H16 of the instruction review: every rule
 *     file is named in CLAUDE.md's table, CLAUDE.md carries no em-dash, and every `pnpm <script>`
 *     the root file, the rules, the skills and the agents name is defined in a package.json.
 *   v1.1.1 — 2026-09-27 — Ceiling 39,500 → 40,500 for the docs/internal plans rule.
 *   v1.1.2 — 2026-10-04 — Ceiling 40,500 → 40,800 for the rule that a mentioned place comes with its URL.
 *   v1.1.3 — 2026-10-18 — Ceiling 40,800 → 41,000 for the rule that live data is an event, never a poll.
 *   v1.1.4 -- 2026-11-01 -- Ceiling 41,200 -> 41,700 for the rule that the IT adoption package stays true to the code.
 *   v1.1.5 -- 2026-11-04 -- Ceiling 41,700 -> 43,000 for the rule that this public repository names no organisation node.
 *   v1.1.6 -- 2026-11-11 -- Ceiling 43,000 -> 44,000 for two rules: a fix covers the whole defect, and a session's commit message is short.
 *   v1.2.0 -- 2026-11-15 -- From the instruction review of 2026-11-14 (TP8.1, TP8.5): the agent files
 *     and AGENTS.md are held to the em-dash ban and their backticked repository paths must exist;
 *     AGENTS.md must carry the public-repository rule and the release-tag rule; CLAUDE.md and
 *     AGENTS.md carry no live count that grows by design. Ceiling 44,000 -> 36,000 after content
 *     that holds only for some work moved into the rule files and guides.
 *   v1.2.1 -- 2026-11-15 -- The em-dash ban also reads every skill's references/*.md, where the
 *     skill splits of the same day had moved text that nothing checked.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { instructionPathProblems, liveCountProblems, missingAgentsRules } from './lib/instruction-rules.mjs';

const REPO = join(process.cwd(), '..');
const CLAUDE_MD = join(REPO, 'CLAUDE.md');
const AGENTS_MD = join(REPO, 'AGENTS.md');
const RULES_DIR = join(REPO, '.claude', 'rules');
const SKILLS_DIR = join(REPO, '.claude', 'skills');

/**
 * Seeded 2026-09-13 with CLAUDE.md at 36,698 bytes after the split, plus room for a few sentences.
 * A session start carries this file, the SessionStart hook's output and the harness's own prompt;
 * this is the part the repository decides.
 * Raised to 39,000 on 2026-09-14, at Jouni's request, for the two reply-language rules (STE100 and
 * selkeä kieli), which hold in every session.
 * Raised to 39,500 on 2026-09-23, at Jouni's request, for the rule under "Accepting a result" that a
 * look-keeping change passes only with no visible difference and his words are never paraphrased,
 * which holds in every session.
 * Raised to 40,500 on 2026-09-27, at Jouni's request, for the rule that plans live in the main
 * checkout's docs/internal/ and never in a worktree's, which holds in every session.
 * Raised to 40,800 on 2026-10-04, at Jouni's request, for the rule that every place a reply mentions
 * comes with its URL, which holds in every session.
 * Raised to 41,000 on 2026-10-18, at Jouni's request, for the rule that live data arrives as an event
 * over the existing SSE stream and never by polling, which holds in every session.
 * Raised to 41,200 on 2026-10-25 for Jouni's ruling that a session's sandbox gets his OpenRouter test
 * key and model without asking ("I gave the key exactly for this"), which holds in every session.
 * Raised to 41,700 on 2026-11-01, at Jouni's request, for the rule that the IT adoption package
 * stays true to the code ("tämä on tärkeä"), which holds in every session: any change to a setting,
 * a default or a security control can make one of its pages false.
 * Raised to 44,000 on 2026-11-11 for two rules the developer asked for after a fix was reported with
 * part of its defect left for a second session: a fix covers the whole defect, and a session's
 * commit message is short and names no approval. Both hold in every session.
 * Lowered to 36,000 on 2026-11-15, when the instruction review moved about 11 kB that held only for
 * some work into the rule files, the guides and the node skill (CLAUDE.md went from 43,927 bytes to
 * about 33,000). The ceiling keeps that room for rules that hold in every session.
 */
const CEILING_BYTES = 36_000;

function trackedFiles(): string[] {
    return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n')
        .filter(Boolean);
}

/** The `paths` list from YAML frontmatter; null when the file has no frontmatter or no `paths` key. */
function frontmatterPaths(text: string): string[] | null {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) return null;
    const lines = fm[1].split('\n');
    const start = lines.findIndex((l) => /^paths:\s*$/.test(l));
    if (start < 0) return null;
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
        const item = /^\s+-\s+(?:"([^"]*)"|'([^']*)'|(\S.*))\s*$/.exec(l);
        if (!item) break;
        out.push(item[1] ?? item[2] ?? item[3]);
    }
    return out;
}

function markdownFiles(dir: string, match: (name: string) => boolean): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...markdownFiles(full, match));
        else if (match(entry.name)) out.push(full);
    }
    return out;
}

function main(): void {
    const problems: string[] = [];
    const rel = (p: string): string => p.slice(REPO.length + 1).replaceAll('\\', '/');

    const rules = markdownFiles(RULES_DIR, (n) => n.endsWith('.md'));
    const skills = markdownFiles(SKILLS_DIR, (n) => n === 'SKILL.md');

    let alwaysLoaded = Buffer.byteLength(readFileSync(CLAUDE_MD, 'utf-8'));
    const unscoped: string[] = [];
    for (const rule of rules) {
        const text = readFileSync(rule, 'utf-8');
        const paths = frontmatterPaths(text);
        if (paths === null || paths.length === 0) {
            alwaysLoaded += Buffer.byteLength(text);
            unscoped.push(rel(rule));
        }
    }

    console.log('');
    console.log('  What every session loads before it starts');
    console.log('  ' + '─'.repeat(62));
    console.log(`  CLAUDE.md${unscoped.length ? ` + ${unscoped.length} rule file(s) without paths` : ''}: ${alwaysLoaded} bytes, ceiling ${CEILING_BYTES}`);
    if (alwaysLoaded > CEILING_BYTES) {
        problems.push(
            `Always-loaded instructions are ${alwaysLoaded} bytes, over the ${CEILING_BYTES} ceiling. `
            + 'Move what applies only to certain files into a .claude/rules/ file with `paths`, '
            + 'or raise CEILING_BYTES in this script with the reason in the same change.',
        );
    }

    const tree = trackedFiles();
    let patterns = 0;
    for (const file of [...rules, ...skills]) {
        const paths = frontmatterPaths(readFileSync(file, 'utf-8')) ?? [];
        for (const pattern of paths) {
            patterns++;
            if (!tree.some((t) => matchesGlob(t, pattern))) {
                problems.push(`${rel(file)}: paths pattern "${pattern}" matches no tracked file, so the file never loads.`);
            }
        }
    }
    console.log(`  ${rules.length} rule file(s), ${skills.length} skill(s), ${patterns} paths pattern(s) checked against ${tree.length} tracked files`);

    // THE ROOT FILE AGREES WITH ITSELF AND WITH THE TREE. Three things the instruction review of
    // 2026-09-18 found by reading, each of which had stood for days with nothing to notice it.
    const rootText = readFileSync(CLAUDE_MD, 'utf-8');
    // 1. A path rule the table does not name. The table is how a reader learns a rule exists
    //    before touching the files that load it; feature-documentation.md was missing for three days.
    for (const rule of rules) {
        const name = rule.slice(RULES_DIR.length + 1).replaceAll('\\', '/');
        if (!rootText.includes('`' + name + '`')) {
            problems.push(`.claude/rules/${name} is not named in CLAUDE.md's "Rules that load by path" table.`);
        }
    }
    // 2. The root file bans em-dashes and used them on eight lines; skill aimeat-writing bans them
    //    and used them on five, with two more skills beside it. The project skills are held to it
    //    too, and since 2026-11-15 the agent files and AGENTS.md, which every subagent and every
    //    other coding agent reads first. A skill's `references/` files are held to it as well: a
    //    skill loads them as part of itself, and the 2026-11-15 splits moved a change log with 35
    //    em-dashes into one. The rule files still carry some, moved verbatim from the old root file,
    //    and are not read here until somebody rewrites them.
    const agents = markdownFiles(join(REPO, '.claude', 'agents'), (n) => n.endsWith('.md'));
    const agentsMd = existsSync(AGENTS_MD) ? [AGENTS_MD] : [];
    const skillReferences = readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) => markdownFiles(join(SKILLS_DIR, d.name, 'references'), (n) => n.endsWith('.md')));
    for (const file of [CLAUDE_MD, ...skills, ...skillReferences, ...agents, ...agentsMd]) {
        readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
            if (line.includes('—')) problems.push(`${rel(file)}:${i + 1} has an em-dash, which this project's writing rule bans. Use a comma, a colon or two sentences.`);
        });
    }
    // 3. A `pnpm <script>` the instructions name that no package.json defines. A skill named
    //    `pnpm organism:sync`, which was never written.
    const scripts = new Set<string>();
    for (const pkg of [join(REPO, 'package.json'), join(REPO, 'aimeat', 'package.json')]) {
        for (const name of Object.keys((JSON.parse(readFileSync(pkg, 'utf-8')) as { scripts?: Record<string, string> }).scripts ?? {})) scripts.add(name);
    }
    const PNPM_BUILTIN = new Set(['install', 'exec', 'add', 'remove', 'run', 'dlx', 'update', 'audit', 'store', 'why', 'list', 'outdated', 'link', 'pack', 'publish', 'rebuild', 'prune', 'import', 'i']);
    let commands = 0;
    for (const file of [CLAUDE_MD, ...rules, ...skills, ...agents, ...agentsMd]) {
        const text = readFileSync(file, 'utf-8');
        for (const m of text.matchAll(/`pnpm ((?:--dir \S+ )?)([a-z][a-z0-9:_-]*)/g)) {
            const name = m[2];
            if (PNPM_BUILTIN.has(name)) continue;
            commands++;
            // A family written with a wildcard or a placeholder (`pnpm test:playwright:*`) names no one script.
            if (text.slice(m.index! + m[0].length, m.index! + m[0].length + 2).match(/^[:*<]/)) continue;
            // A sentence may say a command does NOT exist; that sentence is the fix, not the fault.
            const lineStart = text.lastIndexOf('\n', m.index!) + 1;
            const line = text.slice(lineStart, text.indexOf('\n', m.index!) < 0 ? undefined : text.indexOf('\n', m.index!));
            if (/never written|does not exist|no such|was removed|is gone/i.test(line)) continue;
            if (!scripts.has(name)) problems.push(`${rel(file)} names \`pnpm ${name}\`, which no package.json defines.`);
        }
    }
    console.log(`  ${agents.length} agent file(s)${agentsMd.length ? ' and AGENTS.md' : ''}; ${commands} pnpm command(s) named in the instructions checked against package.json`);

    // 4. A backticked repository path in an agent file or AGENTS.md that names nothing. Both are read
    //    by an agent before it has looked at the tree, so a moved file sends it the wrong way.
    // A gitignored path (docs/internal/, aimeat/.sandbox.json, .worktrees/) exists only where it was
    // made, never in a fresh worktree, so git's answer that it is ignored is enough.
    const ignored = (p: string): boolean => {
        // Both spellings, since a directory pattern (`docs/internal/`) matches only a name that ends in `/`.
        return [p, `${p}/`].some((q) => {
            try { execFileSync('git', ['-C', REPO, 'check-ignore', '-q', q], { stdio: 'ignore' }); return true; } catch { return false; }
        });
    };
    const exists = (p: string): boolean => existsSync(join(REPO, p)) || existsSync(join(REPO, 'aimeat', p)) || ignored(p);
    for (const file of [...agents, ...agentsMd]) problems.push(...instructionPathProblems(readFileSync(file, 'utf-8'), rel(file), exists));
    // 5. AGENTS.md carries the rules that bite before an agent would find them in CLAUDE.md.
    if (agentsMd.length) problems.push(...missingAgentsRules(readFileSync(AGENTS_MD, 'utf-8')));
    // 6. No live count that grows by design in the files every session or agent reads first.
    for (const file of [CLAUDE_MD, ...agentsMd]) problems.push(...liveCountProblems(readFileSync(file, 'utf-8'), rel(file)));
    console.log('');

    if (!problems.length) {
        console.log('  ✓ under the ceiling; every paths pattern names real files; every rule is in the table; no em-dash; every pnpm command and path exists; AGENTS.md carries its rules; no live count');
        return;
    }
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log('');
    process.exit(1);
}

main();
