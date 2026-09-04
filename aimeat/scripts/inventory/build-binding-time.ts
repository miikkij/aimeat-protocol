/**
 * @file scripts/inventory/build-binding-time.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question D of wish-invarianttiauditointi, as a report. Analysis only.
 *
 *   Covers both the server sources and the browser views, because one of the two defects was in
 *   each: the enrolment closure in `src/`, the bulk button in `public/views/`. A pass that looked at
 *   only one of them would have found one of the two and reported a clean half.
 * @structure main() — walk src and public, report both candidate classes
 * @usage cd aimeat && pnpm exec tsx scripts/inventory/build-binding-time.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question D).
 */
import ts from 'typescript';
import { writeFileSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tdzClosures, handlerArity } from './binding-time.js';
import { srcProgram } from './program.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const OUT_DIR = join(resolve(AIMEAT, '..'), 'secaudit');

/** Every .js under public/views and public/js — the browser half, which tsconfig does not include. */
function browserFiles(dir: string, acc: ts.SourceFile[] = []): ts.SourceFile[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { browserFiles(path, acc); continue; }
        if (!name.endsWith('.js')) continue;
        acc.push(ts.createSourceFile(path, readFileSync(path, 'utf-8'), ts.ScriptTarget.ESNext, true));
    }
    return acc;
}

function main(): void {
    const server = srcProgram().files;
    const browser = [...browserFiles(join(AIMEAT, 'public', 'views')), ...browserFiles(join(AIMEAT, 'public', 'js'))];
    const all = [...server, ...browser];

    const tdz = tdzClosures(all, AIMEAT);
    const handlers = handlerArity(browser, AIMEAT);

    const lines: string[] = [];
    const say = (s = ''): void => { lines.push(s); };

    say('# Sitoutumisaika');
    say();
    say('Wishin kohta D. Kaksi vikaa joiden koko syy on MILLOIN nimi sidotaan, ei mitä se pitää.');
    say('Kandidaatteja: kumpaakaan ei voi ratkaista staattisesti loppuun asti, ja arvaava työkalu');
    say('olisi väärässä molempiin suuntiin niin kuin 2026-08-16 kokeiltu oli.');
    say();

    const branched = tdz.filter(t => t.inBranch);
    say(`## Sulkeuma joka lukee myöhemmin esitellyn constin — ${tdz.length}`);
    say();
    say(`Näistä **${branched.length}** on haarassa (if / try / switch). Se on enrolment-tapauksen`);
    say('oma tuntomerkki: toinen polku poistuu returnilla ennen kuin esittely ehtii ajaa.');
    say();
    for (const t of tdz.sort((a, b) => Number(b.inBranch) - Number(a.inBranch)).slice(0, 40)) {
        say(`- ${t.inBranch ? '**haarassa** ' : ''}\`${t.name}\` — sulkeuma rivillä ${t.line}, esittely rivillä ${t.declaredLine} — ${t.file}`);
    }
    if (tdz.length > 40) say(`- … ja ${tdz.length - 40} muuta, kaikki JSONissa`);
    say();

    say(`## Käsittelijä annettu nimellä funktiolle jolla on parametreja — ${handlers.length}`);
    say();
    say('`onClick=${fn}` antaa funktion itsensä, joten tapahtuma menee ensimmäiseksi argumentiksi.');
    say('Vaaraton kun `fn()` ei ota yhtään — ja väärin siitä päivästä kun joku lisää sille yhden,');
    say('eri tiedostossa tehdyssä muutoksessa.');
    say();
    // A native DOM event is fired by the browser with an Event and nothing else, so passing a
    // function that wanted data is wrong there. A component prop is not: `onSave=${save}` where the
    // component calls `onSave(value)` is how a prop is meant to work, and the parameter is the
    // point. The two cannot be told apart by the prop's name — `onPress`, the one that actually
    // broke, is a component prop that happened to forward the click — so the split below is the
    // honest limit of what syntax answers, and the second list needs the component read.
    const DOM_EVENTS = new Set(['onClick', 'onDblClick', 'onSubmit', 'onInput', 'onFocus', 'onBlur',
        'onMouseDown', 'onMouseUp', 'onKeyDown', 'onKeyUp', 'onKeyPress']);
    // The tag decides, not the prop name: a browser event on a real element, or a component prop.
    const native = handlers.filter(h => h.tag === 'element' && DOM_EVENTS.has(h.prop));
    const props = handlers.filter(h => !(h.tag === 'element' && DOM_EVENTS.has(h.prop)));

    say(`### Selaimen oma tapahtuma — ${native.length}`);
    say();
    say('Selain kutsuu näitä tapahtumalla eikä millään muulla, joten dataa odottava funktio on');
    say('tässä väärin.');
    say();
    if (native.length === 0) say('Ei yhtään.');
    for (const h of native) say(`- \`${h.prop}=\${${h.fn}}\` — ${h.fn}(${h.firstParam}), ${h.arity} parametria — ${h.file}:${h.line}`);
    say();

    say(`### Komponentin oma propsi — ${props.length}`);
    say();
    say('Näissä parametri on todennäköisesti tarkoitus: komponentti kutsuu `onSave(arvo)`.');
    say('Ratkaisu vaatii komponentin lukemisen, eikä syntaksi vie tätä pidemmälle. `onPress`,');
    say('se joka oikeasti rikkoutui, oli juuri tässä luokassa — propsi joka sattui välittämään');
    say('klikkaustapahtuman. Siksi tätä listaa ei voi karsia nimen perusteella.');
    say();
    for (const h of props.slice(0, 25)) say(`- \`${h.prop}=\${${h.fn}}\` — ${h.fn}(${h.firstParam}) — ${h.file}:${h.line}`);
    if (props.length > 25) say(`- … ja ${props.length - 25} muuta, kaikki JSONissa`);
    say();

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'binding-time.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        note: 'Phase 1 question D. Candidates, not verdicts.',
        tdz, handlers,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(join(OUT_DIR, 'binding-time.md'), lines.join('\n') + '\n', 'utf-8');
    console.error(`✓ ${tdz.length} sulkeumaa (${branched.length} haarassa), ${handlers.length} käsittelijää → secaudit/binding-time.*`);
}

main();
