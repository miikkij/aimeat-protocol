/**
 * @file check-field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for a REST door that takes a record field its agent twins do not: a person
 *   with a browser can set the field, and nothing acting on their behalf can.
 *
 *   WHY IT EXISTS. The instrument was built on 2026-09-03 (scripts/inventory/field-reach.ts) for
 *   exactly this axis and put in no gate. On 2026-09-14 Kalle reported that aimeat_company_update
 *   does not declare `organism_id` while PUT /v1/companies/:id accepts it, so the MCP SDK stripped the
 *   key and the call returned ok having done nothing. The same class of defect had been fixed three
 *   times inside one MCP tool before. A printed report is read once by whoever ran it; this fails
 *   the build for the next person who gives a door a field its agent twin does not take.
 *
 *   WHAT IT READS. field-reach.ts says how a door, its twins and what each takes are measured, and
 *   what the measurement still does not claim.
 *
 *   THE RATCHET. security/field-reach-exemptions.json holds today's findings, each with a reason, so
 *   the gate fails on a NEW one and the backlog is countable:
 *   - `rest-only:<field> <METHOD> <path>`: the door reads the field and no twin declares it.
 *   - `no-twin:<METHOD> <path>`: the door reads record fields and no agent tool does its job at all.
 *   - `unnamed:<file>#<n>` and `unrouted:<file>#<n>`: reads the measurement cannot place (a key
 *     CodeQL cannot name; a request no route registration names). A file gaining one fails too,
 *     because a field read that way is a field this gate cannot see.
 *   An entry is either an ANSWER or the seeding's placeholder, `NOT YET REVIEWED`. Re-seeding
 *   forgives the whole backlog, so it is a decision.
 *
 *   WHEN CODEQL IS NOT HERE. CI measures in its own step before check:fast and fails this gate if it
 *   cannot. On a workstation without the CLI the gate says NOT MEASURED, in those words, and under
 *   --strict it refuses: `pnpm codeql:install` installs the pinned bundle once per machine (or
 *   registers one already on disk), and from then on every worktree measures locally (about 155 s
 *   cold on 2026-09-24, a file read after that until something under src/ changes).
 * @structure main(): measure, compare against the exemption file, report, gate under --strict
 * @usage
 *   cd aimeat && pnpm check:field-reach                              # the gate (check:fast, pnpm gate, CI)
 *   cd aimeat && pnpm field-reach:measure                            # build the CodeQL facts for this tree, nothing else
 *   cd aimeat && pnpm exec tsx scripts/check-field-reach.ts          # report only, never fails
 *   cd aimeat && pnpm exec tsx scripts/check-field-reach.ts --seed   # rewrite the exemption file
 * @version-history
 *   v2.1.0 — 2026-09-24 — NOT MEASURED refuses under --strict (pnpm gate, CI) instead of passing, and
 *     names `pnpm codeql:install`. The pass was what let a session push over a finding only CI could
 *     see: eight red CI periods from 2026-09-16 to 2026-09-23, all of them field-reach findings.
 *   v2.0.0 — 2026-09-14 — Door by door: what CodeQL says a route reads against what its twin tools
 *     declare, instead of mentions; the blind spots are ratcheted too.
 *   v1.0.0 — 2026-09-14 — Initial (wish-kenttien-tavoitettavuus-portiksi).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { recordFields, doorReach, type AgentSurface, type Finding } from './inventory/field-reach.js';
import { srcProgram, AIMEAT } from './inventory/program.js';
import { loadFacts } from './inventory/field-reach-facts.js';
import { captureServer, captureConnector, captureCliDispatch, type CapturedTool } from './inventory/mcp-capture.js';

const EXEMPTIONS = join(AIMEAT, 'security', 'field-reach-exemptions.json');
const PLACEHOLDER = 'NOT YET REVIEWED';

interface ExemptionFile { note: string; exempt: Record<string, string> }

function toKeys(tools: Map<string, CapturedTool>): Map<string, string[]> {
    return new Map([...tools].map(([name, t]) => [name, t.inputKeys]));
}

/** One exemption key per blind read, numbered within its file so the count is what is held. */
function blindKeys(kind: 'unnamed' | 'unrouted', byFile: Map<string, string[]>): [string, string][] {
    return [...byFile].flatMap(([file, reads]) => reads.map((where, i): [string, string] => [`${kind}:${file}#${i + 1}`, where]));
}

function describe(f: Finding): string {
    return f.kind === 'rest-only'
        ? `the door reads ${f.field} (${f.at}; declared on ${f.records!.join(', ')}) and none of its twins declares it: ${f.twins!.join(', ')}`
        : `the door reads record fields (${f.fields!.join(', ')}) and no agent tool does the same job`;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const measureOnly = process.argv.includes('--measure-only');

    const got = loadFacts({ build: true });
    if (got.facts === null) {
        if (process.env.CI) {
            console.error(`✖ field reach NOT MEASURED in CI: ${got.reason}. CI must measure this; see the field-reach step in ci.yml.`);
            process.exit(1);
        }
        console.log('');
        console.log(`  field reach NOT MEASURED on this machine: ${got.reason}.`);
        console.log('  pnpm codeql:install puts the CodeQL bundle CI uses where this check finds it (once per');
        console.log('  machine), and the next run measures in about two and a half minutes.');
        // A pass here is what CI turned red eight times from 2026-09-16 to 2026-09-23: the gate said
        // green over a finding it never looked for. As a gate it refuses; as a report it only says so.
        if (strict) process.exit(1);
        return;
    }
    const { facts } = got;
    if (facts.reads.length === 0 || facts.routes.length === 0 || facts.tools.length === 0) {
        console.error(`✖ CodeQL answered with ${facts.reads.length} reads, ${facts.routes.length} routes and ${facts.tools.length} tools (${relative(AIMEAT, got.dir)}). That is a broken measurement, not a clean tree.`);
        process.exit(1);
    }
    if (measureOnly) {
        console.log(`  ${got.built ? 'measured' : 'already measured'}: ${facts.reads.length} request reads, ${facts.routes.length} route handlers, ${facts.tools.length} tools → ${relative(AIMEAT, got.dir)}`);
        return;
    }

    const declared: Record<AgentSurface, Map<string, string[]>> = {
        'mcp.node': toKeys(captureServer()),
        'mcp.connector': toKeys(captureConnector()),
        'cli.dispatch': toKeys(captureCliDispatch()),
    };
    // A tool the runtime registers and CodeQL did not find cannot be anybody's twin, which reports
    // more rather than less; a tool CodeQL found that the runtime does not register is a stale
    // measurement. Both are said out loud.
    const found = new Set(facts.tools.map(t => `${t.surface}:${t.name}`));
    const unseen = (Object.keys(declared) as AgentSurface[])
        .flatMap(s => [...declared[s].keys()].map(t => `${s}:${t}`)).filter(t => !found.has(t));

    const m = doorReach(recordFields(srcProgram().files), facts, declared);
    const current: [string, string][] = [
        ...m.findings.map((f): [string, string] => [f.key, describe(f)]),
        ...blindKeys('unnamed', m.blind.unnamed).map(([k, w]): [string, string] => [k, `a read CodeQL could not name, so the field it reads is invisible to this gate: ${w}`]),
        ...blindKeys('unrouted', m.blind.unrouted).map(([k, w]): [string, string] => [k, `a read of a request no route registration names, so its door is unknown: ${w}`]),
    ];

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const [key, why] of current) {
            exempt[key] = `${PLACEHOLDER}. Seeded 2026-09-14: ${why}.`;
        }
        writeFileSync(EXEMPTIONS, JSON.stringify({
            note: 'REST doors against their agent twins, door by door (scripts/inventory/field-reach.ts). '
                + '`rest-only:<field> <route>`: the route reads the record field and no twin tool declares it. '
                + '`no-twin:<route>`: the route reads record fields and no agent tool does the same job. '
                + '`unnamed:` and `unrouted:` hold, per file, the reads the measurement cannot place. Seeded so '
                + `the gate fails only on a NEW entry. "${PLACEHOLDER}" is a question nobody has answered, `
                + 'not a clearance; an answered entry says why only a person with a browser is meant to reach it.',
            exempt,
        } satisfies ExemptionFile, null, 2) + '\n');
        console.log(`Seeded ${current.length} entries into ${relative(AIMEAT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const fresh = current.filter(([k]) => !exempt[k]);
    const currentKeys = new Set(current.map(([k]) => k));
    const stale = Object.keys(exempt).filter(k => !currentKeys.has(k));
    const count = (prefix: string): number => current.filter(([k]) => k.startsWith(prefix)).length;
    const unreviewed = Object.values(exempt).filter(v => v.startsWith(PLACEHOLDER)).length;

    console.log('');
    console.log('  A field a REST door takes, its agent twin takes too');
    console.log('  ' + '─'.repeat(62));
    console.log(`  REST doors taking record fields         ${String(m.doors.length).padStart(4)}   (${got.built ? 'measured now' : 'CodeQL facts cached for this tree'})`);
    console.log(`  of those, with an agent twin            ${String(m.doors.filter(d => d.twins.length).length).padStart(4)}`);
    console.log(`  fields a door takes and no twin does    ${String(count('rest-only:')).padStart(4)}`);
    console.log(`  doors with no agent twin                ${String(count('no-twin:')).padStart(4)}`);
    console.log(`  reads CodeQL could not name             ${String(count('unnamed:')).padStart(4)}`);
    console.log(`  reads on no known route                 ${String(count('unrouted:')).padStart(4)}`);
    console.log(`  exempt, not yet reviewed                ${String(unreviewed).padStart(4)}`);
    console.log(`  NEW, not exempt                         ${String(fresh.length).padStart(4)}`);
    if (stale.length) console.log(`  exemptions no longer true               ${String(stale.length).padStart(4)}   (remove them from the file)`);
    if (unseen.length) console.log(`  tools the runtime has, CodeQL did not   ${String(unseen.length).padStart(4)}   (they twin with nothing: ${unseen.slice(0, 5).join(', ')}${unseen.length > 5 ? ', …' : ''})`);
    console.log('');

    if (fresh.length) {
        for (const [key, why] of fresh) console.log(`    ${key}\n      ${why}`);
        console.log('');
        console.log('  A field a door takes and its agent twin does not is dropped in silence when an agent');
        console.log('  passes it: the call answers ok and the field is gone. Declare it on the twin and forward');
        console.log('  it; give a door without a twin its tool; or add an entry to');
        console.log(`  ${relative(AIMEAT, EXEMPTIONS)} saying why only a person may reach it.`);
        console.log('');
    }
    if (stale.length) {
        console.log('  No longer true, so these entries can go:');
        for (const k of stale.slice(0, 40)) console.log(`    ${k}`);
        if (stale.length > 40) console.log(`    … and ${stale.length - 40} more`);
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} new field-reach finding(s).`);
        process.exit(1);
    }
    console.log(fresh.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ no door newly takes a field its agent twin does not');
}

main();
