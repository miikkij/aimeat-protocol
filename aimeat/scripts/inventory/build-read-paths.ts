/**
 * @file scripts/inventory/build-read-paths.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question B of wish-invarianttiauditointi, as a report: every read path to a table
 *   that has a "this row is gone" column, and whether that path mentions it.
 *
 *   Analysis only. No gate, no fixes. It produces candidates and says so — a mention is not a proof
 *   of correctness and a missing mention is not a proof of a leak, but a table with fifteen paths
 *   that mention `deletedAt` and one that does not is a question worth a minute of somebody's time,
 *   and that shape is exactly what went unasked until a deleted record turned up in a text search.
 * @structure main() — read paths, group by table, print the ones that disagree with their siblings
 * @usage cd aimeat && pnpm exec tsx scripts/inventory/build-read-paths.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question B).
 */
import ts from 'typescript';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPaths, stateColumnsPerTable, type ReadPath } from './read-paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

function sourceFiles(): ts.SourceFile[] {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    program.getTypeChecker(); // sets node.parent — see build-inventory.ts
    return program.getSourceFiles().filter(f => !f.isDeclarationFile && f.fileName.includes('/src/'));
}

function main(): void {
    const files = sourceFiles();
    const paths = readPaths(files, AIMEAT);
    const declared = stateColumnsPerTable(files);

    const byTable = new Map<string, ReadPath[]>();
    for (const p of paths) byTable.set(p.target, [...(byTable.get(p.target) ?? []), p]);

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Lukupolut ja poistetut rivit');
    say();
    say('Wishin kohta B. Luetteloitu, ei tuomittu: maininta ei todista tarkistusta oikeaksi eikä');
    say('puuttuva maininta todista vuotoa. Kandidaatteja, jotka ihminen lukee.');
    say();
    say(`Lukupolkuja yhteensä **${paths.length}**, kohteita **${byTable.size}**,`);
    say(`tauluja joilla on tilasarake skeemassa **${declared.size}**.`);
    say();

    // The shape the leak had: siblings agree, one does not.
    say('## Taulut joiden polut ovat eri mieltä');
    say();
    say('Osa poluista mainitsee tilasarakkeen, osa ei. Se ei ole vika sinänsä — mutta se on');
    say('se muoto jossa yksi polku jää jaetun suodattimen ulkopuolelle.');
    say();
    say('Verrattavana ovat vain saman taulun **avaimella hakevat** luvut. Tilalla hakeva luku');
    say('suodattaa koska tila ON sen kysymys, eikä se ole eri mieltä avainhaun kanssa vaan vastaa');
    say('toiseen asiaan. Yhdellätoista taululla luettuna se sääntö piti joka kerta; `memory` oli');
    say('ainoa joka rikkoi sen, ja siksi se oli ainoa oikea löytö.');
    say();
    let disagreeing = 0;
    for (const [table, all] of [...byTable.entries()].sort()) {
        const cols = declared.get(table);
        const list = all.filter(p => p.selector === 'identity');
        if (!cols || list.length < 2) continue;
        const withMention = list.filter(p => p.mentions.length > 0);
        const without = list.filter(p => p.mentions.length === 0);
        if (withMention.length === 0 || without.length === 0) continue;
        disagreeing++;
        say(`### \`${table}\` — ${withMention.length} mainitsee, ${without.length} ei`);
        say();
        say(`Skeeman tilasarakkeet: ${[...cols].join(', ')}`);
        say();
        for (const p of without) {
            say(`- **ei mainintaa** — \`${p.fn}\` ${p.file}:${p.line}${p.alternateTarget ? '  ⟵ ERI KOHDE' : ''}`);
        }
        say();
    }
    if (disagreeing === 0) say('Ei yhtään.');
    say();

    // The class the FTS leak belongs to, listed on its own whatever the mentions say.
    const alternates = paths.filter(p => p.alternateTarget);
    say(`## Polut jotka reitittävät ERI KOHTEESEEN — ${alternates.length}`);
    say();
    say('Nämä eivät kulje sen suodattimen läpi jonka sisartensa kanssa jakavat, koska ne eivät');
    say('kysele samaa kohdetta. FTS-vuoto oli tässä luokassa. Jokainen on katsottava erikseen');
    say('riippumatta siitä mainitseeko se tilasaraketta.');
    say();
    for (const p of alternates.sort((a, b) => a.target.localeCompare(b.target))) {
        say(`- \`${p.target}\` — \`${p.fn}\` ${p.file}:${p.line} — maininnat: ${p.mentions.join(', ') || 'ei yhtään'}`);
    }
    say();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'read-paths.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        note: 'Phase 1 question B. Read paths and state-column mentions. Candidates, not verdicts.',
        paths,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(OUT_DIR, 'read-paths.md'), lines.join('\n') + '\n', 'utf-8');
    console.error(`✓ ${paths.length} lukupolkua → secaudit/read-paths.json + read-paths.md`);
}

main();
