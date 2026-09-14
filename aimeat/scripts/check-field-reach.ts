/**
 * @file check-field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for a record field that a person can set through REST and that nothing acting
 *   on their behalf can: no node MCP tool, no connector tool, no CLI door takes it.
 *
 *   WHY IT EXISTS. The instrument was built on 2026-09-03 (scripts/inventory/field-reach.ts) for
 *   exactly this axis and put in no gate. On 2026-09-14 Kalle reported that aimeat_company_update
 *   does not declare `organism_id` while PUT /v1/companies/:id accepts it, so the MCP SDK stripped the
 *   key and the call returned ok having done nothing. The same class of defect had been fixed three
 *   times inside one MCP tool before. A printed report is read once by whoever ran it; this fails
 *   the build for the next person who gives a field a REST door and no other.
 *
 *   A RATCHET. security/field-reach-exemptions.json holds today's REST-only fields, each with a
 *   reason, so the gate fails on a NEW one and the backlog is countable. An entry is either an
 *   ANSWER (why this field is meant to be set by a person with a browser only) or the seeding's
 *   placeholder, `NOT YET REVIEWED`. Re-seeding forgives the whole backlog, so it is a decision.
 * @structure main(): measure, compare against the exemption file, report, gate under --strict
 * @usage
 *   cd aimeat && pnpm check:field-reach                          # the gate (check:fast, pnpm gate, CI)
 *   cd aimeat && pnpm exec tsx scripts/check-field-reach.ts          # report only, never fails
 *   cd aimeat && pnpm exec tsx scripts/check-field-reach.ts --seed   # rewrite the exemption file
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial (wish-kenttien-tavoitettavuus-portiksi).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { recordFields, fieldReach, type FieldReach } from './inventory/field-reach.js';
import { srcProgram, AIMEAT } from './inventory/program.js';

const EXEMPTIONS = join(AIMEAT, 'security', 'field-reach-exemptions.json');
const PLACEHOLDER = 'NOT YET REVIEWED';

interface ExemptionFile { note: string; exempt: Record<string, string> }

const keyOf = (r: FieldReach): string => `rest-only:${r.field}`;

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const files = srcProgram().files;
    const reach = fieldReach(files, recordFields(files));
    const restOnly = reach
        .filter(r => r.surfaces.length === 1 && r.surfaces[0] === 'rest')
        .sort((a, b) => a.field.localeCompare(b.field));

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const r of restOnly) {
            exempt[keyOf(r)] = `${PLACEHOLDER}. Seeded 2026-09-14. Declared on ${r.records.join(', ')}; `
                + `REST reaches it (${r.examples.rest}) and no MCP tool or CLI door does. Either give an `
                + `agent the same door, or replace this sentence with why only a person may set it.`;
        }
        writeFileSync(EXEMPTIONS, JSON.stringify({
            note: 'Record fields that REST reaches and no agent surface does (node MCP, connector MCP, '
                + 'CLI dispatch). Seeded so the gate fails only on a NEW one. An entry reading '
                + `"${PLACEHOLDER}" is a question nobody has answered, not a clearance; an answered `
                + 'entry says why a person with a browser is meant to be the only one who can set it.',
            exempt,
        } satisfies ExemptionFile, null, 2) + '\n');
        console.log(`Seeded ${restOnly.length} exemptions into ${relative(AIMEAT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const fresh = restOnly.filter(r => !exempt[keyOf(r)]);
    const current = new Set(restOnly.map(keyOf));
    const stale = Object.keys(exempt).filter(k => !current.has(k));
    const unreviewed = Object.values(exempt).filter(v => v.startsWith(PLACEHOLDER)).length;

    console.log('');
    console.log('  A field REST reaches, an agent reaches too');
    console.log('  ' + '─'.repeat(62));
    console.log(`  record fields measured                  ${String(reach.length).padStart(4)}`);
    console.log(`  reached by REST and no agent surface    ${String(restOnly.length).padStart(4)}`);
    console.log(`  of those, exempt                        ${String(restOnly.length - fresh.length).padStart(4)}   (${unreviewed} not yet reviewed)`);
    console.log(`  NEW, not exempt                         ${String(fresh.length).padStart(4)}`);
    if (stale.length) console.log(`  exemptions no longer REST-only          ${String(stale.length).padStart(4)}   (remove them from the file)`);
    console.log('');

    if (fresh.length) {
        for (const r of fresh) console.log(`    ${r.field.padEnd(28)} ${r.records.join(', ')} — ${r.examples.rest}`);
        console.log('');
        console.log('  A person can set these through REST and nothing acting on their behalf can: an');
        console.log('  agent that passes one gets ok and the field is dropped. Declare it on the MCP tool');
        console.log('  that writes the same record and forward it, or add an entry to');
        console.log(`  ${relative(AIMEAT, EXEMPTIONS)} saying why only a person may set it.`);
        console.log('');
    }
    if (stale.length) {
        console.log('  No longer REST-only, so these entries can go:');
        for (const k of stale) console.log(`    ${k}`);
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} record field(s) newly reachable through REST only.`);
        process.exit(1);
    }
    console.log(fresh.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ no record field is newly reachable through REST only');
}

main();
