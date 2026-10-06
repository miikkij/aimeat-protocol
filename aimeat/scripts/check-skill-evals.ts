/**
 * @file check-skill-evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A skill that has an eval suite is measured again when it changes, and the developer
 *   decides whether that run happens, because it costs money.
 *
 *   WHY. `pnpm eval:skill` runs every case of a suite three times with the skill and three times
 *   without it, on a paid model; one run of a five-case suite costs a few dollars. Running it on
 *   every gate would waste that on changes that never touched a skill, and running it never means a
 *   skill can get worse with nobody noticing (.claude/rules/skills.md: measure before and after).
 *   Jouni, 2026-09-28: the eval runs only when a skill changes, and the gate marks that and asks.
 *
 *   HOW. security/skill-evals.json holds, per skill with a suite under .claude/evals/<skill>/, a
 *   digest of the skill's text and of its suite as they stood at the last decision, and what the
 *   decision was: `ran` (with the scores) or `skipped` (with the reason). The gate fails when the
 *   digest differs, and the message names the command, a cost ceiling, and the two ways to record
 *   the decision. An AI session that meets this failure asks the developer before it runs the eval
 *   or records a skip: both are his decision, not the session's.
 *
 *   The skill's text is read where it lives: `.claude/skills/<skill>/` for a project skill, the
 *   `skillMd` of the entry in BUILTIN_SKILLS for a node skill (built-in skills are seeded from code,
 *   so the eval runner builds them with `--node-skill`). Digests, not `git log`, because CI clones at
 *   depth 1; line endings are folded, because Windows and CI differ.
 * @structure suites() · digestOf(skill) · main: check | --record <skill> --ran|--skip <text> | --list
 * @usage
 *   pnpm check:skill-evals                                              # gate (check:fast, CI)
 *   pnpm check:skill-evals --list
 *   pnpm check:skill-evals --record aimeat-writing --ran "opus, 3 runs: +0.08 +0.08 +0.33"
 *   pnpm check:skill-evals --record aimeat-writing --skip "wording only; Jouni 2026-09-28"
 * @version-history
 *   v1.0.1 — 2026-10-06 — The digest skips a suite's gitignored `results/` folder. A checkout that had
 *     run the eval digested its own results, so a decision recorded there read as a change everywhere
 *     else, and the other way round.
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SKILLS } from '../src/data/builtin-skills.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const LEDGER = join(here, '..', 'security', 'skill-evals.json');
const EVALS = join(REPO, '.claude', 'evals');
const PROJECT_SKILLS = join(REPO, '.claude', 'skills');
/** The ceiling the message proposes for one run of a suite, in dollars. */
const COST_CEILING_USD = 10;

interface Entry {
    digest: string;
    decision: 'ran' | 'skipped' | 'seeded';
    on: string;
    /** The scores for `ran`, the reason (and who decided) for `skipped`. */
    note: string;
}
interface Ledger { about: string; skills: Record<string, Entry> }

const fold = (s: string): string => s.replace(/\r\n/g, '\n');
/** The eval runner's output folder inside a suite (gitignored as .claude/evals/*\/results/). */
const RESULTS_DIR = /^[\\/]results[\\/]/;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function filesUnder(full: string): string[] {
    if (!existsSync(full)) return [];
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full).sort().flatMap(name => filesUnder(join(full, name)));
}

/** The skills that have an eval suite: a directory under .claude/evals with at least one case. */
function suites(): string[] {
    if (!existsSync(EVALS)) return [];
    return readdirSync(EVALS).filter(n => statSync(join(EVALS, n)).isDirectory()).sort();
}

/** Where the skill's text lives: the project folder, or the built-in entry. Null when neither. */
function skillSource(skill: string): { kind: 'project' | 'node'; texts: Array<[string, string]> } | null {
    const dir = join(PROJECT_SKILLS, skill);
    if (existsSync(join(dir, 'SKILL.md'))) {
        return { kind: 'project', texts: filesUnder(dir).map(f => [f.slice(REPO.length + 1).replace(/\\/g, '/'), fold(readFileSync(f, 'utf8'))]) };
    }
    const builtin = BUILTIN_SKILLS.find(s => s.name === skill);
    return builtin ? { kind: 'node', texts: [[`node:${skill}`, fold(builtin.skillMd)]] } : null;
}

/** One digest over the skill's text and its suite, in a stable order. */
function digestOf(skill: string): { digest: string; kind: 'project' | 'node' } | null {
    const src = skillSource(skill);
    if (!src) return null;
    // The suite is what git tracks: `results/` is where `pnpm eval:skill` writes its runs, and it is
    // gitignored, so a checkout that ran the eval read a different digest from one that did not.
    const suite = filesUnder(join(EVALS, skill)).filter(f => !RESULTS_DIR.test(f.slice(join(EVALS, skill).length))).map(f => [f.slice(REPO.length + 1).replace(/\\/g, '/'), fold(readFileSync(f, 'utf8'))] as [string, string]);
    const lines = [...src.texts, ...suite].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => `${name} ${sha(text).slice(0, 16)}`).join('\n');
    return { digest: 'sha256:' + sha(lines).slice(0, 24), kind: src.kind };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function evalCommand(skill: string, kind: 'project' | 'node'): string {
    return `pnpm eval:skill ${kind === 'node' ? '--node-skill ' : ''}${skill} --model opus --max-cost-usd ${COST_CEILING_USD}`;
}

function main(): void {
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
    const argv = process.argv.slice(2);
    const names = suites();

    if (argv.includes('--list')) {
        for (const name of names) {
            const e = ledger.skills[name];
            console.log(`${e ? `${e.on} ${e.decision}` : 'NO DECISION'}  ${name}  ${e?.note ?? ''}`);
        }
        return;
    }

    const ri = argv.indexOf('--record');
    if (ri >= 0) {
        const skill = argv[ri + 1];
        const ran = argv.indexOf('--ran');
        const skip = argv.indexOf('--skip');
        // --seed: only for a suite that existed before this check did, so the first gate asks about
        // the next change rather than about history. It never stands in for a decision on a change.
        const seed = argv.indexOf('--seed');
        const flags = [ran, skip, seed].filter(i => i >= 0);
        const note = flags.length === 1 ? argv[flags[0] + 1] : undefined;
        if (!skill || !names.includes(skill)) { console.error(`✗ "${skill ?? ''}" has no eval suite under .claude/evals/.`); process.exit(1); }
        if (!note) {
            console.error('✗ Say what was decided: --ran "<model, runs, the with-skill and without-skill score per case>" or --skip "<reason, and who decided>".');
            process.exit(1);
        }
        const d = digestOf(skill);
        if (!d) { console.error(`✗ ${skill}: no skill of that name in .claude/skills/ or in BUILTIN_SKILLS.`); process.exit(1); }
        ledger.skills[skill] = { digest: d.digest, decision: ran >= 0 ? 'ran' : skip >= 0 ? 'skipped' : 'seeded', on: today(), note };
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
        console.log(`recorded ${skill}: ${ledger.skills[skill].decision} on ${ledger.skills[skill].on}`);
        return;
    }

    const problems: string[] = [];
    for (const name of names) {
        const d = digestOf(name);
        if (!d) { problems.push(`.claude/evals/${name}/ is a suite for a skill that does not exist. Remove the suite or name it after its skill.`); continue; }
        const e = ledger.skills[name];
        if (e && e.digest === d.digest) continue;
        problems.push(
            `${name}: the skill or its eval suite changed${e ? ` since the last decision (${e.decision} on ${e.on})` : ', and no decision is recorded'}.\n`
            + `    Running the eval costs money (at most $${COST_CEILING_USD}). ASK THE DEVELOPER FIRST, then either:\n`
            + `      run it:   ${evalCommand(name, d.kind)}\n`
            + `                pnpm check:skill-evals --record ${name} --ran "<model, runs, with/without score per case>"\n`
            + `      or skip:  pnpm check:skill-evals --record ${name} --skip "<reason>; <who decided, date>"`,
        );
    }
    for (const name of Object.keys(ledger.skills)) {
        if (!names.includes(name)) problems.push(`security/skill-evals.json names "${name}", which has no eval suite. Remove the entry.`);
    }
    if (problems.length) {
        console.error('✗ A skill with an eval suite changed. The eval is the developer\'s decision:\n');
        for (const p of problems) console.error('  ' + p + '\n');
        process.exit(1);
    }
    console.log(`✓ ${names.length} skills with an eval suite, each unchanged since its last decision.`);
}

main();
