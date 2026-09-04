/**
 * @file scripts/inventory/build-call-graph.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The call graph, and the first question it was built to answer: what a PUBLISH reaches.
 *
 *   Phase 1 of the wish ended with one question it could not answer. `field-reach` knows which
 *   surfaces MENTION a field and says so in its own header — a mention is not a write, and proving
 *   that a publish exposes a field needs the path from the door to the thing that writes it. This
 *   builds that path.
 *
 *   HOW TO READ THE NUMBERS. Reachability here is a LOWER BOUND. The graph resolves a call through
 *   the compiler's own symbol table, so every edge it draws is real; what it cannot draw is a call
 *   made through a variable, a callback invoked somewhere else, or a dynamic import. The unresolved
 *   count is printed at the top for that reason. "This door reaches that write" is evidence. "This
 *   door does not reach it" is the absence of evidence and nothing more.
 * @structure
 *   - roots(): the doors, from the same collectors the inventory uses
 *   - main(): graph, coverage, the publish surface, and storage reach per door → secaudit/call-graph.md
 * @usage
 *   cd aimeat && pnpm audit:call-graph
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import ts from 'typescript';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCallGraph, reachable, pathTo, type CallGraph, type FnId } from './call-graph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

function sourceFiles(): { program: ts.Program; files: ts.SourceFile[] } {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    program.getTypeChecker();
    const files = program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && f.fileName.includes('/src/')
        && !f.fileName.includes('/node_modules/'));
    return { program, files };
}

/** The storage methods that WRITE. Everything else on the interface reads. */
const WRITE_PREFIXES = ['set', 'create', 'add', 'put', 'update', 'delete', 'remove', 'insert', 'save', 'append', 'credit', 'debit', 'transfer'];
const isWrite = (name: string): boolean => WRITE_PREFIXES.some(p => name.startsWith(p));

/** What "publishing" means here, by the names the code itself uses. */
const PUBLISH = /publish|share|makePublic|visibility/i;

function main(): void {
    const { program, files } = sourceFiles();
    const graph = buildCallGraph(program, files, AIMEAT);

    const storageNodes = [...graph.nodes.values()].filter(n =>
        n.file.startsWith('src/storage/') && n.isInterfaceMethod);
    const storageIds = new Set(storageNodes.map(n => n.id));

    // A door is a handler; the graph keys on named functions, so the roots are the named functions in
    // the route, MCP and CLI files. An anonymous route handler is reached through the file's router
    // function, which IS named — so the unit here is the file's exported router rather than the door.
    const surfaceRoots = [...graph.nodes.values()].filter(n =>
        /^src\/(routes|mcp|cli)\//.test(n.file) && !n.isInterfaceMethod);

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Kutsugraafi');
    say();
    say('Mitattu, ei arvioitu. `pnpm audit:call-graph` kirjoittaa tämän uudelleen.');
    say();
    say('**Tavoitettavuus on alaraja.** Jokainen kaari on kääntäjän symbolitaulusta, joten se on tosi.');
    say('Mitä graafi ei näe: kutsu muuttujan läpi, toisaalla kutsuttu takaisinkutsu, ajonaikaisesti');
    say('valittu olio ja dynaaminen import. "Tämä ovi tavoittaa tuon kirjoituksen" on todiste;');
    say('"ei tavoita" on vain todisteen puute.');
    say();
    say('| | |');
    say('|---|---|');
    say(`| funktioita | ${graph.nodes.size} |`);
    say(`| kaaria | ${[...graph.edges.values()].reduce((n, s) => n + s.size, 0)} |`);
    say(`| ratkenneita kutsuja src/:n sisällä | ${[...graph.edges.values()].reduce((n, s) => n + s.size, 0)} |`);
    say(`| kutsuja src/:n ulkopuolelle | ${graph.external} |`);
    say(`| **ratkeamattomia kutsuja** | **${graph.unresolved}** |`);
    say(`| tallennusrajapinnan metodeja | ${storageNodes.length} |`);
    say();
    // Receivers that are the web framework, the logger or a fetch response: a call on one of them
    // never continues into this codebase, so it cannot hide a path and does not belong in the number
    // that says how blind the graph is.
    const PLUMBING = /^(router|logger|res|app|req|next|resp|response|r|console|process)\.<method>\(\)$/;
    const byShape = [...graph.unresolvedBy].sort((a, b) => b[1] - a[1]);
    const plumbing = byShape.filter(([s]) => PLUMBING.test(s)).reduce((n, [, c]) => n + c, 0);

    say('### Missä sokeus on');
    say();
    say('Yksi luku kertoo kuinka paljon puuttuu; tämä kertoo minkälaista. Osa ratkeamattomista ei ole');
    say('sokeutta lainkaan: `router.get()`, `logger.warn()` ja `res.json()` eivät jatka mihinkään');
    say('tämän koodikannan sisällä, joten ne eivät voi piilottaa polkua.');
    say();
    say(`- **${plumbing}** kutsua on kehystä, lokitusta tai vastausolioita — ei ketjua piilossa`);
    say(`- **${graph.unresolved - plumbing}** kutsua on aitoa sokeutta: laskettu vastaanottaja tai nimi jota symbolitaulu ei antanut`);
    say();
    say('| kutsun muoto | ratkeamatta | |');
    say('|---|---|---|');
    for (const [shape, n] of byShape.slice(0, 12)) {
        say(`| \`${shape}\` | ${n} | ${PLUMBING.test(shape) ? 'kehystä' : '**aitoa**'} |`);
    }
    say();

    // ── The publish surface ──────────────────────────────────────────────────
    const publishRoots = surfaceRoots.filter(n => PUBLISH.test(n.name) || PUBLISH.test(n.file));
    say('## Julkaisupinta');
    say();
    say(`Pintafunktioita joiden nimi tai tiedosto puhuu julkaisusta tai jakamisesta: **${publishRoots.length}**.`);
    say();

    const publishReach = reachable(graph, publishRoots.map(n => n.id));
    const publishWrites = [...publishReach].filter(id => storageIds.has(id) && isWrite(graph.nodes.get(id)!.name));
    say(`Niistä tavoitettavia tallennuskirjoituksia: **${publishWrites.length}**.`);
    say();
    if (publishWrites.length > 0) {
        say('| kirjoitus | lyhin polku |');
        say('|---|---|');
        for (const id of publishWrites.sort()) {
            const path = pathTo(graph, publishRoots.map(n => n.id), id);
            say(`| \`${graph.nodes.get(id)!.name}\` | ${path ? path.map(p => `\`${p.split('#')[1]}\``).join(' → ') : '—'} |`);
        }
        say();
    }

    // ── Storage reach per surface file ───────────────────────────────────────
    say('## Tallennuksen tavoitettavuus pintatiedostoittain');
    say();
    say('Montako tallennusrajapinnan metodia kunkin pintatiedoston funktioista pääsee käsiksi, kutsuketjun läpi.');
    say('Tämä on se luku jota `check:shared-impl` arvioi tuontien perusteella; tässä se on mitattu poluista.');
    say();
    const byFile = new Map<string, { reads: number; writes: number }>();
    for (const node of surfaceRoots) {
        const reach = reachable(graph, [node.id]);
        const hits = [...reach].filter(id => storageIds.has(id));
        const entry = byFile.get(node.file) ?? { reads: 0, writes: 0 };
        for (const id of hits) {
            if (isWrite(graph.nodes.get(id)!.name)) entry.writes += 1; else entry.reads += 1;
        }
        byFile.set(node.file, entry);
    }
    const ranked = [...byFile].filter(([, v]) => v.reads + v.writes > 0)
        .sort((a, b) => (b[1].reads + b[1].writes) - (a[1].reads + a[1].writes));
    say('| tiedosto | lukuja | kirjoituksia |');
    say('|---|---|---|');
    for (const [file, v] of ranked.slice(0, 30)) say(`| \`${file.replace(/^src\//, '')}\` | ${v.reads} | ${v.writes} |`);
    say();
    say(`(${ranked.length} pintatiedostoa tavoittaa tallennuksen; ylimmät 30 näytetään.)`);
    say();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'call-graph.md'), lines.join('\n'), 'utf-8');
    writeFileSync(join(OUT_DIR, 'call-graph.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        counts: { functions: graph.nodes.size, unresolved: graph.unresolved, external: graph.external },
        edges: Object.fromEntries([...graph.edges].map(([k, v]) => [k, [...v]])),
    }), 'utf-8');
    console.log(`✓ ${graph.nodes.size} funktiota, ${graph.unresolved} ratkeamatonta kutsua → secaudit/call-graph.md`);
}

main();

export { sourceFiles, isWrite, type CallGraph, type FnId };
