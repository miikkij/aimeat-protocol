/**
 * @file check-skill-reviews.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every skill carries the day somebody last read it against the code, and the gate
 *   notices when the code it describes has changed since.
 *
 *   WHY. On 2026-09-19 every built-in and project skill was read against the code for the first
 *   time: 68 statements were wrong or stale in about 45 skills. The pattern in the game skills was
 *   the clearest: six library modules had shipped a point release whose whole purpose was to
 *   remove a trap, and the skills went on teaching the trap, two of them by telling the builder to
 *   leave the library. Nothing connected a change in `phaser/boot.js` to the skill that describes
 *   `phaser/boot.js`. `check:prompt-refs` proves that a tool or a route a skill names EXISTS; it
 *   cannot see advice that stopped being true.
 *
 *   A DATE ALONE WOULD NOT HAVE CAUGHT IT: those skills were three weeks old. So each entry in
 *   security/skill-reviews.json names the source files the skill makes claims about (`watches`)
 *   and holds a digest of them as they stood on the review day. The gate fails when:
 *     - a skill has no entry (a new skill is reviewed the day it is written);
 *     - an entry names a skill that no longer exists, or a watched file that is gone;
 *     - the digest differs: the code changed after the review. The message names the files, so
 *       the person who changed the library is the one told to re-read its skill;
 *     - the review is older than MAX_AGE_DAYS, which is the only check a skill with no watched
 *       files gets (the conversation skills describe how to talk, not an API).
 *   Digests, not `git log`: CI clones at depth 1 and has no history to ask. Line endings are
 *   folded before hashing, because the same file is CRLF on Windows and LF in CI.
 *
 *   RE-STAMPING IS CHEAP ON PURPOSE AND HONEST BY CONVENTION. `--record <skill>` writes today's
 *   date and the new digest. It is meant to follow a reading, and nothing can prove that it did;
 *   what the gate buys is that the question is asked of the right person at the right commit.
 * @structure skillNames() · digestOf(files) · main: check | --record <name>|--all | --list
 * @usage
 *   pnpm check:skill-reviews                     # gate (check:fast, CI)
 *   pnpm check:skill-reviews --record aimeat-phaser-boot
 *   pnpm check:skill-reviews --list              # every skill, its date and what it watches
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial, with the first content audit of every skill.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SKILLS } from '../src/data/builtin-skills.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const LEDGER = join(here, '..', 'security', 'skill-reviews.json');
const PROJECT_SKILLS = join(REPO, '.claude', 'skills');

/** A skill with nothing to watch is re-read at least this often. */
const MAX_AGE_DAYS = 180;

interface Entry {
    /** ISO date of the last reading against the code. */
    reviewedOn: string;
    /** Repo-relative files or directories the skill makes claims about. A directory means every file under it. */
    watches: string[];
    /** sha256 over the watched files as they stood on the review day. Empty when nothing is watched. */
    digest: string;
    /** One sentence, when the reason for the watch list is not obvious. */
    note?: string;
}
interface Ledger { about: string; skills: Record<string, Entry> }

function filesUnder(path: string): string[] {
    const full = join(REPO, path);
    if (!existsSync(full)) return [];
    if (!statSync(full).isDirectory()) return [path];
    return readdirSync(full).sort().flatMap(name => filesUnder(`${path}/${name}`));
}

/** The digest of the watched files, in a stable order, with line endings folded. */
function digestOf(watches: string[]): { digest: string; files: Record<string, string>; missing: string[] } {
    const files: Record<string, string> = {};
    const missing: string[] = [];
    for (const watch of watches) {
        const found = filesUnder(watch);
        if (!found.length) missing.push(watch);
        for (const file of found) {
            const text = readFileSync(join(REPO, file), 'utf8').replace(/\r\n/g, '\n');
            files[file] = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
        }
    }
    const lines = Object.keys(files).sort().map(f => `${f} ${files[f]}`).join('\n');
    return { digest: lines ? 'sha256:' + createHash('sha256').update(lines, 'utf8').digest('hex').slice(0, 24) : '', files, missing };
}

/** Every skill the repository ships: `node:<name>` for a built-in one, `project:<name>` for .claude/skills. */
function skillNames(): string[] {
    const builtin = BUILTIN_SKILLS.map(s => `node:${s.name}`);
    const project = existsSync(PROJECT_SKILLS)
        ? readdirSync(PROJECT_SKILLS).filter(n => existsSync(join(PROJECT_SKILLS, n, 'SKILL.md'))).map(n => `project:${n}`)
        : [];
    return [...builtin, ...project].sort();
}

const today = (): string => new Date().toISOString().slice(0, 10);
const ageDays = (iso: string): number => Math.floor((Date.now() - Date.parse(iso + 'T00:00:00Z')) / 86_400_000);

function main(): void {
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger & { fileDigests?: Record<string, Record<string, string>> };
    const names = skillNames();
    const argv = process.argv.slice(2);

    if (argv.includes('--list')) {
        for (const name of names) {
            const e = ledger.skills[name];
            console.log(`${e ? e.reviewedOn : 'NOT REVIEWED'}  ${name}  ${e ? e.watches.join(', ') || '(nothing watched)' : ''}`);
        }
        return;
    }

    const ri = argv.indexOf('--record');
    if (ri >= 0) {
        const target = argv[ri + 1];
        const which = target === '--all' || argv.includes('--all') ? Object.keys(ledger.skills) : [target];
        for (const name of which) {
            const entry = ledger.skills[name];
            if (!entry) { console.error(`✗ no entry "${name}" in security/skill-reviews.json. Add it with its watches first.`); process.exit(1); }
            const { digest, files, missing } = digestOf(entry.watches);
            if (missing.length) { console.error(`✗ ${name} watches something that does not exist: ${missing.join(', ')}`); process.exit(1); }
            entry.reviewedOn = today();
            entry.digest = digest;
            ledger.fileDigests = { ...(ledger.fileDigests ?? {}), [name]: files };
            console.log(`recorded ${name}: ${entry.reviewedOn} ${digest || '(nothing watched)'}`);
        }
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
        return;
    }

    const problems: string[] = [];
    for (const name of names) if (!ledger.skills[name]) problems.push(`${name} has no entry in security/skill-reviews.json. Read it against the code, add the entry with what it watches, then run --record ${name}.`);
    for (const [name, entry] of Object.entries(ledger.skills)) {
        if (!names.includes(name)) { problems.push(`security/skill-reviews.json names "${name}", which is not a skill this repository ships. Remove the entry.`); continue; }
        const { digest, files, missing } = digestOf(entry.watches);
        for (const m of missing) problems.push(`${name} watches "${m}", which does not exist. Point the entry at where that code lives now.`);
        if (!missing.length && digest !== entry.digest) {
            const before = ledger.fileDigests?.[name] ?? {};
            const changed = [...new Set([...Object.keys(files), ...Object.keys(before)])].filter(f => files[f] !== before[f]);
            problems.push(`${name}: the code it describes changed after it was read on ${entry.reviewedOn}${changed.length ? ` (${changed.join(', ')})` : ''}. `
                + `Read the skill against that change, correct what is no longer true, then: pnpm check:skill-reviews --record ${name}`);
        }
        if (ageDays(entry.reviewedOn) > MAX_AGE_DAYS) problems.push(`${name} was last read ${ageDays(entry.reviewedOn)} days ago (${entry.reviewedOn}; the limit is ${MAX_AGE_DAYS}). Read it again, then --record it.`);
    }
    if (problems.length) {
        console.error(`\n✗ ${problems.length} skill review problem(s):`);
        for (const p of problems) console.error(`    ${p}`);
        process.exit(1);
    }
    console.log(`✓ every skill was read against the code it describes, and that code has not changed since (${names.length} skills)`);
}

main();
