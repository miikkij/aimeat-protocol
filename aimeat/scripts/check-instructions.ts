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
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';

const REPO = join(process.cwd(), '..');
const CLAUDE_MD = join(REPO, 'CLAUDE.md');
const RULES_DIR = join(REPO, '.claude', 'rules');
const SKILLS_DIR = join(REPO, '.claude', 'skills');

/**
 * Seeded 2026-09-13 with CLAUDE.md at 36,698 bytes after the split, plus room for a few sentences.
 * A session start carries this file, the SessionStart hook's output and the harness's own prompt;
 * this is the part the repository decides.
 * Raised to 39,000 on 2026-09-14, at Jouni's request, for the two reply-language rules (STE100 and
 * selkeä kieli), which hold in every session.
 */
const CEILING_BYTES = 39_000;

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
    // 2. The root file bans em-dashes and used them on eight lines.
    rootText.split('\n').forEach((line, i) => {
        if (line.includes('—')) problems.push(`CLAUDE.md:${i + 1} has an em-dash, which the file itself bans. Use a comma, a colon or two sentences.`);
    });
    // 3. A `pnpm <script>` the instructions name that no package.json defines. A skill named
    //    `pnpm organism:sync`, which was never written.
    const scripts = new Set<string>();
    for (const pkg of [join(REPO, 'package.json'), join(REPO, 'aimeat', 'package.json')]) {
        for (const name of Object.keys((JSON.parse(readFileSync(pkg, 'utf-8')) as { scripts?: Record<string, string> }).scripts ?? {})) scripts.add(name);
    }
    const PNPM_BUILTIN = new Set(['install', 'exec', 'add', 'remove', 'run', 'dlx', 'update', 'audit', 'store', 'why', 'list', 'outdated', 'link', 'pack', 'publish', 'rebuild', 'prune', 'import', 'i']);
    const agents = markdownFiles(join(REPO, '.claude', 'agents'), (n) => n.endsWith('.md'));
    let commands = 0;
    for (const file of [CLAUDE_MD, ...rules, ...skills, ...agents]) {
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
    console.log(`  ${agents.length} agent file(s); ${commands} pnpm command(s) named in the instructions checked against package.json`);
    console.log('');

    if (!problems.length) {
        console.log('  ✓ under the ceiling; every paths pattern names real files; every rule is in the table; no em-dash; every pnpm command exists');
        return;
    }
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log('');
    process.exit(1);
}

main();
