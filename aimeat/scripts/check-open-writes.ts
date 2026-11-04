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
 *   A CREDENTIAL THE HANDLER VERIFIES IS DECLARED INSTEAD (2026-11-04). A door that takes a participant,
 *   a party or a platform credential names it in its chain with acceptCredential('<kind>', …), the auth
 *   layer verifies it, and the door leaves this list. The list only shrinks: a stale entry fails, and
 *   `ceiling` must equal the number listed, so a new door with no credential raises it visibly.
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
 *   v1.1.0 — 2026-11-04 — A ratchet: a listed door that is gone or now declares a credential strategy
 *     (acceptCredential, src/auth/credential-strategies.ts) fails until it is removed, and the list has
 *     a ceiling that only falls; the report counts the writing doors that declare a strategy
 *     (codebase analysis 2026-11-03, item B8).
 *   v1.0.0 — 2026-09-04 — Initial, on the neighbouring session's triage and in the shape it specified.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { srcProgram, AIMEAT } from './inventory/program.js';
import { collectDoors, toRows, openWriteDoors, type Row } from './inventory/doors.js';

const EXEMPTIONS = join(AIMEAT, 'security', 'open-write-exemptions.json');

interface ExemptionFile {
    note: string;
    /**
     * The most entries `exempt` may hold. It only falls: a door that declares a credential strategy
     * leaves the list and the ceiling is lowered in the same change. Raising it is the visible decision
     * a door with no credential at all needs (codebase analysis 2026-11-03, item B8).
     */
    ceiling?: number;
    /** `METHOD /path` → where the credential is checked. */
    exempt: Record<string, string>;
}

const SEED_REASON = 'SEEDED 2026-09-04, NOT TRIAGED — writes, and the middleware chain admits a caller '
    + 'with no credential. Where this one is actually checked has not been written down.';

const key = (r: Row): string => r.id;

export function main(): boolean {
    const seed = process.argv.includes('--seed');

    const { files } = srcProgram();
    const rows = toRows(collectDoors(files));
    const doors = openWriteDoors(rows)
        .sort((a, b) => a.id.localeCompare(b.id));
    // Writing doors whose credential the auth layer verifies (src/auth/credential-strategies.ts).
    const declared = rows.filter(r => r.kind === 'rest' && !r.id.startsWith('GET ') && r.guards.some(g => g.name === 'acceptCredential'));

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
            ceiling: doors.length,
            exempt: Object.fromEntries(doors.map(d => [key(d), SEED_REASON])),
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${doors.length} doors → ${EXEMPTIONS}`);
        return true;
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
    console.log(`  listed            ${String(listed.length).padStart(3)}   of which triaged: ${triaged.length}; ceiling ${exempt.ceiling ?? '(none)'}`);
    console.log(`  NEW, not listed   ${String(fresh.length).padStart(3)}`);
    console.log(`  strategy          ${String(declared.length).padStart(3)}   writing doors that declare acceptCredential() (src/auth/credential-strategies.ts)`);
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
        console.error('  A credential the handler verifies (a participant, a party, a platform) is declared');
        console.error('  in the chain instead: acceptCredential(\'<kind>\', …) in src/auth/credential-strategies.ts.');
        return false;
    }

    if (stale.length > 0) {
        console.error(`  ✖ ${stale.length} listed door${stale.length === 1 ? '' : 's'} gone or now gated. Remove ${stale.length === 1 ? 'it' : 'them'} from`);
        console.error('    security/open-write-exemptions.json and lower its ceiling in the same change, so the list');
        console.error('    only shrinks:');
        for (const k of stale) console.error(`    ${k}`);
        return false;
    }

    const ceiling = exempt.ceiling ?? listed.length;
    if (listed.length !== ceiling) {
        console.error(listed.length > ceiling
            ? `  ✖ ${listed.length} doors are listed and the ceiling is ${ceiling}. A new door that takes no credential is a`
              + '\n    decision: declare its credential with acceptCredential() if it has one, or raise the ceiling in'
              + '\n    security/open-write-exemptions.json in the same change, with the sentence that says why it is safe.'
            : `  ✖ ${listed.length} doors are listed and the ceiling is ${ceiling}. Lower the ceiling to ${listed.length} in`
              + '\n    security/open-write-exemptions.json, so the count only falls.');
        return false;
    }

    console.log(`  ✓ no writing door takes a caller with no credential, beyond the ${listed.length} listed`);
    return true;
}

// Runs only when invoked as the script: check-invariants imports main() and runs the five
// program-reading gates in one process against one compiler program.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && !main() && process.argv.includes('--strict')) process.exit(1);
