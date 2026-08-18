/**
 * @file scripts/check-ext-entrypoints.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every road into the extension sandbox gets its capability object from the same
 *   builder. `executeExtensionAction` is reached from four places, and until 2026-08-10 each one
 *   assembled that object by hand: roughly 200 lines apiece, never the same twice. The August 2026
 *   audit found one omission per copy — the scheduler with no memory quota and a bare fetch instead
 *   of safeFetch, MCP with no paywall and no per-call debit ceiling, and the email authorization
 *   rule written out three times.
 *
 *   What this checks NOW is the shape that fixed it: a file that runs extension code takes its
 *   context from `buildExtensionCtx` (services/extension-ctx.ts), which carries the memory quota,
 *   safeFetch and the email rule inside it, and calls `enforcePaywall` unless it is a road with
 *   nobody to charge. The companion rule is `aimeat/no-adhoc-extension-ctx`, which forbids building
 *   the context anywhere else; this script is the other half, catching a NEW entry point that skips
 *   the builder altogether by calling the engine directly.
 * @structure PAYWALL_EXEMPT: roads with no payer, each with the reason. main(): report/gate.
 * @usage
 *   cd aimeat && pnpm check:ext-entrypoints            # report
 *   cd aimeat && pnpm check:ext-entrypoints --strict   # the hook/CI gate
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 4).
 *   v1.1.0 — 2026-08-10 — Step 4 landed: the invariant is now "get the context from the builder"
 *                         rather than "import the guards here", since the guards moved inside it.
 *                         Gating from this version — every entry point complies.
 *   v1.2.0 — 2026-08-15 — The paywall exemption follows the road: the two unattended paths now share
 *                         services/extension-system-run.ts, and scheduler-extension-job.ts no longer
 *                         runs the engine at all. The reason now also names what stands in for the
 *                         paywall there (the owner fence), because "no payer" excuses a charge and
 *                         never a check.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** The builder every entry point must take its sandbox context from. */
const BUILDER = 'buildExtensionCtx';

/**
 * Roads that genuinely have nobody to charge, each with the reason — and with what stands in for the
 * paywall there, because "no payer" is a reason to skip a CHARGE, never a reason to skip a check.
 */
const PAYWALL_EXEMPT: Record<string, string> = {
    'src/services/extension-system-run.ts':
        'the two unattended roads (a schedule firing, a workflow step reaching its turn) have no caller '
        + 'and no payer, and the owner is not charged for their own clock. What replaces the paywall is '
        + 'the owner fence enforced in this file: an unattended run may only call an extension the '
        + 'requesting owner installed, so there is no cross-owner call for a price to be asked about. '
        + 'Formerly keyed to scheduler-extension-job.ts, which no longer runs the engine itself.',
};

/** Files that mention the engine but do not run it. */
const NOT_A_CALLER: Record<string, string> = {
    'src/services/extension-runtime.ts': 'the engine itself, not a caller',
    'src/generated/api-types.ts': 'generated OpenAPI types; the name appears as a schema string',
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

/** Drop comments before matching. Every file here documents the sandbox it touches, and a docblock
 *  showing `executeExtensionAction(script, ctx, …)` is prose, not an entry point. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, m => m.replace(/\/\/.*$/, ''));
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const offenders: { file: string; problems: string[] }[] = [];
    const exempted: string[] = [];
    let callers = 0;

    for (const file of walk(SRC)) {
        const source = stripComments(readFileSync(file, 'utf-8'));
        // An actual call, not a mention in a comment or a docblock.
        if (!/\bexecuteExtensionAction\s*\(/.test(source)) continue;
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (NOT_A_CALLER[rel]) continue;
        callers++;

        const problems: string[] = [];
        if (!new RegExp(`\\b${BUILDER}\\s*\\(`).test(source)) {
            problems.push(
                `builds its own sandbox context — call ${BUILDER}() from services/extension-ctx.js, which `
                + 'carries the memory quota, safeFetch and the email authorization rule');
        }
        if (!/\benforcePaywall\s*\(/.test(source)) {
            if (PAYWALL_EXEMPT[rel]) exempted.push(`${rel} — ${PAYWALL_EXEMPT[rel]}`);
            else problems.push(
                'runs extension code without enforcePaywall — a priced action is free through this door, '
                + 'and a cross-owner call skips the entitlement check with it');
        }
        if (problems.length) offenders.push({ file: rel, problems });
    }

    console.log('');
    console.log('  Extension sandbox entry points — one road, one set of guards');
    console.log('  ' + '─'.repeat(62));
    console.log(`  callers into the sandbox  ${String(callers).padStart(4)}`);
    console.log(`  paywall-exempt by design  ${String(exempted.length).padStart(4)}`);
    console.log(`  non-compliant             ${String(offenders.length).padStart(4)}`);
    console.log('');

    for (const e of exempted) console.log(`    (exempt) ${e}`);
    if (exempted.length) console.log('');

    if (offenders.length) {
        for (const o of offenders) {
            console.log(`    ${o.file}`);
            for (const p of o.problems) console.log(`      ${p}`);
        }
        console.log('');
        console.log('  A guard that lives at the call site is a guard the next call site will not have.');
        console.log('  That is how four copies of this context ended up missing four different things.');
        console.log('');
    }

    if (strict && offenders.length) {
        console.error(`✖ ${offenders.length} sandbox entry point(s) not on the shared builder.`);
        process.exit(1);
    }
    console.log(offenders.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ every sandbox entry point takes its context from the shared builder');
}

main();
