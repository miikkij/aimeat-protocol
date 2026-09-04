/**
 * @file scripts/inventory/build-field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question C of wish-invarianttiauditointi, as a report. Analysis only.
 * @structure main() — record fields, which surfaces name them, and the ones only REST does
 * @usage cd aimeat && pnpm exec tsx scripts/inventory/build-field-reach.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question C).
 */
import ts from 'typescript';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordFields, fieldReach } from './field-reach.js';
import { srcProgram } from './program.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

function main(): void {
    const files = srcProgram().files;
    const fields = recordFields(files);
    const reach = fieldReach(files, fields);

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Kenttien tavoitettavuus pinnoittain');
    say();
    say('Wishin kohta C, siinä muodossa joka löydöllä oikeasti oli. `run_mode` sai oven HTTP:hen');
    say('eikä yhtään jonka agentti tavoittaa, ja `mode` sen vieressä samalla tietueella oli');
    say('kolmella pinnalla. Kumpikaan ovi ei ollut väärin — väärin oli se, että kenttä sai yhden');
    say('eikä muita, eikä mikään mittari kysynyt.');
    say();
    say('MAININTOJA, EI KIRJOITUKSIA. Sen todistaminen että pinta KIRJOITTAA kentän vaatii');
    say('kutsugraafin, jota tämä vaihe ei vielä rakenna. Maininnat yliraportoivat — vastauksessa');
    say('nimetty kenttä lasketaan kuin pyynnössä nimetty — ja se on tässä turvallinen suunta.');
    say();
    say(`Tietuekenttiä tarkasteltu: **${fields.size}**`);
    say();

    const bySurfaceCount = new Map<number, number>();
    for (const r of reach) bySurfaceCount.set(r.surfaces.length, (bySurfaceCount.get(r.surfaces.length) ?? 0) + 1);
    say('| pintoja jotka mainitsevat | kenttiä |');
    say('|---|---|');
    for (const n of [...bySurfaceCount.keys()].sort()) say(`| ${n} | ${bySurfaceCount.get(n)} |`);
    say();

    const restOnly = reach.filter(r => r.surfaces.length === 1 && r.surfaces[0] === 'rest');
    say(`## Vain REST mainitsee — ${restOnly.length}`);
    say();
    say('Nämä voi asettaa selaimella ja ei millään joka toimii ihmisen puolesta. Se on');
    say('`run_mode`-löydön muoto. Jokainen on kandidaatti: osa on aidosti vain ihmisen');
    say('asetettavia, ja sen ratkaisee kentän merkitys eikä tämä taulukko.');
    say();
    for (const r of restOnly.sort((a, b) => a.field.localeCompare(b.field))) {
        say(`- \`${r.field}\` — ${r.records.join(', ')} — ${r.examples.rest}`);
    }
    say();

    const nowhere = reach.filter(r => r.surfaces.length === 0);
    say(`## Ei yhdelläkään pinnalla — ${nowhere.length}`);
    say();
    say('Tietue kantaa kentän, eikä yksikään ovi mainitse sitä. Joko solmun sisäinen, tai');
    say('jäänne. Sama kysymys kuin scope-sanalla jolla on nolla ovea.');
    say();
    for (const r of nowhere.sort((a, b) => a.field.localeCompare(b.field)).slice(0, 30)) {
        say(`- \`${r.field}\` — ${r.records.join(', ')}`);
    }
    if (nowhere.length > 30) say(`- … ja ${nowhere.length - 30} muuta, kaikki JSONissa`);
    say();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'field-reach.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        note: 'Phase 1 question C. Mentions, not writes. Candidates, not verdicts.',
        reach,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(OUT_DIR, 'field-reach.md'), lines.join('\n') + '\n', 'utf-8');
    console.error(`✓ ${fields.size} kenttää, ${restOnly.length} vain RESTissä, ${nowhere.length} ei missään → secaudit/field-reach.*`);
}

main();
