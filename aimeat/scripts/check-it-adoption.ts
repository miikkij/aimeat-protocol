/**
 * @file check-it-adoption.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The IT adoption package (docs/it-adoption/) is read by an organisation's IT and
 *   security staff deciding whether to run AIMEAT, and every page in it makes claims about the code:
 *   which settings exist, what is on by default, what leaves the node. This gate keeps those claims
 *   tied to the code they describe.
 *
 *   WHY. The developer asked on 2026-11-01 that the package must not drift or go stale, the same
 *   day an enterprise CTO read a SECURITY.md that named a release line two majors old: nothing tied
 *   that table to the release, so nothing noticed. A document IT signs off against is worse than no
 *   document when it is wrong, because the reader checks one claim, finds it false, and stops
 *   trusting the rest.
 *
 *   THE SAME SHAPE AS check:skill-reviews. Each page has an entry in
 *   security/it-adoption-reviews.json that names the source files the page makes claims about
 *   (`watches`) and holds a digest of them as they stood on the review day. The gate fails when:
 *     - a page has no entry, or an entry names a page or a watched file that is gone;
 *     - the digest differs: the code changed after the page was read. The message names the page
 *       and the files, so whoever changed the code is the one asked to re-read the page;
 *     - the review is older than MAX_AGE_DAYS;
 *     - the page's "Checked against AIMEAT node X.Y.Z (commit c) on D." line is missing, its date
 *       is not the ledger's, or its major version is not package.json's major;
 *     - a setting (`AIMEAT_*` in backticks) appears neither in aimeat/.env.example nor in aimeat/src
 *       nor in aimeat/scripts (a release script reads some),
 *       or an MCP tool name (`aimeat_*` in backticks) is not declared in the tool catalog or the MCP
 *       servers. A trailing `*` reads as a prefix (`AIMEAT_SMTP_*`);
 *     - a numbered page lacks its `## Limits` or `## Open questions` section;
 *     - an `OPEN:` line on a page is not in README.md's list, or the README does not link a page;
 *     - a page carries an em-dash or an en-dash (the project's writing rule).
 *   Repository paths and links are check:docs' job, which reads every file under docs/.
 *
 *   RE-STAMPING IS CHEAP ON PURPOSE AND HONEST BY CONVENTION. `--record <page>` writes today's date,
 *   the digest and the page's "Checked against" line. It is meant to follow a reading.
 * @structure pages() · digestOf(watches) · knownSettings() · knownTools() · pageProblems() ·
 *   readmeProblems() · main: check | --record <page>|--all | --list
 * @usage
 *   pnpm check:it-adoption                          # gate (check:fast, CI)
 *   pnpm check:it-adoption --record 06-ai-and-models.md
 *   pnpm check:it-adoption --record --all
 *   pnpm check:it-adoption --list                   # every page, its date and what it watches
 * @version-history
 *   v1.0.0 -- 2026-11-01 -- Initial, with the first version of the package.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const PACKAGE_DIR = 'docs/it-adoption';
const LEDGER = join(here, '..', 'security', 'it-adoption-reviews.json');

/** A page is re-read at least this often, whatever changed. */
const MAX_AGE_DAYS = 180;
const STAMP_RE = /^> Checked against AIMEAT node (\d+)\.(\d+)\.(\d+) \(commit ([0-9a-f]{7,40})\) on (\d{4}-\d{2}-\d{2})\./m;

interface Entry {
    /** ISO date of the last reading against the code. */
    reviewedOn: string;
    /** Repo-relative files or directories the page makes claims about. A directory means every file under it. */
    watches: string[];
    /** sha256 over the watched files as they stood on the review day. */
    digest: string;
    note?: string;
}
interface Ledger { about: string; pages: Record<string, Entry>; fileDigests?: Record<string, Record<string, string>> }

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const today = (): string => new Date().toISOString().slice(0, 10);
const ageDays = (iso: string): number => Math.floor((Date.now() - Date.parse(iso + 'T00:00:00Z')) / 86_400_000);

function filesUnder(path: string): string[] {
    const full = join(REPO, path);
    if (!existsSync(full)) return [];
    if (!statSync(full).isDirectory()) return [path];
    return readdirSync(full).sort().flatMap(name => filesUnder(`${path}/${name}`));
}

/** Every Markdown file of the package, as a path relative to docs/it-adoption/. */
function pages(): string[] {
    return filesUnder(PACKAGE_DIR).filter(f => f.endsWith('.md')).map(f => f.slice(PACKAGE_DIR.length + 1)).sort();
}

/** The digest of the watched files, in a stable order, with line endings folded. */
function digestOf(watches: string[]): { digest: string; files: Record<string, string>; missing: string[] } {
    const files: Record<string, string> = {};
    const missing: string[] = [];
    for (const watch of watches) {
        const found = filesUnder(watch);
        if (!found.length) missing.push(watch);
        for (const file of found) files[file] = createHash('sha256').update(read(file), 'utf8').digest('hex').slice(0, 16);
    }
    const lines = Object.keys(files).sort().map(f => `${f} ${files[f]}`).join('\n');
    return { digest: lines ? 'sha256:' + createHash('sha256').update(lines, 'utf8').digest('hex').slice(0, 24) : '', files, missing };
}

/** The text of every source file under a directory, joined, for a name lookup. */
function corpus(dirs: string[]): string {
    return dirs.flatMap(d => filesUnder(d)).filter(f => /\.(ts|js|mjs)$/.test(f)).map(read).join('\n');
}

let settingsText: string | null = null;
function settingExists(name: string): boolean {
    settingsText ??= read('aimeat/.env.example') + '\n' + corpus(['aimeat/src', 'aimeat/scripts']);
    if (name.endsWith('*')) return settingsText.includes(name.slice(0, -1));
    return new RegExp(`\\b${name}\\b`).test(settingsText);
}

let toolNames: Set<string> | null = null;
function toolExists(name: string): boolean {
    toolNames ??= new Set(corpus(['aimeat/src/tool-catalog', 'aimeat/src/mcp']).match(/['"`]aimeat_[a-z0-9_]+['"`]/g)?.map(s => s.slice(1, -1)) ?? []);
    if (name.endsWith('*')) return [...toolNames].some(t => t.startsWith(name.slice(0, -1)));
    return toolNames.has(name);
}

/** The page text outside fenced code blocks, line by line, with line numbers kept. */
function proseLines(content: string): Array<[number, string]> {
    let fence: string | null = null;
    const out: Array<[number, string]> = [];
    content.split('\n').forEach((line, i) => {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) { fence = fence ? (marker[1][0] === fence[0] && marker[1].length >= fence.length ? null : fence) : marker[1]; return; }
        if (!fence) out.push([i + 1, line]);
    });
    return out;
}

const openLinesOf = (content: string): string[] =>
    proseLines(content).map(([, l]) => l.match(/OPEN:\s*(.+)$/)?.[1]?.trim()).filter((s): s is string => !!s);

function pageProblems(page: string, entry: Entry | undefined, major: number): string[] {
    const rel = `${PACKAGE_DIR}/${page}`;
    const content = read(rel);
    const problems: string[] = [];
    const stamp = content.match(STAMP_RE);
    if (!stamp) problems.push(`${rel}: no "> Checked against AIMEAT node X.Y.Z (commit c) on YYYY-MM-DD." line under the title.`);
    else {
        if (Number(stamp[1]) !== major) problems.push(`${rel}: checked against node ${stamp[1]}.${stamp[2]}.${stamp[3]}, and this is a ${major}.x tree. Read the page against the new major, then --record ${page}.`);
        if (entry && stamp[5] !== entry.reviewedOn) problems.push(`${rel}: the page says it was checked on ${stamp[5]}, the ledger says ${entry.reviewedOn}. Run --record ${page} after reading it.`);
    }
    if (/^\d\d-/.test(page)) {
        for (const heading of ['## Limits', '## Open questions']) {
            if (!new RegExp(`^${heading}$`, 'm').test(content)) problems.push(`${rel}: no "${heading}" section. Every numbered page states its limits and its open questions, or says it has none.`);
        }
    }
    for (const [n, line] of proseLines(content)) {
        if (/[–—]/.test(line)) problems.push(`${rel}:${n}: an em-dash or en-dash. Use a comma, a colon or two sentences.`);
        for (const m of line.matchAll(/`([^`\n]+)`/g)) {
            const code = m[1];
            // A name followed by `<` is a placeholder family (AIMEAT_CONNECT_<PROVIDER>_CLIENT_ID), and a
            // name inside a longer word is not a name (the cookie __Host-aimeat_rt).
            for (const s of code.match(/(?<![\w-])AIMEAT_[A-Z0-9_]+\*?(?![<\w])/g) ?? []) {
                if (!settingExists(s)) problems.push(`${rel}:${n}: setting \`${s}\` is neither in aimeat/.env.example, aimeat/src nor aimeat/scripts. Correct the page to the setting that exists now.`);
            }
            for (const t of code.match(/(?<![\w-])aimeat_[a-z0-9_]+\*?(?![<\w])/g) ?? []) {
                if (!toolExists(t)) problems.push(`${rel}:${n}: MCP tool \`${t}\` is not declared in aimeat/src/tool-catalog or aimeat/src/mcp. Correct the page to the tool that exists now.`);
            }
        }
    }
    return problems;
}

function readmeProblems(all: string[]): string[] {
    const readme = `${PACKAGE_DIR}/README.md`;
    if (!existsSync(join(REPO, readme))) return [`${readme} is missing. It is the package's entry page and holds the list of open questions.`];
    const text = read(readme);
    const listed = new Set(openLinesOf(text).map(s => s.replace(/\s*\([^()]*\.md\)\s*$/, '')));
    const problems: string[] = [];
    for (const page of all.filter(p => p !== 'README.md')) {
        if (!text.includes(`](${page})`)) problems.push(`${readme} does not link ${page}. Every page of the package is reachable from the README.`);
        for (const open of openLinesOf(read(`${PACKAGE_DIR}/${page}`))) {
            if (!listed.has(open)) problems.push(`${readme}: the open question of ${page} is not in its list: "OPEN: ${open}". Copy the line there, or remove it from the page when it is answered.`);
        }
    }
    return problems;
}

function record(ledger: Ledger, which: string[]): void {
    const version = (JSON.parse(read('aimeat/package.json')) as { version: string }).version;
    const commit = execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    for (const page of which) {
        const entry = ledger.pages[page];
        if (!entry) { console.error(`✗ no entry "${page}" in security/it-adoption-reviews.json. Add it with its watches first.`); process.exit(1); }
        const { digest, files, missing } = digestOf(entry.watches);
        if (missing.length) { console.error(`✗ ${page} watches something that does not exist: ${missing.join(', ')}`); process.exit(1); }
        entry.reviewedOn = today();
        entry.digest = digest;
        ledger.fileDigests = { ...(ledger.fileDigests ?? {}), [page]: files };
        const full = join(REPO, PACKAGE_DIR, page);
        const raw = readFileSync(full);
        const text = raw.toString('utf8');
        const line = `> Checked against AIMEAT node ${version} (commit ${commit}) on ${entry.reviewedOn}.`;
        const next = STAMP_RE.test(text) ? text.replace(/^> Checked against AIMEAT node [^\n]*?on \d{4}-\d{2}-\d{2}\./m, line) : text;
        if (next !== text) writeFileSync(full, Buffer.from(next, 'utf8'));
        console.log(`recorded ${page}: ${entry.reviewedOn} ${digest}`);
    }
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

function main(): void {
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
    const all = pages();
    const argv = process.argv.slice(2);

    if (argv.includes('--list')) {
        for (const page of all) {
            const e = ledger.pages[page];
            console.log(`${e ? e.reviewedOn : 'NOT REVIEWED'}  ${page}  ${e ? e.watches.join(', ') : ''}`);
        }
        return;
    }
    const ri = argv.indexOf('--record');
    if (ri >= 0) {
        record(ledger, argv.includes('--all') ? Object.keys(ledger.pages) : [argv[ri + 1]]);
        return;
    }

    const major = Number((JSON.parse(read('aimeat/package.json')) as { version: string }).version.split('.')[0]);
    const problems: string[] = [];
    for (const page of all) {
        const entry = ledger.pages[page];
        if (!entry) problems.push(`${PACKAGE_DIR}/${page} has no entry in security/it-adoption-reviews.json. Add it with the files the page makes claims about, then run --record ${page}.`);
        problems.push(...pageProblems(page, entry, major));
    }
    for (const [page, entry] of Object.entries(ledger.pages)) {
        if (!all.includes(page)) { problems.push(`security/it-adoption-reviews.json names "${page}", which is not a page of ${PACKAGE_DIR}. Remove the entry.`); continue; }
        const { digest, files, missing } = digestOf(entry.watches);
        for (const m of missing) problems.push(`${page} watches "${m}", which does not exist. Point the entry at where that code lives now.`);
        if (!missing.length && digest !== entry.digest) {
            const before = ledger.fileDigests?.[page] ?? {};
            const changed = [...new Set([...Object.keys(files), ...Object.keys(before)])].filter(f => files[f] !== before[f]);
            problems.push(`${PACKAGE_DIR}/${page}: the code it describes changed after it was read on ${entry.reviewedOn}${changed.length ? ` (${changed.join(', ')})` : ''}. `
                + `Read the page against that change, correct what is no longer true for an organisation's IT, then: pnpm check:it-adoption --record ${page}`);
        }
        if (ageDays(entry.reviewedOn) > MAX_AGE_DAYS) problems.push(`${page} was last read ${ageDays(entry.reviewedOn)} days ago (${entry.reviewedOn}; the limit is ${MAX_AGE_DAYS}). Read it again, then --record it.`);
    }
    problems.push(...readmeProblems(all));
    if (problems.length) {
        console.error(`\n✗ ${problems.length} IT adoption package problem(s):`);
        for (const p of problems) console.error(`    ${p}`);
        process.exit(1);
    }
    console.log(`✓ the IT adoption package was read against the code it describes, that code has not changed since, and every setting and tool it names exists (${all.length} pages)`);
}

main();
