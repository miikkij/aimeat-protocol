/**
 * @file scripts/check-outbound-fetch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for Rule 10 invariant 3: any fetch whose URL is not a compile-time constant
 *   goes through safeFetch(), which re-validates every redirect hop. A validated host can 3xx-bounce
 *   to 169.254.169.254 or to loopback, so validating only the first hop validates nothing.
 *
 *   The federation carve-out is real and deliberate — peer-to-peer calls go to operator-approved URLs
 *   and safeFetch would break legitimate private-network federation — but it lives nowhere in the
 *   code, so a reader cannot tell an intentional peer fetch from an oversight. Neither can a
 *   reviewer, and the August 2026 audit could not either without reading all fifty-one call sites.
 *   This turns each one into either a safeFetch call or a written, reviewable statement.
 *
 *   Ratchet, not a wall: seeded with today's call sites, so the gate fails only on a NEW one. Same
 *   shape as check-route-scopes.ts and check-silent-catch.ts.
 *
 *   STALE ENTRIES FAIL UNDER --strict, like check:classification-reach. An entry that matches no call
 *   site is not a harmless leftover here: the key is the file plus the first 60 characters of the
 *   line, so a later edit that writes that same line again (turning a safeFetch back into fetch) is
 *   absorbed by a reason written for code that no longer exists. Ten such entries sat in the file
 *   for weeks after their calls moved to safeFetch (QA audit 2026-10, P3-04).
 *
 *   ONE ENTRY COVERS ONE CALL. The second identical line in the same file is keyed `<key> #2`, the
 *   third `<key> #3`, so a copy of an exempted line is a new finding with a key of its own and needs
 *   its own reason.
 * @structure
 *   - collectFetches(): every bare fetch( with a non-literal URL under src/
 *   - keyFindings(): the exemption key per finding, numbered per repeat within a file
 *   - compareExemptions(): fresh (not exempt) and stale (exempt, matching no call) lists
 *   - main(): compare against security/outbound-fetch-exemptions.json; --strict gates; --seed rewrites
 * @usage
 *   cd aimeat && pnpm check:outbound-fetch            # report
 *   cd aimeat && pnpm check:outbound-fetch --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:outbound-fetch --seed     # rewrite the exemption file
 * @version-history
 *   2026-10-16 — A `//` after a colon is kept: the comment strip cut constant URLs at their scheme
 *     and reported fetch('https://…', …) as a caller-chosen URL. Found by the new fixture test
 *     (test/unit/security-gates-fail.test.ts, QA audit S10-09).
 *   v1.2.0 — 2026-10-16 — A stale exemption (one matching no call site) fails under --strict, and a
 *     repeated identical line is keyed `#2`, `#3` so each call needs its own entry. main() runs only
 *     as the command, so the unit test imports compareExemptions (QA audit P3-04).
 *   v1.1.0 — 2026-08-15 — Comments are stripped before the match. The gate blocked every commit
 *     in the repo over a sentence explaining a CORS header — prose containing "a fetch()" — and a
 *     check that reads documentation as code taxes exactly the person it should leave alone. The
 *     count drops 87 -> 73: fourteen of the seeded findings were never calls.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 6).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXEMPTIONS = join(ROOT, 'security', 'outbound-fetch-exemptions.json');

interface Finding { file: string; line: number; snippet: string }
interface ExemptionFile { note: string; exempt: Record<string, string> }

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            // src/static is browser code: its fetch() runs in the user's tab, not on the node, so
            // server-side SSRF does not apply there.
            if (entry === 'static' || entry === 'generated') continue;
            walk(full, out);
        } else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** A URL argument that is a plain string literal cannot be steered by a caller, so it is not the
 *  hazard this rule is about. Everything else (a variable, a template with a hole, a property) is. */
function isConstantUrl(arg: string): boolean {
    const t = arg.trim();
    if (/^['"][^'"]*['"]$/.test(t)) return true;
    if (/^`[^`${}]*`$/.test(t)) return true;
    return false;
}

export function collectFetches(files: string[]): Finding[] {
    const findings: Finding[] = [];
    for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (rel.endsWith('utils/url-validator.ts')) continue;   // safeFetch itself

        const lines = source.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // A COMMENT is not a call. This gate blocked every commit in the repo on 2026-08-15 over
            // the sentence "without it a fetch() sees the 206 and none of its geometry" — prose
            // explaining a CORS header, in a file whose author was mid-change. A check that reads
            // documentation as code costs whoever is writing documentation, which is exactly the
            // person it should leave alone. Line comments and single-line block comments are
            // dropped; a `fetch(` inside a multi-line block comment is rare enough to accept, and
            // errs toward reporting rather than missing.
            // A `//` after a colon is a URL scheme, not a comment: cutting there turned
            // fetch('https://x', …) into fetch('https: and reported a constant URL as caller-chosen.
            const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '').replace(/(^|[^:])\/\/.*$/, '$1');
            if (!code.trim()) continue;
            // `await fetch(` / `= fetch(` / `return fetch(` — but not safeFetch(, and not a method
            // call like `res.fetch(` or `session.fetch(` (those are the browser SDK's own helper).
            const m = /(^|[^.\w])fetch\s*\(/.exec(code);
            if (!m) continue;
            if (/safeFetch\s*\(/.test(line)) continue;
            const after = code.slice(m.index + m[0].length);
            if (isConstantUrl(after.split(',')[0])) continue;
            findings.push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 96) });
        }
    }
    return findings;
}

const softKey = (f: Finding) => `${f.file}:${f.snippet.slice(0, 60)}`;

export interface KeyedFinding extends Finding { key: string }

/**
 * The exemption key of each finding. The first call with a given soft key in a file keeps the bare
 * key, which is what every existing entry is written as; the second is `<key> #2`, the third
 * `<key> #3`. Findings arrive in file and line order, so the numbering follows the source.
 */
export function keyFindings(findings: Finding[]): KeyedFinding[] {
    const seen = new Map<string, number>();
    return findings.map(f => {
        const base = softKey(f);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return { ...f, key: n === 1 ? base : `${base} #${n}` };
    });
}

export interface Comparison {
    /** Calls no entry covers: the gate's failure. */
    fresh: KeyedFinding[];
    /** Entries that cover no call: the code they describe is gone, so they go too. */
    stale: string[];
}

export function compareExemptions(findings: Finding[], exempt: Record<string, string>): Comparison {
    const keyed = keyFindings(findings);
    const found = new Set(keyed.map(f => f.key));
    return {
        fresh: keyed.filter(f => !(f.key in exempt)),
        stale: Object.keys(exempt).filter(k => !found.has(k)).sort(),
    };
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const findings = keyFindings(collectFetches(walk(SRC)));

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const f of findings) {
            const fed = f.file.includes('federation') || /peer|genesis/i.test(f.file);
            exempt[f.key] = fed
                ? 'Federation outbound to an operator-approved peer URL. Deliberate: safeFetch would break '
                  + 'legitimate private-network federation. Ruled by-design 2026-07-10.'
                : 'Seeded 2026-08-10 from the August audit. Not yet reviewed: decide whether this URL can be '
                  + 'influenced by a low-privilege principal, and move it to safeFetch if so.';
        }
        const out: ExemptionFile = {
            note: 'Bare fetch() call sites with a non-constant URL. Seeded from the state on 2026-08-10 so the '
                + 'gate can only ratchet down. A new one must either use safeFetch (utils/url-validator.ts) or '
                + 'be added here with a reason. The federation entries are the documented carve-out.',
            exempt,
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(out, null, 2) + '\n');
        console.log(`Seeded ${findings.length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const { fresh, stale } = compareExemptions(findings, exempt);
    const fed = findings.filter(f => (exempt[f.key] ?? '').startsWith('Federation outbound'));

    console.log('');
    console.log('  Outbound fetch — Rule 10 invariant 3');
    console.log('  ' + '─'.repeat(62));
    console.log(`  bare non-constant fetch   ${String(findings.length).padStart(4)}`);
    console.log(`  of which federation       ${String(fed.length).padStart(4)}   (documented carve-out)`);
    console.log(`  NEW, not exempt           ${String(fresh.length).padStart(4)}`);
    console.log(`  stale entries             ${String(stale.length).padStart(4)}   (match no call site)`);
    console.log('');

    if (stale.length) {
        console.log('  These entries match no call site any more. Delete them from');
        console.log('  security/outbound-fetch-exemptions.json: the same line written again later would');
        console.log('  pass under a reason written for code that is gone.');
        console.log('');
        for (const k of stale) console.log(`    ${k}`);
        console.log('');
    }

    if (fresh.length) {
        console.log('  A non-constant outbound URL goes through safeFetch(), which re-validates every');
        console.log('  redirect hop. If this one is a deliberate exception, add it with a reason to');
        console.log('  security/outbound-fetch-exemptions.json.');
        console.log('');
        for (const f of fresh) console.log(`    ${f.file}:${f.line}  ${f.snippet}    [key: ${f.key}]`);
        console.log('');
    }

    if (strict && (fresh.length || stale.length)) {
        if (fresh.length) console.error(`✖ ${fresh.length} new bare outbound fetch(es).`);
        if (stale.length) console.error(`✖ ${stale.length} stale outbound-fetch exemption(s).`);
        process.exit(1);
    }
    console.log(fresh.length || stale.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ no new bare outbound fetches, no stale entries');
}

// Only when run as the command, so the unit test can import compareExemptions without printing
// this report. Same guard as check-route-scopes.ts.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-outbound-fetch.ts')) {
    main();
}
