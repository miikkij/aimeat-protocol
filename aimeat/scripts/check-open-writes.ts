/**
 * @file scripts/check-open-writes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every door that WRITES and admits a caller carrying no credential is listed, with the
 *   sentence saying where its credential is actually checked.
 *
 *   WHAT THIS IS NOT. It is not a backlog. The triage that produced it
 *   (docs/internal/n2-triage-avoimet-kirjoitusovet.md, 2026-09-04) read all forty of these doors one
 *   at a time and found NO holes: every one is gated inside its handler by a nameable credential — an
 *   OAuth authorization code with its PKCE verifier, an RFC 8628 device_code, a one-time connectivity
 *   key, a pre-signed upload token, the admin password, an IP check that stops the moment a single
 *   owner exists. The scanner sees an empty middleware chain and cannot see any of that.
 *
 *   So the value is not in the forty. It is in the forty-first. A new door that writes and takes no
 *   credential is exactly the kind of thing that gets added in a hurry and read as normal afterwards,
 *   because it looks like the forty above it. This makes adding one a decision somebody wrote down.
 *
 *   FEDERATION IS DELIBERATELY NOT HERE. Its fifteen write doors belong to
 *   `check:federation-signatures`, which asks a sharper question about them: owner-gated, or the
 *   peer's Ed25519 signature verified in the handler. Two gates over one population means two lists
 *   that drift apart, and that is the defect both of them are built to count.
 * @structure
 *   - main(): the population from the shared door collector; --strict gates, --seed rewrites the list
 * @usage
 *   cd aimeat && pnpm check:open-writes            # report
 *   cd aimeat && pnpm check:open-writes --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:open-writes --seed     # rewrite the exemption file
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, on the neighbouring session's triage and in the shape it specified.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { srcProgram, AIMEAT } from './inventory/program.js';
import { collectDoors, toRows, openWriteDoors, type Row } from './inventory/doors.js';

const EXEMPTIONS = join(AIMEAT, 'security', 'open-write-exemptions.json');

interface ExemptionFile {
    note: string;
    /** `METHOD /path` → where the credential is checked. */
    exempt: Record<string, string>;
}

const SEED_REASON = 'SEEDED 2026-09-04, NOT TRIAGED — writes, and the middleware chain admits a caller '
    + 'with no credential. Where this one is actually checked has not been written down.';

const key = (r: Row): string => r.id;

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const { files } = srcProgram();
    const doors = openWriteDoors(toRows(collectDoors(files)))
        .sort((a, b) => a.id.localeCompare(b.id));

    if (seed) {
        const file: ExemptionFile = {
            note: 'Doors that write and admit a caller carrying no credential, outside /v1/federation/* '
                + '(which check:federation-signatures owns and asks a sharper question about). Seeded '
                + '2026-09-04. An entry is not debt: the triage in '
                + 'docs/internal/n2-triage-avoimet-kirjoitusovet.md read all of these and found no holes — '
                + 'each is gated inside its handler by a credential a scanner cannot see (an OAuth code '
                + 'plus PKCE verifier, a device_code, a one-time connectivity key, a pre-signed token, the '
                + 'admin password, an IP check that closes as soon as one owner exists). The gate exists '
                + 'for the door that has not been added yet.',
            exempt: Object.fromEntries(doors.map(d => [key(d), SEED_REASON])),
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${doors.length} doors → ${EXEMPTIONS}`);
        return;
    }

    const exempt = JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
    const listed = Object.keys(exempt.exempt);
    const fresh = doors.filter(d => exempt.exempt[key(d)] === undefined);
    const stale = listed.filter(k => !doors.some(d => key(d) === k));
    const triaged = listed.filter(k => !exempt.exempt[k].startsWith('SEEDED'));

    console.log('');
    console.log('  Writing doors that take no credential');
    console.log('  ' + '─'.repeat(62));
    console.log(`  doors             ${String(doors.length).padStart(3)}   outside /v1/federation/*`);
    console.log(`  no middleware     ${String(doors.filter(d => d.guards.length === 0).length).padStart(3)}   the chain is empty; the handler decides`);
    console.log(`  listed            ${String(listed.length).padStart(3)}   of which triaged: ${triaged.length}`);
    console.log(`  NEW, not listed   ${String(fresh.length).padStart(3)}`);
    console.log('');

    if (fresh.length > 0) {
        console.log('  NEW — writes, and takes no credential at the door:');
        for (const d of fresh) console.log(`    ${d.id}\n      ${d.file}:${d.line}${d.guards.length ? `  [${d.guards.map(g => g.name).join(' ')}]` : '  [no middleware]'}`);
        console.log('');
        console.error('✖ Any host on the internet can send this request. Every other door in this list is');
        console.error('  gated inside its handler by a credential the scanner cannot see — an OAuth code, a');
        console.error('  device_code, a pre-signed token, the admin password. If this one is too, add it to');
        console.error('  security/open-write-exemptions.json with the sentence saying where that check is.');
        console.error('  If it is not, it is a hole and the middleware chain is where it gets closed.');
        if (strict) process.exit(1);
        return;
    }

    if (stale.length > 0) {
        console.log(`  ✓ ${stale.length} listed door${stale.length === 1 ? '' : 's'} gone or now gated. Remove to lock the gain in:`);
        for (const k of stale) console.log(`    ${k}`);
        return;
    }

    console.log(`  ✓ no writing door takes a caller with no credential, beyond the ${listed.length} listed`);
}

main();
