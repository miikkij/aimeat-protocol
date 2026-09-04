/**
 * @file scripts/inventory/build-inventory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Phase 1 of wish-invarianttiauditointi: the inventory of doors, generated.
 *
 *   THE QUESTION THIS ANSWERS. The August 2026 audit asked "is this check correct" and found six
 *   invariants by reading. The six findings of 2026-09-03 are a different shape: every one is a
 *   correct check MISSING FROM ONE PLACE OF N. That question — who else has to make this check, and
 *   do they — cannot be answered by reading. It is answered by enumerating, and this enumerates.
 *
 *   WHAT IT IS NOT. Not a gate, not a lint rule, not a fix. It produces two artefacts and no
 *   verdicts: `secaudit/inventory.json` for the next pass to read, and a table for a person. What
 *   gets built after this is decided from the numbers, not before them.
 *
 *   WHAT ONE ROW MEANS. A door, the classes of caller that reach it, and the permission words it
 *   demands. Three of the six findings are visible in that alone: a scope word no row demands does
 *   not exist (`allowRouting`, `memory:delete`), and a field with a row on one surface and none on
 *   the others is unreachable to everything but that surface (`run_mode`).
 *
 *   The sink and barrier columns — which storage calls a door reaches and what it crosses on the way
 *   — are the second pass. They need a call graph; this pass needs only the registrations, and it is
 *   worth having on its own before anything harder is attempted.
 * @structure main() — build the program, walk every source, compute principals, write both artefacts
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/inventory/build-inventory.ts
 *   cd aimeat && pnpm exec tsx scripts/inventory/build-inventory.ts --json-only
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, analysis only).
 */
import ts from 'typescript';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRestRoutes, collectMcpTools, collectCliDispatch, guardArraysIn, type EntryPoint } from './entries.js';
import { principalsFor, isPublic, type Principal } from './principals.js';
import { scopeMentions } from './scope-mentions.js';
import { readVocabulary } from './scope-vocabulary.js';
import { TOOL_SCOPES } from '../../src/mcp/catalog/scopes.js';

// readVocabulary moved to ./scope-vocabulary.ts by pure extraction on 2026-09-04: check:scope-parity
// needs the identical answer, and a second copy would drift the day one of them learned a new shape.

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const REPO = resolve(AIMEAT, '..');
const OUT_DIR = join(REPO, 'secaudit');

interface Row extends EntryPoint {
    principals: Principal[];
    unknownGuards: string[];
    scopes: string[];
    public: boolean;
}

/** The compiler's own file list, so nothing is missed and nothing generated is counted. */
function sourceFiles(): ts.SourceFile[] {
    const configPath = join(AIMEAT, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Forces the binder to run, which is what sets `node.parent`. Without it every parent is
    // undefined and any walk that asks "what encloses this literal" silently answers nothing —
    // which is exactly how the constant-following pass reported two enforced scopes as orphans.
    program.getTypeChecker();
    return program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && f.fileName.includes('/src/')
        && !f.fileName.includes('/node_modules/'));
}

function collect(files: ts.SourceFile[]): EntryPoint[] {
    const out: EntryPoint[] = [];

    // Guard arrays first, from every file, because a chain declared in one module is spread in
    // another. Per-file resolution reports those rows as ungated, and wrong-in-the-permissive-
    // direction is the one kind of wrong an inventory must not be.
    const arrays = new Map<string, ReturnType<typeof guardArraysIn> extends Map<string, infer V> ? V : never>();
    for (const source of files) for (const [name, guards] of guardArraysIn(source)) arrays.set(name, guards);

    for (const source of files) {
        const path = source.fileName;
        if (path.includes('/src/routes/')) out.push(...collectRestRoutes(source, AIMEAT, arrays));
        if (path.includes('/src/mcp/')) out.push(...collectMcpTools(source, AIMEAT, 'mcp.node'));
        if (path.includes('/src/cli/connect/mcp/')) out.push(...collectMcpTools(source, AIMEAT, 'mcp.connector'));
        if (/tool-call-defs-.*\.ts$/.test(path)) out.push(...collectCliDispatch(source, AIMEAT));
    }
    return out;
}

function toRows(entries: EntryPoint[]): Row[] {
    return entries.map(e => {
        const { principals, unknown, scopes } = principalsFor(e.guards);
        // Only a REST door has a middleware chain; the other kinds are gated elsewhere, so their
        // principal set is left empty rather than reported as "everyone".
        const applies = e.kind === 'rest';
        return {
            ...e,
            principals: applies ? principals : [],
            unknownGuards: applies ? unknown : [],
            scopes: applies ? scopes : [],
            public: applies ? isPublic(principals) : false,
        };
    });
}

function tally<T extends string>(values: T[]): Array<[T, number]> {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function report(rows: Row[], mentions: Map<string, Array<{ file: string; line: number }>>, VOCABULARY: ReadonlySet<string>): string {
    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Ovien inventaario');
    say();
    say('Vaihe 1, wish-invarianttiauditointi. Luetteloitu, ei arvioitu. Ei korjauksia.');
    say();

    say('## Sisäänkäynnit lajeittain');
    say();
    say('| laji | ovia |');
    say('|---|---|');
    for (const [kind, n] of tally(rows.map(r => r.kind))) say(`| ${kind} | ${n} |`);
    say(`| **yhteensä** | **${rows.length}** |`);
    say();

    const rest = rows.filter(r => r.kind === 'rest');
    say('## Kuka pääsee REST-oville');
    say();
    say('Lähtöjoukko on KAIKKI, koska `optionalAuth()` on koko sovelluksen päällä (server.ts:152).');
    say('Portiton reitti ei siis ole vain tunnistautumaton: anonyymitilassa se saa `req.auth`in');
    say('joka kantaa solmun anonyymin omistajan nimen. Se on invariantti 6.');
    say();
    say('| kutsujaluokka | montako REST-ovea päästää |');
    say('|---|---|');
    for (const [p, n] of tally(rest.flatMap(r => r.principals))) say(`| ${p} | ${n} |`);
    say();

    const publicWrites = rest.filter(r => r.public && !r.id.startsWith('GET '));
    say(`## Kirjoittavat ovet ilman tunnistautumista — ${publicWrites.length}`);
    say();
    say('Jokainen näistä on joko protokollan vaatima (token-pääte, IdP:n paluu, majakka) tai kysymys.');
    say();
    for (const r of publicWrites.sort((a, b) => a.id.localeCompare(b.id))) {
        say(`- \`${r.id}\` — ${r.file}:${r.line}${r.guards.length ? ` [${r.guards.map(g => g.name).join(' ')}]` : ' [ei porttia]'}`);
    }
    say();

    const unknown = rest.filter(r => r.unknownGuards.length > 0);
    say(`## Portit joita tämä taulukko ei tunne — ${unknown.length} riviä`);
    say();
    say('Tuntematon portti EI ole vaaraton. Se tekee rivin kutsujajoukosta kysymyksen.');
    say();
    for (const [name, n] of tally(unknown.flatMap(r => r.unknownGuards))) say(`- \`${name}\` — ${n} rivillä`);
    say();

    say('## Scope-sanat: mitkä ovet niitä kysyvät');
    say();
    say('Wishin kohta A. Sanasto on se jonka omistaja NÄKEE ja voi myöntää');
    say('(public/views/profile/agents/scope-model.js), kysyjät ovat REST-portit ja MCP:n');
    say('työkalutaulukko (mcp/catalog/scopes.ts). Nolla kysyjää = sanaa ei ole olemassa:');
    say('myöntäminen ei tee mitään ja epääminen ei suojaa mitään.');
    say();
    say('| scope | REST-ovia | MCP-työkaluja |');
    say('|---|---|---|');
    const restCount = new Map(tally(rest.flatMap(r => r.scopes)));
    const mcpCount = new Map(tally(Object.values(TOOL_SCOPES)));
    for (const word of [...VOCABULARY].sort()) {
        say(`| ${word} | ${restCount.get(word) ?? 0} | ${mcpCount.get(word) ?? 0} |`);
    }
    say();

    say('## Missä sana vielä tarkistetaan portin ULKOPUOLELLA');
    say();
    say('Sana pakotetaan kolmella tavalla: reitin `requireScope`, MCP:n työkalutaulukko, tai');
    say('kirjaimellisesti jonkin toisen portin tai käsittelijän sisällä. Kolmas on se joka teki');
    say('ensimmäisestä ajosta väärän: `account:security` tarkistetaan `requireOwnerPrincipal`in');
    say('sisällä ja `memory:write-as-owner` käsittelijässä, eivätkä kumpikaan ole requireScope.');
    say();
    say('| scope | REST | MCP | muualla lähteessä |');
    say('|---|---|---|---|');
    for (const word of [...VOCABULARY].sort()) {
        const elsewhere = mentions.get(word)?.length ?? 0;
        if ((restCount.get(word) ?? 0) === 0 && (mcpCount.get(word) ?? 0) === 0) {
            say(`| ${word} | 0 | 0 | ${elsewhere} |`);
        }
    }
    say();

    const orphans = [...VOCABULARY]
        .filter(w => !restCount.has(w) && !mcpCount.has(w) && (mentions.get(w)?.length ?? 0) === 0)
        .sort();
    say(`## Sanat joilla on NOLLA kysyjää missään — ${orphans.length}`);
    say();
    if (orphans.length === 0) {
        say('Ei yhtään.');
    } else {
        say('Omistaja voi myöntää nämä. Mikään lähteessä ei kysy niitä millään kolmesta tavasta.');
        say('Myöntäminen ei tee mitään, epääminen ei suojaa mitään. Jokainen on tarkistettava');
        say('käsin ennen kuin sitä kutsutaan viaksi — tämä on kandidaatti, ei tuomio.');
        say();
        for (const w of orphans) say(`- \`${w}\``);
    }
    say();

    const undeclared = [...new Set([...restCount.keys(), ...mcpCount.keys()])]
        .filter(w => !VOCABULARY.has(w) && w.includes(':')).sort();
    say(`## Sanat joita ovi vaatii mutta joita omistaja ei näe — ${undeclared.length}`);
    say();
    if (undeclared.length === 0) {
        say('Ei yhtään.');
    } else {
        say('Ovi vaatii näitä, mutta ne eivät ole siinä listassa josta omistaja valitsee.');
        say('Toinen puoli samasta kysymyksestä: sana on olemassa vain toisella puolella.');
        say();
        for (const w of undeclared) say(`- \`${w}\` — REST ${restCount.get(w) ?? 0}, MCP ${mcpCount.get(w) ?? 0}`);
    }
    say();

    return lines.join('\n') + '\n';
}

function main(): void {
    const VOCABULARY = readVocabulary(AIMEAT);
    const files = sourceFiles();
    const rows = toRows(collect(files));
    // The two files that DEFINE the vocabulary rather than demand it. Counting a definition as a
    // demand would make every word look asked-for, which is the opposite of what this measures.
    const mentions = scopeMentions(files, VOCABULARY, AIMEAT, ['mcp/catalog/scopes.ts', 'utils/scope-coverage.ts']);
    mkdirSync(OUT_DIR, { recursive: true });

    writeFileSync(join(OUT_DIR, 'inventory.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        note: 'Phase 1 of wish-invarianttiauditointi. Entry points and who reaches them. No verdicts.',
        rows,
    }, null, 2) + '\n', 'utf-8');

    const md = report(rows, mentions, VOCABULARY);
    writeFileSync(join(OUT_DIR, 'inventory.md'), md, 'utf-8');

    if (!process.argv.includes('--json-only')) process.stdout.write(md);
    console.error(`\n✓ ${rows.length} ovea → secaudit/inventory.json + inventory.md`);
}

main();
