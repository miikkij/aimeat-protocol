/**
 * @file check-feature-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description docs/AIMEAT-Feature-List.md says what a node does today, and /v1/everything serves it
 *   to every reader. This gate keeps each section of it tied to the code it describes, and keeps
 *   each promise of a refusal or a limit tied to a test that holds it.
 *
 *   WHY. The feature audit of 2026-11-19 found the list wrong in seven places, and every one was a
 *   sentence that had been true or meant to be true: a hook count two behind the code, a schedule
 *   limit the AI "cannot" set that it could since 2026-11-13, regulated data said to reach "only a
 *   model on this machine" when nothing read that rule, a sign-in refusal said to turn on that by
 *   ruling stays off. check:everything only says the served copy matches the Markdown; nothing said
 *   the Markdown matched the code.
 *
 *   THE SAME SHAPE AS check:it-adoption. security/feature-list-reviews.json has one entry per `##`
 *   section that names the files or folders the section makes claims about (`watches`, a folder
 *   meaning every file git tracks under it) and a digest of them as they stood on the review day.
 *   The gate fails when:
 *     - a section has no entry, or an entry names a section the list no longer has;
 *     - a watched path is gone;
 *     - the digest differs: the code changed after the section was read. The message names the
 *       section and the files, so whoever changed the code re-reads that section;
 *     - a `promises` entry's quoted fragment is no longer in the list, its holder file is gone, or
 *       the holder no longer contains the string named. A promise is a sentence that says the node
 *       refuses something or holds a limit; its holder is the test that fails when that stops being
 *       true. A promise no test holds is rewritten to what the code does, not listed.
 *   The Contents section is the list's own index and describes no code, so it has no entry.
 *
 *   RE-STAMPING IS CHEAP ON PURPOSE AND HONEST BY CONVENTION. `--record <section>` writes today's
 *   date and the digest. It is meant to follow a reading of that section against the change. It
 *   reads no network and starts no server.
 * @structure sections() · sectionProblems() · promiseProblems() · record() · main: check | --record <section>|--all | --list
 * @usage
 *   pnpm check:feature-list                                   # gate (check:fast, CI)
 *   pnpm check:feature-list --record "8. Automation: schedules, workflows and extensions"
 *   pnpm check:feature-list --record --all
 *   pnpm check:feature-list --list                            # every section, its date and what it watches
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial, after the feature audit of 2026-11-19 (section 4.1 of its report).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, digestOf, readRepoFile } from './lib/watch-digest.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const DOC = 'docs/AIMEAT-Feature-List.md';
const LEDGER = join(here, '..', 'security', 'feature-list-reviews.json');

/** Sections that describe the list itself, not code. */
const NOT_ABOUT_CODE = new Set(['Contents']);

interface Entry {
    /** ISO date of the last reading against the code. */
    reviewedOn: string;
    /** Repo-relative files or folders the section makes claims about. A folder means every tracked file under it. */
    watches: string[];
    /** sha256 over the watched files as they stood on the review day. */
    digest: string;
    note?: string;
}
interface HeldPromise {
    /** A fragment of one sentence of the list, quoted exactly. */
    quote: string;
    /** The test file that fails when the promise stops being true. */
    holder: string;
    /** A string the holder contains: the test's name or the assertion that holds the promise. */
    holds: string;
}
interface Ledger {
    about: string;
    sections: Record<string, Entry>;
    fileDigests?: Record<string, Record<string, string>>;
    promises: HeldPromise[];
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** The `##` headings of the list outside fenced blocks, in order. */
function sections(doc: string): string[] {
    let fence: string | null = null;
    const out: string[] = [];
    for (const line of doc.split('\n')) {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) { fence = fence ? (marker[1][0] === fence[0] && marker[1].length >= fence.length ? null : fence) : marker[1]; continue; }
        if (fence) continue;
        const h = line.match(/^## (.+?)\s*$/);
        if (h && !NOT_ABOUT_CODE.has(h[1])) out.push(h[1]);
    }
    return out;
}

function sectionProblems(ledger: Ledger, names: string[]): string[] {
    const problems: string[] = [];
    for (const name of names) {
        if (!ledger.sections[name]) problems.push(`${DOC} section "${name}" has no entry in security/feature-list-reviews.json. Add it with the files the section makes claims about, then run --record "${name}".`);
    }
    for (const [name, entry] of Object.entries(ledger.sections)) {
        if (!names.includes(name)) { problems.push(`security/feature-list-reviews.json names section "${name}", which ${DOC} no longer has. Rename the entry to the heading it has now, or remove it.`); continue; }
        const { digest, files, missing } = digestOf(REPO, entry.watches);
        for (const m of missing) problems.push(`section "${name}" watches "${m}", which does not exist. Point the entry at where that code lives now, re-read the section, then --record it.`);
        if (!missing.length && digest !== entry.digest) {
            const changed = changedFiles(files, ledger.fileDigests?.[name] ?? {});
            problems.push(`${DOC} section "${name}": the code it describes changed after it was read on ${entry.reviewedOn}${changed.length ? ` (${changed.join(', ')})` : ''}. `
                + `Read the section against that change, correct what is no longer true, run pnpm build:everything if the list changed, then: pnpm check:feature-list --record "${name}"`);
        }
    }
    return problems;
}

function promiseProblems(ledger: Ledger, doc: string): string[] {
    const problems: string[] = [];
    const flat = doc.replace(/\s+/g, ' ');
    for (const p of ledger.promises ?? []) {
        if (!flat.includes(p.quote.replace(/\s+/g, ' '))) {
            problems.push(`${DOC} no longer says "${p.quote}". If the promise changed, quote the new sentence in security/feature-list-reviews.json and check that ${p.holder} still holds it; if it is gone, remove the entry.`);
        }
        if (!existsSync(join(REPO, p.holder))) { problems.push(`the promise "${p.quote}" is held by ${p.holder}, which does not exist. Name the test that holds it now, or rewrite the sentence to what the code does.`); continue; }
        if (!readRepoFile(REPO, p.holder).includes(p.holds)) {
            problems.push(`the promise "${p.quote}" is held by ${p.holder}, which no longer contains "${p.holds}". Name the test or assertion that holds it now, or rewrite the sentence to what the code does.`);
        }
    }
    return problems;
}

function record(ledger: Ledger, which: string[], names: string[]): void {
    for (const name of which) {
        const entry = ledger.sections[name];
        if (!entry) { console.error(`✗ no entry "${name}" in security/feature-list-reviews.json. Add it with its watches first.`); process.exit(1); }
        if (!names.includes(name)) { console.error(`✗ ${DOC} has no section "${name}".`); process.exit(1); }
        const { digest, files, missing } = digestOf(REPO, entry.watches);
        if (missing.length) { console.error(`✗ section "${name}" watches something that does not exist: ${missing.join(', ')}`); process.exit(1); }
        entry.reviewedOn = today();
        entry.digest = digest;
        ledger.fileDigests = { ...(ledger.fileDigests ?? {}), [name]: files };
        console.log(`recorded "${name}": ${entry.reviewedOn} ${digest}`);
    }
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

function main(): void {
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
    const doc = readRepoFile(REPO, DOC);
    const names = sections(doc);
    const argv = process.argv.slice(2);

    if (argv.includes('--list')) {
        for (const name of names) {
            const e = ledger.sections[name];
            console.log(`${e ? e.reviewedOn : 'NOT REVIEWED'}  ${name}  ${e ? e.watches.join(', ') : ''}`);
        }
        console.log(`${(ledger.promises ?? []).length} promises, each held by a test.`);
        return;
    }
    const ri = argv.indexOf('--record');
    if (ri >= 0) {
        const which = argv.includes('--all') ? Object.keys(ledger.sections) : [argv[ri + 1]];
        if (!which[0]) { console.error('✗ --record needs a section heading in quotes, or --all.'); process.exit(1); }
        record(ledger, which, names);
        return;
    }

    const problems = [...sectionProblems(ledger, names), ...promiseProblems(ledger, doc)];
    if (problems.length) {
        console.error(`\n✗ ${problems.length} feature list problem(s):`);
        for (const p of problems) console.error(`    ${p}`);
        process.exit(1);
    }
    console.log(`✓ every section of the feature list was read against the code it describes and that code has not changed since; ${(ledger.promises ?? []).length} promises of a refusal or a limit are each held by a test (${names.length} sections)`);
}

main();
