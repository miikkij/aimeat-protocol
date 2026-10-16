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
 *   THREE QUESTIONS, each with its own ratcheted list:
 *   1. Does the suite assert that a SECOND principal is refused: a 403, or a refused MCP call
 *      (`isError`)? A suite with neither is in `exempt`.
 *   2. Is the only refusal it asserts an anonymous 401? That proves the sign-in check and nothing
 *      about who else may act, so such a suite is in `anonymous_only` (QA audit 2026-10, P3-08: the
 *      gate's label promised question 1 while a single 401 anywhere satisfied it).
 *   3. Does every authenticated ROUTE of the contract have a refusal assertion in some suite?
 *      A suite that refuses one route says nothing about the forty others it drives. The routes
 *      with none are in security/route-refusal-exemptions.json (scripts/lib/route-refusals.ts says
 *      how a refusal is tied to a route).
 *
 *   WHY THE SUITE EXEMPTION EXPIRES, which is the whole design. `check-route-scopes.ts` was seeded
 *   with 340 offenders on 2026-08-10 so it could only ratchet down, and by 2026-08-15 it was still
 *   340: every entry carried the same generated sentence, nobody owned any of them, and the gate was
 *   green the entire time. Here a suite's exemption is pinned to the suite's CONTENT: edit the file
 *   and its exemption stops covering it. You are not asked to fix the backlog; you are asked to leave
 *   the file you touched better than you found it, which is the one moment you already have the
 *   context to do it. The route list is pinned differently: an entry whose route a suite now refuses
 *   fails until it is deleted, and ROUTE_CEILING is lowered in the same change, so it only shrinks.
 * @structure
 *   - registeredSuites(): the ALL_SUITES list in test/run-e2e-ci.ts, parsed as text (the runner is
 *     the source of truth for what actually executes; a file on no list is silent, not skipped)
 *   - denialKinds(): which refusals a suite asserts (second principal, anonymous)
 *   - hasDenialAssertion(): kept for callers; true for either kind
 *   - main(): the three lists; --strict exits 1
 * @usage
 *   cd aimeat && pnpm check:denial-coverage            # the hook/CI gate (strict)
 *   cd aimeat && pnpm check:denial-coverage:report     # report
 *   cd aimeat && pnpm check:denial-coverage:seed       # rewrite `exempt` from today's state (a decision)
 * @version-history
 *   2026-10-16 — ROUTE_CEILING 491: e2e-notifications refuses DELETE /v1/notifications to an agent
 *     without memory:delete, so its exemption is gone (invariant 8 review).
 *   2026-10-16 — AIMEAT_DENIAL_ROUTES=off runs the suite question alone, for a fixture tree with no
 *     openapi.yaml; without it the route question read a missing file and crashed, so every fixture
 *     case exited 1 whatever the suite asserted.
 *   2026-10-16 — ROUTE_CEILING 490: GET /v1/compliance/report/mine is refused by test/e2e-ai-label-shares.ts.
 *   2026-10-16 — denialKind answers the same two kinds as one word; the separate
 *     denial-coverage-no-second-principal.json list of a parallel P3-08 change is folded into
 *     `anonymous_only` here.
 *   v1.2.0 — 2026-10-16 — QA audit P3-08 and W29. A status refusal on the negated side of a
 *     comparison (`r.status !== 403`) no longer counts, the way `!r.isError` never did. A suite whose
 *     only refusal is an anonymous 401 is its own list (`anonymous_only`), because the label says
 *     "what a second principal gets" and a 401 answers who is signed in. And the route question:
 *     every authenticated operation in openapi.yaml needs a refusal assertion in some suite, or an
 *     entry in security/route-refusal-exemptions.json; seeded 2026-10-16 with 504 of 1322 (513 on
 *     the tree this change started from, the W29 suites refuse the other nine).
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
import { authenticatedOperations, isNegatedStatus, refusedRoutes, routeMatchers } from './lib/route-refusals.js';

const ROOT = process.cwd();
const RUNNER = join(ROOT, 'test', 'run-e2e-ci.ts');
const EXEMPTIONS = join(ROOT, 'security', 'denial-coverage-exemptions.json');
const ROUTE_EXEMPTIONS = join(ROOT, 'security', 'route-refusal-exemptions.json');
const OPENAPI = join(ROOT, '..', 'openapi.yaml');

/**
 * How many entries security/route-refusal-exemptions.json may hold. Lower it in the change that
 * deletes entries; raising it is the developer's decision.
 */
export const ROUTE_CEILING = 490;

interface Exemption {
    /** Why this suite has no denial case. Seeded entries say they are unreviewed, and mean it. */
    reason: string;
    /** sha256 of the suite at the time the reason was written. Edit the suite and it stops matching. */
    sha: string;
}

interface ExemptionFile {
    note: string;
    exempt: Record<string, Exemption>;
    /** Suites whose only refusal is an anonymous 401 (P3-08). Same shape, same expiry. */
    anonymous_only?: Record<string, Exemption>;
}

interface RouteExemptionFile { note: string; exempt: Record<string, string> }

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
 * Which refusals does this suite assert?
 *
 * The CONDITION of the assert has to mention the refusal, not the message. `assert(ok, 'expected 403
 * eventually')` is a sentence about a wish; `assert(r.status === 403, …)` is the test. Everything up
 * to the first top-level comma is the condition, so a message that happens to name a status cannot
 * make an unrelated assertion look like a denial case.
 *
 * `second`: a 403, or a refused MCP call. HTTP answers with a status; MCP does not send one, and a
 * tools/call that is refused comes back as a JSON-RPC error, which every suite here reads as
 * `isError`. A status-only detector once reported the MCP suites as having no denial case while they
 * were doing nothing else (test/e2e-mcp-cross-owner.ts, seventeen refusals of owner B).
 *
 * `anonymous`: a 401. It proves the route asks for a credential, and nothing about whether another
 * signed-in principal is kept out.
 *
 * Either kind counts only on the asserted side of the comparison: `r.status !== 403` and
 * `!r.isError` are positive controls.
 */
export function denialKinds(source: string): { second: boolean; anonymous: boolean } {
    const kinds = { second: false, anonymous: false };
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
        for (const hit of condition.matchAll(/\b40([13])\b/g)) {
            if (isNegatedStatus(condition, hit.index)) continue;
            if (hit[1] === '3') kinds.second = true; else kinds.anonymous = true;
        }
        for (const hit of condition.matchAll(/\bisError\b/g)) {
            if (!isNegatedAt(condition, hit.index)) kinds.second = true;
        }
        if (kinds.second && kinds.anonymous) break;
    }
    return kinds;
}

/** Does this suite assert any refusal at all (either kind)? */
export function hasDenialAssertion(source: string): boolean {
    const k = denialKinds(source);
    return k.second || k.anonymous;
}

/** The suite's strongest refusal as one word: a signed-in second caller, an anonymous 401 alone, or none. */
export function denialKind(source: string): 'second-principal' | 'anonymous-only' | 'none' {
    const k = denialKinds(source);
    return k.second ? 'second-principal' : k.anonymous ? 'anonymous-only' : 'none';
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

function loadRouteExemptions(): RouteExemptionFile {
    if (!existsSync(ROUTE_EXEMPTIONS)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(ROUTE_EXEMPTIONS, 'utf-8')) as RouteExemptionFile;
}

const SUITE_SEED_REASON = 'Seeded 2026-08-15 from the E2E test-quality audit. NOT YET REVIEWED: this suite '
    + 'drives its surface with one principal and never asks what a second one gets. Either add a '
    + 'cross-owner or cross-scope refusal, or replace this line with why the surface has no '
    + 'refusal to test.';
const ANONYMOUS_SEED_REASON = 'Seeded 2026-10-16 from the QA audit (P3-08). NOT YET REVIEWED: the only refusal '
    + 'this suite asserts is an anonymous 401, which proves the sign-in check and nothing about whether '
    + 'another signed-in principal is kept out. Add a cross-owner or cross-scope refusal (a 403 or a '
    + 'refused MCP call), or replace this line with why the surface has no second principal to refuse.';
const ROUTE_PLACEHOLDER = 'NO REFUSAL TEST';
const ROUTE_SEED_REASON = `${ROUTE_PLACEHOLDER}: no registered E2E suite asserted a 401 or 403 from this route on 2026-10-16 `
    + '(QA audit W29). Add the refusal to the suite of its area, or replace this line with why the route has none to test.';

/** Pin each suite to an exemption reason; keep a reason somebody already wrote while the sha still matches. */
function pinned(rows: { suite: string; sha: string }[], previous: Record<string, Exemption> | undefined, reason: string): Record<string, Exemption> {
    const out: Record<string, Exemption> = {};
    for (const r of rows) {
        const old = previous?.[r.suite];
        out[r.suite] = old && old.sha === r.sha ? old : { reason, sha: r.sha };
    }
    return out;
}

/** Fresh, expired and now-covered entries of one sha-pinned list. */
function compare(rows: { suite: string; sha: string }[], list: Record<string, Exemption>): { fresh: string[]; expired: string[]; stale: string[] } {
    const fresh: string[] = [];
    const expired: string[] = [];
    for (const r of rows) {
        const e = list[r.suite];
        if (!e) fresh.push(r.suite);
        else if (e.sha !== r.sha) expired.push(r.suite);
    }
    const stale = Object.keys(list).filter(k => !rows.some(r => r.suite === k));
    return { fresh, expired, stale };
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const seedAnonymous = process.argv.includes('--seed-anonymous');
    const seedRoutes = process.argv.includes('--seed-routes');

    const suites = registeredSuites(readFileSync(RUNNER, 'utf-8'));
    const none: { suite: string; sha: string }[] = [];
    const anonymousOnly: { suite: string; sha: string }[] = [];
    const sources: string[] = [];
    for (const suite of suites) {
        const full = join(ROOT, suite);
        if (!existsSync(full)) continue;   // check:e2e-registry owns "the list names a file that is gone"
        const source = readFileSync(full, 'utf-8');
        sources.push(source);
        const k = denialKinds(source);
        if (!k.second && !k.anonymous) none.push({ suite, sha: sha(source) });
        else if (!k.second) anonymousOnly.push({ suite, sha: sha(source) });
    }

    // AIMEAT_DENIAL_ROUTES=off asks the suite question alone: a fixture tree for the detector's own
    // unit test has no openapi.yaml and no route list (test/unit/security-gates-fail.test.ts).
    const routesOn = process.env.AIMEAT_DENIAL_ROUTES !== 'off';
    const authenticated = routesOn ? authenticatedOperations(OPENAPI) : [];
    const refused = refusedRoutes(sources, routeMatchers(authenticated));
    const unrefused = authenticated.filter(k => !refused.has(k));

    const file = loadExemptions();
    if (seed || seedAnonymous) {
        const out: ExemptionFile = {
            note: 'Registered E2E suites with no refusal of a second principal. `exempt`: suites that assert no refusal at all '
                + '(seeded 2026-08-15). `anonymous_only`: suites whose only refusal is an anonymous 401 (seeded 2026-10-16, QA audit '
                + 'P3-08). Both were seeded from the state of their day so the gate can only ratchet down. The `sha` pins the reason '
                + 'to the file it was written about: EDIT THE SUITE AND ITS EXEMPTION EXPIRES, because the person editing it is the '
                + 'one person who has the context to add the missing case. Re-stamping the sha without adding a denial is available '
                + 'and is a decision someone has to write down.',
            exempt: seed ? pinned(none, undefined, SUITE_SEED_REASON) : file.exempt,
            anonymous_only: seedAnonymous ? pinned(anonymousOnly, file.anonymous_only, ANONYMOUS_SEED_REASON) : (file.anonymous_only ?? {}),
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(out, null, 2) + '\n');
        console.log(`Wrote ${relative(ROOT, EXEMPTIONS)}: exempt ${Object.keys(out.exempt).length}, anonymous_only ${Object.keys(out.anonymous_only ?? {}).length}`);
    }
    if (seedRoutes) {
        const previous = loadRouteExemptions().exempt;
        const exempt: Record<string, string> = {};
        for (const k of unrefused) exempt[k] = previous[k] ?? ROUTE_SEED_REASON;
        const out: RouteExemptionFile = {
            note: 'Authenticated routes of openapi.yaml (a non-empty `security` list without the empty alternative) that no registered '
                + 'E2E suite asserts a refusal from: no `test(` block both names the route and asserts a 401 or 403 that is not negated '
                + '(scripts/lib/route-refusals.ts; pnpm check:denial-coverage). Seeded 2026-10-16 from the QA audit (W29). An entry '
                + `that starts with ${ROUTE_PLACEHOLDER} is a QUESTION: nobody has written the refusal yet. An ANSWER says why the route `
                + 'has no refusal to test. The list only shrinks: an entry whose route a suite now refuses fails the gate until it is '
                + 'deleted, and ROUTE_CEILING in scripts/check-denial-coverage.ts is lowered in the same change. A new entry or a higher '
                + 'ceiling is the developer\'s decision.',
            exempt,
        };
        writeFileSync(ROUTE_EXEMPTIONS, JSON.stringify(out, null, 2) + '\n');
        console.log(`Wrote ${relative(ROOT, ROUTE_EXEMPTIONS)}: ${unrefused.length} routes. Set ROUTE_CEILING = ${unrefused.length}.`);
    }
    if (seed || seedAnonymous || seedRoutes) return;

    const suiteCmp = compare(none, file.exempt);
    const anonCmp = compare(anonymousOnly, file.anonymous_only ?? {});
    const routeList = loadRouteExemptions().exempt;
    const routeKeys = Object.keys(routeList);
    const routeFresh = unrefused.filter(k => !(k in routeList));
    const routeNowRefused = routeKeys.filter(k => refused.has(k));
    const routeGone = routeKeys.filter(k => !authenticated.includes(k));
    const routeQuestions = routeKeys.filter(k => String(routeList[k]).startsWith(ROUTE_PLACEHOLDER)).length;

    console.log('');
    console.log('  Denial coverage — does the suite ask what a second principal gets, and is every route refused?');
    console.log('  ' + '─'.repeat(62));
    console.log(`  registered suites      ${String(suites.length).padStart(5)}`);
    console.log(`  refuse a 2nd principal ${String(suites.length - none.length - anonymousOnly.length).padStart(5)}`);
    console.log(`  only an anonymous 401  ${String(anonymousOnly.length).padStart(5)}   (anonymous_only, may only shrink)`);
    console.log(`  no refusal at all      ${String(none.length).padStart(5)}   (exempt, may only shrink)`);
    console.log(`  EXPIRED (file edited)  ${String(suiteCmp.expired.length + anonCmp.expired.length).padStart(5)}`);
    console.log(`  NEW, not exempt        ${String(suiteCmp.fresh.length + anonCmp.fresh.length).padStart(5)}`);
    console.log(`  authenticated routes   ${String(authenticated.length).padStart(5)}`);
    console.log(`  with a refusal test    ${String(refused.size).padStart(5)}`);
    console.log(`  without one            ${String(unrefused.length).padStart(5)}   (listed ${routeKeys.length}, ceiling ${ROUTE_CEILING}, still ${ROUTE_PLACEHOLDER} ${routeQuestions})`);
    console.log('');

    const problems: string[] = [];
    const listing = (title: string[], tag: string, items: string[]): void => {
        if (!items.length) return;
        for (const line of title) console.log(`  ${line}`);
        console.log('');
        for (const s of items) console.log(`    ${tag.padEnd(9)}${s}`);
        console.log('');
    };

    listing(['A suite that drives a surface with ONE principal proves the feature and cannot prove',
        'the fence: delete a scope check and it stays green. Add a cross-owner or cross-scope',
        'refusal, or record in security/denial-coverage-exemptions.json why there is none.'], 'NEW', suiteCmp.fresh);
    listing(['The only refusal these suites assert is an anonymous 401. Add a refusal of a signed-in',
        'second principal (a 403 or a refused MCP call), or record in `anonymous_only` why there is none.'], 'NEW 401', anonCmp.fresh);
    listing(['These suites were EDITED while still carrying no refusal of a second principal. The exemption',
        'was pinned to the old content on purpose: you are in the file, you have the context, add the case.',
        'If the surface genuinely has no refusal to test, rewrite the reason and re-seed its sha.'], 'EXPIRED', [...suiteCmp.expired, ...anonCmp.expired]);
    listing(['Now covered, so these entries can go from security/denial-coverage-exemptions.json:'], 'COVERED', [...suiteCmp.stale, ...anonCmp.stale].sort());
    listing(['An authenticated route no suite asserts a refusal from: remove its check and every suite stays',
        'green. Add the refusal to the suite of its area.'], 'NEW ROUTE', routeFresh);
    listing([`Now refused by a suite, so delete these entries from ${relative(ROOT, ROUTE_EXEMPTIONS)}:`], 'REFUSED', routeNowRefused);
    listing(['Listed routes the contract no longer has (delete the entries):'], 'GONE', routeGone);

    if (suiteCmp.fresh.length || anonCmp.fresh.length) problems.push(`${suiteCmp.fresh.length + anonCmp.fresh.length} new suite(s) without a refusal of a second principal`);
    if (suiteCmp.expired.length || anonCmp.expired.length) problems.push(`${suiteCmp.expired.length + anonCmp.expired.length} edited suite(s) still without one`);
    if (routeFresh.length) problems.push(`${routeFresh.length} authenticated route(s) without a refusal test`);
    if (routeNowRefused.length) problems.push(`${routeNowRefused.length} listed route(s) now refused`);
    if (routeGone.length) problems.push(`${routeGone.length} listed route(s) not in the contract`);
    if (routesOn && routeKeys.length > ROUTE_CEILING) problems.push(`the route list holds ${routeKeys.length} entries and the ceiling is ${ROUTE_CEILING}`);
    if (routesOn && routeKeys.length < ROUTE_CEILING) problems.push(`the route list holds ${routeKeys.length} entries: lower ROUTE_CEILING in scripts/check-denial-coverage.ts from ${ROUTE_CEILING} to ${routeKeys.length}`);

    if (problems.length) {
        for (const p of problems) console.log(`  ✖ ${p}`);
        if (strict) process.exit(1);
        console.log('  (report only — pass --strict to gate)');
        return;
    }
    console.log('  ✓ every registered suite refuses a second principal or says why not, and every authenticated route is refused or listed');
}

// Run when executed as a script; a unit test imports the detectors without running the gate.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/check-denial-coverage.ts')) main();
