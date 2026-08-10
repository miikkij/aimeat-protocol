/**
 * @file scripts/check-trusted-keys.ts
 * @description The gate for Rule 10 invariant 2: a memory key the server reads and ACTS ON must be
 *   unreachable by a scoped app or agent. The reason is the whole H-2 grant model: an app-grant
 *   token resolves to the owner's GHII, so its writes land in the owner's namespace by design. That
 *   is fine for the owner's data and fatal for the server's own configuration.
 *
 *   Two accepted patterns (security-development-dna.md §2): store it under a synthetic system
 *   identity no owner-scoped principal can address, or put its prefix on the reserved-key denylist.
 *   The August 2026 audit found the denylist at three prefixes against sixty-nine trusted keys, and
 *   two of the unprotected ones were a cross-owner authorization list and a payout address with a
 *   Stripe secret beside it.
 *
 *   Ratchet, not a wall: seeded with today's reads, so the gate fails only on a NEW unprotected key.
 * @structure
 *   - collectReads(): every resolvable storage.getMemory / getPublicMemory key in the server code
 *   - main(): compare against security/trusted-key-exemptions.json; --strict gates; --seed rewrites
 * @usage
 *   cd aimeat && pnpm check:trusted-keys            # report
 *   cd aimeat && pnpm check:trusted-keys --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:trusted-keys --seed     # rewrite the exemption file
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 3).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RESERVED_OWNER_KEY_PREFIXES } from '../src/utils/reserved-keys.js';

const ROOT = process.cwd();
const AREAS = ['services', 'routes', 'commerce', 'mcp'].map(d => join(ROOT, 'src', d));
const EXEMPTIONS = join(ROOT, 'security', 'trusted-key-exemptions.json');

/** Identities no owner-scoped principal can address, so a key under one is already out of reach. */
const SYSTEM_IDENTITIES = ['__network_policy__', 'SITE_OWNER_GAII', '__genesis__', 'system@', '__system__'];

interface Finding { file: string; line: number; key: string; identity: string }
interface ExemptionFile { note: string; exempt: Record<string, string> }

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** True when the key sits under a prefix the reserved-key guard already refuses for app tokens. */
function isReserved(key: string): boolean {
    return RESERVED_OWNER_KEY_PREFIXES.some(p => key.startsWith(p));
}

export function collectReads(files: string[]): Finding[] {
    const findings: Finding[] = [];
    // getMemory(identity, 'literal.key') or getMemory(identity, `literal.${x}`) — only the resolvable
    // ones. A key built entirely from variables cannot be judged here and is not reported.
    const re = /\b(?:getMemory|getPublicMemory)\s*\(\s*([^,]+?)\s*,\s*(['"`])([A-Za-z0-9_.:-]+)/g;
    for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        let m: RegExpExecArray | null;
        while ((m = re.exec(source))) {
            const [, identity, , key] = m;
            if (isReserved(key)) continue;
            if (SYSTEM_IDENTITIES.some(s => identity.includes(s))) continue;
            const line = source.slice(0, m.index).split('\n').length;
            findings.push({ file: rel, line, key, identity: identity.trim().slice(0, 40) });
        }
    }
    return findings;
}

const softKey = (f: Finding) => `${f.file}:${f.key}`;

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const files = AREAS.flatMap(a => walk(a));
    const findings = collectReads(files);

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const f of findings) {
            exempt[softKey(f)] = 'Seeded 2026-08-10 from the August audit. Not yet reviewed: decide whether the '
                + 'server ACTS on this value (a URL it fetches, a credential, a policy, a budget, a listing flag) '
                + 'or merely echoes it back as user data. If it acts on it, reserve the prefix or move it under a '
                + 'system identity.';
        }
        writeFileSync(EXEMPTIONS, JSON.stringify({
            note: 'Memory keys the server reads that are neither reserved nor under a system identity. Seeded '
                + 'from the state on 2026-08-10 so the gate can only ratchet down. Most are ordinary user data '
                + 'the server hands back untouched; the dangerous ones are those it acts on.',
            exempt,
        } as ExemptionFile, null, 2) + '\n');
        console.log(`Seeded ${findings.length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const known = new Set(Object.keys(exempt));
    const fresh = findings.filter(f => !known.has(softKey(f)));
    const distinct = new Set(findings.map(f => f.key));

    console.log('');
    console.log('  Server-trusted memory keys — Rule 10 invariant 2');
    console.log('  ' + '─'.repeat(62));
    console.log(`  reads outside the guard   ${String(findings.length).padStart(4)}   (${distinct.size} distinct keys)`);
    console.log(`  reserved prefixes         ${String(RESERVED_OWNER_KEY_PREFIXES.length).padStart(4)}   ${RESERVED_OWNER_KEY_PREFIXES.join(' ')}`);
    console.log(`  NEW, not exempt           ${String(fresh.length).padStart(4)}`);
    console.log('');

    if (fresh.length) {
        console.log('  If the server ACTS on this value, an app the owner granted memory:write can poison it.');
        console.log('  Reserve the prefix (utils/reserved-keys.ts), move it under a system identity, or record');
        console.log('  in security/trusted-key-exemptions.json why it is user data rather than configuration.');
        console.log('');
        for (const f of fresh) console.log(`    ${f.file}:${f.line}  ${f.key}`);
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} new unguarded server-read key(s).`);
        process.exit(1);
    }
    console.log(fresh.length ? '  (report only — pass --strict to gate)' : '  ✓ no new unguarded server-read keys');
}

main();
