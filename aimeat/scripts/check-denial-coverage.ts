/**
 * @file scripts/check-denial-coverage.ts
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
 *   - hasDenialAssertion(): an `assert(...)` whose CONDITION mentions 401 or 403
 *   - main(): compare against security/denial-coverage-exemptions.json; --strict exits 1
 * @usage
 *   cd aimeat && pnpm check:denial-coverage            # report
 *   cd aimeat && pnpm check:denial-coverage --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:denial-coverage --seed     # rewrite the file from today's state
 * @version-history
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
import { join, relative } from 'node:path';
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
        const condition = source.slice(start, i);
        if (/\b40[13]\b/.test(condition)) return true;
        for (const hit of condition.matchAll(/\bisError\b/g)) {
            if (!isNegatedAt(condition, hit.index)) return true;
        }
    }
    return false;
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

function loadExemptions(): ExemptionFile {
    if (!existsSync(EXEMPTIONS)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const suites = registeredSuites(readFileSync(RUNNER, 'utf-8'));
    const missing: { suite: string; sha: string }[] = [];
    for (const suite of suites) {
        const full = join(ROOT, suite);
        if (!existsSync(full)) continue;   // check:e2e-registry owns "the list names a file that is gone"
        const source = readFileSync(full, 'utf-8');
        if (!hasDenialAssertion(source)) missing.push({ suite, sha: sha(source) });
    }

    if (seed) {
        const exempt: Record<string, Exemption> = {};
        for (const m of missing) {
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
        console.log(`Seeded ${missing.length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }

    const { exempt } = loadExemptions();
    const fresh: string[] = [];
    const expired: string[] = [];
    for (const m of missing) {
        const e = exempt[m.suite];
        if (!e) fresh.push(m.suite);
        else if (e.sha !== m.sha) expired.push(m.suite);
    }
    const stale = Object.keys(exempt).filter(k => !missing.some(m => m.suite === k));

    console.log('');
    console.log('  Denial coverage — does the suite ever ask what a second principal gets?');
    console.log('  ' + '─'.repeat(62));
    console.log(`  registered suites      ${String(suites.length).padStart(5)}`);
    console.log(`  with a denial case     ${String(suites.length - missing.length).padStart(5)}`);
    console.log(`  without one            ${String(missing.length).padStart(5)}`);
    console.log(`  of those, exempt       ${String(missing.length - fresh.length - expired.length).padStart(5)}   (seeded backlog, may only shrink)`);
    console.log(`  EXPIRED (file edited)  ${String(expired.length).padStart(5)}`);
    console.log(`  NEW, not exempt        ${String(fresh.length).padStart(5)}`);
    if (stale.length) console.log(`  exemptions now fixed   ${String(stale.length).padStart(5)}   (remove them from the file)`);
    console.log('');

    if (fresh.length) {
        console.log('  A suite that drives a surface with ONE principal proves the feature and cannot prove');
        console.log('  the fence: delete a scope check and it stays green. Add a cross-owner or cross-scope');
        console.log('  refusal, or record in security/denial-coverage-exemptions.json why there is none.');
        console.log('');
        for (const s of fresh) console.log(`    NEW      ${s}`);
        console.log('');
    }
    if (expired.length) {
        console.log('  These suites were EDITED while still carrying no denial case. The exemption was pinned');
        console.log('  to the old content on purpose: you are in the file, you have the context, add the case.');
        console.log('  If the surface genuinely has no refusal to test, rewrite the reason and re-seed its sha.');
        console.log('');
        for (const s of expired) console.log(`    EXPIRED  ${s}`);
        console.log('');
    }
    if (stale.length) {
        console.log('  Now covered, so these entries can go from security/denial-coverage-exemptions.json:');
        console.log('');
        for (const s of stale.sort()) console.log(`    ${s}`);
        console.log('');
    }

    const blocking = fresh.length + expired.length;
    if (strict && blocking) {
        console.error(`✖ ${fresh.length} new and ${expired.length} expired suite(s) with no denial case.`);
        process.exit(1);
    }
    console.log(blocking ? '  (report only — pass --strict to gate)' : '  ✓ every registered suite either tests a refusal or says why it does not');
}

main();
