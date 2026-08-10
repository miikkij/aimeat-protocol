/**
 * @file scripts/check-ext-entrypoints.ts
 * @description Every road into the extension sandbox applies the same guards. `executeExtensionAction`
 *   is reached from several places and each caller assembles the sandbox's capability object by hand,
 *   so nothing in the engine's signature requires a guard to have run. The August 2026 audit found
 *   five findings that are each one missing line in one of those copies: MCP invoke skipping the
 *   paywall and the toll, MCP install skipping both quotas, the scheduler skipping the memory quota
 *   (the June H-5 fix landed on REST and MCP only), the scheduler using a bare fetch where the others
 *   use safeFetch, and the email escape existing in triplicate.
 *
 *   This is the cheap half of the fix. The durable half is step 4: one services/extension-ctx.ts that
 *   builds the context with the guards already applied, after which this check is replaced by an
 *   ESLint rule that forbids building the context anywhere else.
 * @structure REQUIRED: the guards a file invoking the sandbox must also import. main(): report/gate.
 * @usage
 *   cd aimeat && pnpm check:ext-entrypoints            # report
 *   cd aimeat && pnpm check:ext-entrypoints --strict   # the hook/CI gate
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 4).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** The guards that belong on every path that runs extension code, and what each one stops. */
const REQUIRED: { symbol: string; why: string }[] = [
    { symbol: 'enforcePaywall', why: 'members-only access, entitlement settlement, pacing toll, morsel charge' },
    { symbol: 'enforceExtensionMemoryLimits', why: 'per-value size and per-key count quota (June H-5)' },
];

/** Files that reach the sandbox but legitimately need no guard, each with the reason. */
const EXEMPT: Record<string, string> = {
    'src/services/extension-runtime.ts': 'the engine itself, not a caller',
    'src/generated/api-types.ts': 'generated OpenAPI types; the name appears as a schema string, not a call',
};

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const offenders: { file: string; missing: string[] }[] = [];
    let callers = 0;

    for (const file of walk(SRC)) {
        const source = readFileSync(file, 'utf-8');
        if (!/\bexecuteExtensionAction\b/.test(source)) continue;
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (EXEMPT[rel]) continue;
        callers++;
        const missing = REQUIRED.filter(r => !new RegExp(`\\b${r.symbol}\\b`).test(source)).map(r => r.symbol);
        if (missing.length) offenders.push({ file: rel, missing });
    }

    console.log('');
    console.log('  Extension sandbox entry points — one road, one set of guards');
    console.log('  ' + '─'.repeat(62));
    console.log(`  callers into the sandbox  ${String(callers).padStart(4)}`);
    console.log(`  missing a guard           ${String(offenders.length).padStart(4)}`);
    console.log('');

    if (offenders.length) {
        for (const o of offenders) {
            console.log(`    ${o.file}`);
            for (const sym of o.missing) {
                const why = REQUIRED.find(r => r.symbol === sym)!.why;
                console.log(`      missing ${sym} — ${why}`);
            }
        }
        console.log('');
        console.log('  Running extension code without these means the installing owner pays for a call');
        console.log('  nobody was charged for, or an unbounded write. Import and call the guard, or move');
        console.log('  this path onto the shared context builder.');
        console.log('');
    }

    if (strict && offenders.length) {
        console.error(`✖ ${offenders.length} sandbox entry point(s) missing a guard.`);
        process.exit(1);
    }
    console.log(offenders.length ? '  (report only — pass --strict to gate)' : '  ✓ every sandbox entry point carries the guards');
}

main();
