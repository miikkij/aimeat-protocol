/**
 * @file scripts/check-denial-coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for the largest class the August 2026 E2E test-quality audit measured:
 *   197 of 591 findings were `missing-denial` — a suite that drives a surface with ONE principal and
 *   never asks what happens to a second. A suite like that proves the feature and cannot prove the
 *   fence, so deleting a scope check leaves it green. Independently reproduced before this script
 *   was written: 89 of 234 registered E2E files contained no assertion about a 401 or a 403.
 *
 *   WHY THE EXEMPTION EXPIRES, which is the whole design. `check-route-scopes.ts` was seeded with
 *   340 offenders on 2026-08-10 so it could only ratchet down, and by 2026-08-15 it was still 340:
 *   every entry carried the same generated sentence, nobody owned any of them, and the gate was
 *   green the entire time. A backlog nobody is ever forced to look at is not a backlog. Here the
 *   exemption is pinned to the suite's CONTENT: edit the file and its exemption stops covering it.
 *   You are not asked to fix the backlog; you are asked to leave the file you touched better than
 *   you found it, which is the one moment you already have the context to do it.
 * @structure
 *   - registeredSuites(): the ALL_SUITES list in test/run-e2e-ci.ts, parsed as text (the runner is
 *     the source of truth for what actually executes; a file on no list is silent, not skipped)
 *   - denialKind(): which refusal the suite's assert CONDITIONS ask about: an authenticated second
 *     principal (a 403 or an MCP isError), only a caller with no credential (a 401), or none
 *   - main(): suites with no refusal at all against security/denial-coverage-exemptions.json, and
 *     suites with no refusal of an authenticated second principal against
 *     security/denial-coverage-no-second-principal.json; --strict exits 1
 * @usage
 *   cd aimeat && pnpm check:denial-coverage            # report
 *   cd aimeat && pnpm check:denial-coverage --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:denial-coverage --seed     # rewrite the first file from today's state
 *   cd aimeat && pnpm exec tsx scripts/check-denial-coverage.ts --seed-second-principal   # the second
 * @version-history
 *   v1.2.0 — 2026-10-16 — A 401 alone and a status compared with !== no longer count as asking what a
 *     second principal gets. The detector returned true on the first 401 or 403 in any condition, so
 *     an anonymous 401 or `assert(r.status !== 403)` passed a gate labelled "Every suite asks what a
 *     second principal gets". Those suites are a second ratchet,
 *     security/denial-coverage-no-second-principal.json, seeded once, sha-pinned like the first
 *     (QA audit P3-08, S2-03).
 *   v1.1.0 — 2026-08-15 — The detector reads an MCP refusal too, not only an HTTP status. A refused
 *     tools/call comes back as a JSON-RPC error, which every suite here reads as `isError`, so a
 *     status-only test reported twenty MCP suites as having no denial case while refusal was the only
 *     thing several of them did. It said so about test/e2e-mcp-cross-owner.ts — seventeen assertions,
 *     every one of them owner B being refused — the first time that file was edited after the seed.
 *     A gate that is wrong about its best example teaches people to route around it. The negation is
 *     read as well: `assert(!r.isError, …)` is the positive control and must not count. Backlog 89 →
 *     69, and those twenty were never uncovered — the instrument was.
 *   v1.0.0 — 2026-08-15 — Initial (E2E test-quality audit, the missing-denial class).
 *   v1.0.1 — 2026-08-15 — Hash with line endings normalised. The shas were seeded from an LF tree
 *     and a Windows checkout hands readFileSync CRLF, so every seeded sha mismatched there and the
 *     gate reported two suites as EXPIRED — "you edited this" — with nobody having touched them.
 *     A gate that cannot go green on one of the platforms it runs on is a gate people route around.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const RUNNER = join(ROOT, 'test', 'run-e2e-ci.ts');
const EXEMPTIONS = join(ROOT, 'security', 'denial-coverage-exemptions.json');

interface Exemption {
    /** Why this suite has no denial case. Seeded entries say they are unreviewed, and mean it. */
    reason: string;
    /** sha256 of the suite at the time the reason was written. Edit the suite and it stops matching. */
    sha: string;
}

interface ExemptionFile {
    note: string;
    exempt: Record<string, Exemption>;
}

/**
 * The suites the runner actually executes. Parsed from the array text rather than imported, because
 * importing run-e2e-ci.ts runs it. Commented-out entries are skipped the same way the runner skips
 * them — a disabled suite is not a suite that lacks a denial, it is a suite that lacks a run.
 */
export function registeredSuites(runnerSource: string): string[] {
    const block = /const ALL_SUITES = \[([\s\S]*?)\n\];/.exec(runnerSource);
    if (!block) throw new Error('ALL_SUITES not found in test/run-e2e-ci.ts');
    return block[1]
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .flatMap(line => [...line.matchAll(/'(test\/[^']+)'/g)].map(m => m[1]));
}

/**
 * Is this occurrence of `isError` negated — `!r.isError` rather than `r.isError`?
 *
 * The difference is the whole meaning. `assert(r.isError, …)` says the call had to be refused;
 * `assert(!r.isError, …)` is the positive control saying the same call had to WORK. Counting the
 * second as a denial case would let a suite that only ever succeeds look fenced.
 *
 * Walk back over the identifier chain (`r.`, `theirs.`, `res.body.`) and any whitespace; the token
 * before it decides.
 */
function isNegatedAt(condition: string, at: number): boolean {
    let i = at - 1;
    while (i >= 0 && /[\w.$[\]]/.test(condition[i]!)) i--;
    while (i >= 0 && /\s/.test(condition[i]!)) i--;
    return i >= 0 && condition[i] === '!';
}

/**
 * Does this suite assert a refusal?
 *
 * The CONDITION of the assert has to mention the refusal, not the message. `assert(ok, 'expected 403
 * eventually')` is a sentence about a wish; `assert(r.status === 403, …)` is the test. Everything up
 * to the first top-level comma is the condition, so a message that happens to name a status cannot
 * make an unrelated assertion look like a denial case.
 *
 * TWO SHAPES COUNT, because this node has two surfaces and they refuse differently.
 *
 * HTTP answers with a status. 401 and 403 both count: which one a door sends is a design choice (a
 * 404 that refuses to confirm existence is a third), and this gate asks whether the suite ever asks
 * about refusal at all.
 *
 * MCP does not send a status. A tools/call that is refused comes back as a JSON-RPC error, which
 * every suite here reads as `isError`, so a status-only detector reported the MCP suites as having no
 * denial case while they were doing nothing else. It said so about test/e2e-mcp-cross-owner.ts — a
 * file that exists solely to prove owner B is refused seventeen ways — the first time that file was
 * edited after the seed. A gate that is wrong about its best example teaches people to route around
 * it, so it now measures the refusal rather than the transport that carries it.
 */
export function hasDenialAssertion(source: string): boolean {
    return denialKind(source) !== 'none';
}

/**
 * Is this status number compared with `!==` or `!=` (`r.status !== 403`), which asserts that the call
 * was NOT refused? Read the same way as a negated isError: it is the positive control.
 */
function isNegatedStatusAt(condition: string, at: number): boolean {
    let i = at - 1;
    while (i >= 0 && /\s/.test(condition[i]!)) i--;
    const op = condition.slice(Math.max(0, i - 2), i + 1);
    return op.endsWith('!==') || op.endsWith('!=');
}

/** The conditions of every `assert(...)` in a suite: everything up to its first top-level comma. */
function assertConditions(source: string): string[] {
    const out: string[] = [];
    const re = /\bassert\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        for (; i < source.length && depth > 0; i++) {
            const c = source[i];
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') depth--;
            else if (c === ',' && depth === 1) break;   // end of the condition
        }
        out.push(source.slice(start, i));
    }
    return out;
}

/**
 * Which refusal a suite asks about (QA audit 2026-10-16, P3-08).
 *
 *   second-principal  a 403, or an MCP isError: an authenticated caller who is refused. This is what
 *                     the gate's label promises: what a second owner, or an agent without the scope,
 *                     gets.
 *   anonymous-only    the only refusal is a 401, a caller with no credential. It proves the door asks
 *                     for one, and nothing about whose data a signed-in caller reaches.
 *   none              no refusal at all.
 *
 * The first version counted the first 401 or 403 anywhere, including `assert(r.status !== 403)`, so a
 * suite whose only "denial" was an anonymous 401 or a positive control passed a gate labelled "Every
 * suite asks what a second principal gets". A status compared with !== or != does not count now, the
 * same way a negated isError never did.
 */
export function denialKind(source: string): 'second-principal' | 'anonymous-only' | 'none' {
    let anonymous = false;
    for (const condition of assertConditions(source)) {
        for (const hit of condition.matchAll(/\b403\b/g)) {
            if (!isNegatedStatusAt(condition, hit.index)) return 'second-principal';
        }
        for (const hit of condition.matchAll(/\bisError\b/g)) {
            if (!isNegatedAt(condition, hit.index)) return 'second-principal';
        }
        for (const hit of condition.matchAll(/\b401\b/g)) {
            if (!isNegatedStatusAt(condition, hit.index)) anonymous = true;
        }
    }
    return anonymous ? 'anonymous-only' : 'none';
}

/**
 * The suite's content, hashed with LINE ENDINGS NORMALISED.
 *
 * Without the replace this gate cannot go green on Windows. The exemptions were seeded on a tree
 * with LF endings, `.gitattributes` normalises on `git add` so the committed bytes are LF, and a
 * Windows checkout puts CRLF in the worktree — which is what readFileSync hands us. Every seeded
 * sha therefore mismatched on that platform and two suites reported EXPIRED ("the file was edited")
 * with nobody having touched them since the seed, on a gate whose whole message is that you edited
 * something. Measured: test/e2e-portal.ts hashes 7834c004b9ccc67a as LF, which IS its stored sha,
 * and b6823b21d23de6d1 as it sits on disk.
 *
 * The line ending is not part of what an exemption is about — the reason is pinned to what the
 * suite ASSERTS — so normalising here is the fix rather than re-seeding the file per platform.
 */
const sha = (text: string): string =>
    createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** The second ratchet: suites whose refusals never involve an authenticated second principal (P3-08). */
const SECOND_PRINCIPAL = join(ROOT, 'security', 'denial-coverage-no-second-principal.json');

function loadFile(path: string): ExemptionFile {
    if (!existsSync(path)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(path, 'utf-8')) as ExemptionFile;
}

interface Measured { suite: string; sha: string; kind: ReturnType<typeof denialKind> }

/** Hold one class of offenders against its file: NEW when unlisted, EXPIRED when edited since. */
function judge(offenders: Measured[], file: ExemptionFile): { fresh: string[]; expired: string[]; stale: string[] } {
    const fresh: string[] = [];
    const expired: string[] = [];
    for (const m of offenders) {
        const e = file.exempt[m.suite];
        if (!e) fresh.push(m.suite);
        else if (e.sha !== m.sha) expired.push(m.suite);
    }
    const stale = Object.keys(file.exempt).filter(k => !offenders.some(m => m.suite === k));
    return { fresh, expired, stale };
}

function report(title: string, fileName: string, offenders: Measured[], j: ReturnType<typeof judge>, advice: string[]): void {
    console.log(`  ${title}`);
    console.log(`    listed in ${fileName}: ${offenders.length - j.fresh.length - j.expired.length}   EXPIRED (file edited): ${j.expired.length}   NEW: ${j.fresh.length}${j.stale.length ? `   now fixed: ${j.stale.length}` : ''}`);
    if (j.fresh.length || j.expired.length) {
        for (const line of advice) console.log(`    ${line}`);
        for (const s of j.fresh) console.log(`      NEW      ${s}`);
        for (const s of j.expired) console.log(`      EXPIRED  ${s}`);
    }
    if (j.stale.length) {
        console.log(`    Now covered, so these entries can go from security/${fileName}:`);
        for (const s of j.stale.sort()) console.log(`      ${s}`);
    }
    console.log('');
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const seedSecond = process.argv.includes('--seed-second-principal');

    const suites = registeredSuites(readFileSync(RUNNER, 'utf-8'));
    const measured: Measured[] = [];
    for (const suite of suites) {
        const full = join(ROOT, suite);
        if (!existsSync(full)) continue;   // check:e2e-registry owns "the list names a file that is gone"
        const source = readFileSync(full, 'utf-8');
        measured.push({ suite, sha: sha(source), kind: denialKind(source) });
    }
    const exemptions = loadFile(EXEMPTIONS);
    // No refusal at all, and listed in the first file: that file's backlog, as before.
    const none = measured.filter(m => m.kind === 'none' && exemptions.exempt[m.suite]);
    // Every other suite that never asks what an authenticated second principal gets: a 401 alone, a
    // status compared with !==, or nothing at all on a suite the first detector counted as covered.
    const noSecond = measured.filter(m => m.kind !== 'second-principal' && !none.includes(m));

    if (seed) {
        const exempt: Record<string, Exemption> = {};
        for (const m of measured.filter(x => x.kind === 'none')) {
            exempt[m.suite] = {
                reason: 'Seeded 2026-08-15 from the E2E test-quality audit. NOT YET REVIEWED: this suite '
                    + 'drives its surface with one principal and never asks what a second one gets. Either add a '
                    + 'cross-owner or cross-scope refusal, or replace this line with why the surface has no '
                    + 'refusal to test.',
                sha: m.sha,
            };
        }
        const out: ExemptionFile = {
            note: 'Registered E2E suites with no assertion about a 401 or 403. Seeded from the state on '
                + '2026-08-15 so the gate can only ratchet down. The `sha` pins the reason to the file it was '
                + 'written about: EDIT THE SUITE AND ITS EXEMPTION EXPIRES, because the person editing it is '
                + 'the one person who has the context to add the missing case. Re-stamping the sha without '
                + 'adding a denial is available and is a decision someone has to write down.',
            exempt,
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(out, null, 2) + '\n');
        console.log(`Seeded ${Object.keys(exempt).length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }
    if (seedSecond) {
        const exempt: Record<string, Exemption> = {};
        for (const m of noSecond) {
            exempt[m.suite] = {
                reason: `Seeded 2026-10-16 (QA audit P3-08). NOT YET REVIEWED: this suite's only refusal is ${m.kind === 'anonymous-only'
                    ? 'a 401 for a caller with no credential' : 'none the stricter detector reads (a status compared with !== is a positive control)'}; `
                    + 'it never asks what a second owner, or an agent without the scope, gets. Add a 403 or an MCP refusal for an '
                    + 'authenticated second principal, or replace this line with why the surface has none (a 404 that hides '
                    + "another owner's object is a refusal; say so here).",
                sha: m.sha,
            };
        }
        const out: ExemptionFile = {
            note: 'Registered E2E suites that ask about no refusal of an AUTHENTICATED second principal: their only refusal is a '
                + '401 for a caller with no credential, or a status compared with !== (a positive control). The first version '
                + 'of check:denial-coverage counted any 401 or 403 in a condition, so these passed a gate labelled "Every suite '
                + 'asks what a second principal gets" (QA audit 2026-10-16, P3-08). Seeded so the gate can only ratchet down; '
                + 'the `sha` pins each reason to the file it was written about, and editing the suite expires it.',
            exempt,
        };
        writeFileSync(SECOND_PRINCIPAL, JSON.stringify(out, null, 2) + '\n');
        console.log(`Seeded ${noSecond.length} entries into ${relative(ROOT, SECOND_PRINCIPAL)}`);
        return;
    }

    const first = judge(none, exemptions);
    // An entry of the first file whose suite now asserts a 401 moves to the second class: it is no
    // longer "no refusal at all", and it is stale there.
    const second = judge(noSecond, loadFile(SECOND_PRINCIPAL));

    console.log('');
    console.log('  Denial coverage — does the suite ever ask what a second principal gets?');
    console.log('  ' + '─'.repeat(62));
    console.log(`  registered suites                       ${String(measured.length).padStart(5)}`);
    console.log(`  refuse an authenticated second caller   ${String(measured.filter(m => m.kind === 'second-principal').length).padStart(5)}   (a 403 or an MCP refusal)`);
    console.log(`  refuse only a caller with no credential ${String(measured.filter(m => m.kind === 'anonymous-only').length).padStart(5)}   (a 401 alone)`);
    console.log(`  assert no refusal at all                ${String(measured.filter(m => m.kind === 'none').length).padStart(5)}`);
    console.log('');
    report('No refusal at all', 'denial-coverage-exemptions.json', none, first, [
        'These suites were EDITED while still carrying no denial case, or are new. You are in the file and have the',
        'context: add a cross-owner or cross-scope refusal, or rewrite the reason and re-seed its sha.',
    ]);
    report('No refusal of an authenticated second principal', 'denial-coverage-no-second-principal.json', noSecond, second, [
        'A 401 proves the door asks for a credential and nothing about whose data a signed-in caller reaches. Add a',
        '403 or an MCP refusal for a second owner or an agent without the scope, or record in',
        'security/denial-coverage-no-second-principal.json why the surface has none.',
    ]);

    const blocking = first.fresh.length + first.expired.length + second.fresh.length + second.expired.length;
    if (strict && blocking) {
        console.error(`✖ ${first.fresh.length + second.fresh.length} new and ${first.expired.length + second.expired.length} expired suite(s) that ask no second principal for a refusal.`);
        process.exit(1);
    }
    console.log(blocking ? '  (report only — pass --strict to gate)' : '  ✓ every registered suite refuses a second principal or says why it does not');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
