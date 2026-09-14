/**
 * @file scripts/inventory/build-field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question C of wish-invarianttiauditointi, as a report. Analysis only; the gate over the
 *   same measurement is check:field-reach.
 * @structure main() — REST doors, their agent twins, and the fields a door takes that no twin does
 * @usage cd aimeat && pnpm exec tsx scripts/inventory/build-field-reach.ts
 * @version-history
 *   v2.0.0 — 2026-09-14 — Reports the door-by-door measurement (field-reach.ts v2) instead of mentions,
 *     and needs the CodeQL CLI for it.
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question C).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recordFields, doorReach, GENERIC_CALLERS, type AgentSurface } from './field-reach.js';
import { loadFacts } from './field-reach-facts.js';
import { captureServer, captureConnector, captureCliDispatch, type CapturedTool } from './mcp-capture.js';
import { srcProgram, AIMEAT } from './program.js';

const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

function main(): void {
    const got = loadFacts({ build: true });
    if (got.facts === null) {
        console.error(`✖ field reach needs the CodeQL CLI: ${got.reason}`);
        process.exit(1);
    }
    const keys = (m: Map<string, CapturedTool>): Map<string, string[]> => new Map([...m].map(([k, v]) => [k, v.inputKeys]));
    const declared: Record<AgentSurface, Map<string, string[]>> = {
        'mcp.node': keys(captureServer()), 'mcp.connector': keys(captureConnector()), 'cli.dispatch': keys(captureCliDispatch()),
    };
    const m = doorReach(recordFields(srcProgram().files), got.facts, declared);
    const restOnly = m.findings.filter(f => f.kind === 'rest-only');
    const noTwin = m.findings.filter(f => f.kind === 'no-twin');

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Kenttien tavoitettavuus ovittain');
    say();
    say('REST-ovi ja sen agenttikaksoset: työkalut, jotka tekevät saman työn. Ovi lukee kentän');
    say('pyynnöstä (CodeQL seuraa arvon), kaksonen julistaa kentän syötteekseen (MCP-kirjasto riisuu');
    say('julistamattoman avaimen). Kenttä, jonka ovi ottaa ja jota yksikään kaksonen ei ota, on');
    say('`organism_id`-löydön muoto. Menetelmä ja rajat: scripts/inventory/field-reach.ts.');
    say();
    say(`- Ovia, jotka lukevat tietuekenttiä: **${m.doors.length}**, joista kaksonen on ${m.doors.filter(d => d.twins.length).length}`);
    say(`- Kenttiä, jotka ovi ottaa eikä kaksonen: **${restOnly.length}**`);
    say(`- Ovia ilman kaksosta: **${noTwin.length}**`);
    say(`- Lukuja, joiden avainta CodeQL ei nimennyt: ${[...m.blind.unnamed.values()].flat().length}`);
    say(`- Lukuja, joiden reittiä ei tunneta: ${[...m.blind.unrouted.values()].flat().length}`);
    say();
    say(`## Kenttä ovessa, ei kaksosessa — ${restOnly.length}`);
    say();
    for (const f of restOnly) say(`- \`${f.field}\` — ${f.route} — ${f.at} — kaksoset: ${f.twins!.join(', ')}`);
    say();
    say(`## Ovi ilman agenttikaksosta — ${noTwin.length}`);
    say();
    for (const f of noTwin) say(`- ${f.route} — ${f.fields!.join(', ')}`);
    say();
    say(`## Syrjään jätetyt yleisfunktiot (yli ${GENERIC_CALLERS} node-työkalua kutsuu)`);
    say();
    for (const [callee, n] of m.generic) say(`- ${callee} — ${n}`);
    say();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'field-reach.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        note: 'Door by door: what a REST route reads (CodeQL) against what its agent twins declare.',
        doors: m.doors.map(d => ({ ...d, reads: Object.fromEntries(d.reads) })),
        findings: m.findings,
        blind: { unnamed: Object.fromEntries(m.blind.unnamed), unrouted: Object.fromEntries(m.blind.unrouted) },
        generic: m.generic,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(OUT_DIR, 'field-reach.md'), lines.join('\n') + '\n', 'utf-8');
    console.error(`✓ ${m.doors.length} ovea, ${restOnly.length} kenttää vain ovessa, ${noTwin.length} ovea ilman kaksosta → secaudit/field-reach.*`);
}

main();
