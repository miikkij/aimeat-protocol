/**
 * pnpm audit:report — run the whole semantic security audit and write a human-readable report,
 * machine-generated, into secaudit/ (gitignored). No one has to translate the tool output by hand.
 *
 * Writes:
 *   secaudit/RAPORTTI.md   plain-language Finnish report — the document to read
 *   secaudit/findings.json the raw ast-grep findings (the detail behind the report)
 *   secaudit/gates.json    the audit-gate pass/fail states
 *
 * Run from the aimeat/ package (so the pnpm checks resolve):
 *   node ../security/semantic-audit/generate-report.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'secaudit');
const AIMEAT = resolve(ROOT, 'aimeat');
mkdirSync(OUT, { recursive: true });

// Plain-language meaning of each guard. The tech name is kept for developers, never led with.
const GUARDS = {
  'raw-sub-into-storage-arg-no-resolve': {
    protects: 'Kukaan ei näe toisen asiakkaan dataa',
    tech: 'resolve-identity',
    glance: 'Vahti osuu herkästi koneen omiin käyttötapoihin. Kohdat kannattaa vilkaista vain jos niitä muutetaan.',
  },
  'role-or-scope-agent-bypasses-scope': {
    protects: 'Jokainen toiminto vaatii oikean luvan',
    tech: 'permission-word',
    glance: 'Tarkista että merkityt ovet vaativat varmasti oikean luvan.',
  },
  'owner-name-cross-owner-widening': {
    protects: 'Vain tilin omistaja voi muuttaa omaa tiliään',
    tech: 'owner-name',
    glance: 'Tarkista että tilin muutos-, vienti- ja poisto-ovet käyttävät tiukinta omistaja-tarkistusta.',
  },
  'optional-auth-if-not-req-auth-gate': {
    protects: 'Kirjautuminen vaaditaan oikeasti',
    tech: 'optional-auth',
    glance: 'Tarkista että merkityt näkymät torjuvat varmasti kirjautumattoman kävijän.',
  },
};

// The automatic checks, in plain language.
const CHECKS = [
  ['check:route-scopes', 'Jokainen muutos vaatii luvan'],
  ['check:denial-coverage', 'Luvaton pääsy testataan ja estetään'],
  ['check:outbound-fetch', 'Ulkoiset yhteydet tarkistetaan (ei tietovuotoa)'],
  ['check:trusted-keys', 'Salaisuuksiin ei pääse käsiksi väärin'],
  ['check:storage-parity', 'Data tallentuu samoin joka tietokannalla'],
  ['check:ext-entrypoints', 'Laajennukset eivät saa piiloreittejä'],
  ['check:shared-impl', 'Jokainen toiminto tehdään yhdessä paikassa'],
  ['check:sse-parity', 'Reaaliaikanäkymä vastaa oikeaa dataa'],
  ['check:copied-logic', 'Turvapäätöstä ei kirjoiteta kahdesti'],
  ['check:liaison-surface', 'Python-paketti vastaa palvelinta'],
  ['check:mcp-tools', 'AI-työkalut samat joka rajapinnassa'],
  ['check:mcp-schemas', 'AI-työkalujen parametrit samat joka rajapinnassa'],
];

const norm = s => (s || '').replace(/\\/g, '/');
const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }

// 1. Run the ast-grep guards.
process.stderr.write('Ajetaan vahdit (ast-grep)…\n');
const astRaw = execSync(
  'npx -y -p @ast-grep/cli@0.45.1 ast-grep scan -c security/semantic-audit/sgconfig.yml aimeat/src --json=compact',
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
);
const astFindings = JSON.parse(astRaw || '[]');
writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify(astFindings, null, 2));

const byGuard = {};
for (const f of astFindings) {
  const g = f.ruleId;
  (byGuard[g] ??= []).push({
    file: norm(f.file),
    line: f.range?.start?.line != null ? f.range.start.line + 1 : null,
    level: f.severity || 'warning',
  });
}
const errorLevel = astFindings.filter(f => (f.severity || 'warning') === 'error').length;
const reviewLevel = astFindings.length - errorLevel;

// 2. Run the automatic checks.
process.stderr.write('Ajetaan turvatarkistukset…\n');
const gateResults = [];
for (const [script, plain] of CHECKS) {
  let ok = true;
  try { execSync(`pnpm ${script}`, { cwd: AIMEAT, stdio: 'pipe' }); } catch { ok = false; }
  gateResults.push({ script, plain, ok });
  process.stderr.write(`  ${ok ? '✓' : '✗'} ${script}\n`);
}
writeFileSync(resolve(OUT, 'gates.json'), JSON.stringify(gateResults, null, 2));
const gatesFailed = gateResults.filter(g => !g.ok);

// 3. The verdict, machine-derived.
let verdict, headline;
if (gatesFailed.length > 0) {
  verdict = 'HUOMIO';
  headline = `${gatesFailed.length} turvatarkistus regressoitui — tämä estää muutokset kunnes korjattu.`;
} else if (errorLevel > 0) {
  verdict = 'HUOMIO';
  headline = `${errorLevel} vahvistettua ongelmaa.`;
} else {
  verdict = 'KAIKKI KUNNOSSA';
  headline = reviewLevel === 0
    ? 'Ei ongelmia, ei kohtia katsottavana. Ei toimenpiteitä.'
    : `Ei yhtään estävää ongelmaa. Vahdit merkitsivät ${reviewLevel} kohtaa varmuudeksi katsottavaksi (ne osuvat tarkoituksella herkästi). Ei pakollisia toimenpiteitä.`;
}

// 4. Write the plain-language report.
const L = [];
L.push(`# Turvatarkistuksen raportti`);
L.push('');
L.push(`**${verdict}** — ${headline}`);
L.push('');
L.push(`Ajettu ${now} · commit ${commit} · kohde aimeat/src`);
L.push('');
L.push(`| | |`);
L.push(`|---|---|`);
L.push(`| Estäviä ongelmia | ${errorLevel} |`);
L.push(`| Kohtia katsottavana (ei pakollista) | ${reviewLevel} |`);
L.push(`| Turvatarkistuksia vihreänä | ${gateResults.length - gatesFailed.length} / ${gateResults.length} |`);
L.push('');

L.push(`## Mitä vahdit suojaavat`);
L.push('');
L.push('"Katsottavaa" ei tarkoita vikaa — vahdit hälyttävät herkästi, jotta mikään oikea ei jää huomaamatta. Ihminen vilkaisee ja kuittaa.');
L.push('');
for (const [id, info] of Object.entries(GUARDS)) {
  const hits = byGuard[id] || [];
  const state = hits.length === 0 ? 'puhdas' : `${hits.length} kohtaa katsottavana`;
  L.push(`### ${info.protects}`);
  L.push(`*${state}* · vahti \`${info.tech}\``);
  L.push('');
  if (hits.length > 0) {
    L.push(info.glance);
    L.push('');
    for (const h of hits) L.push(`- \`${h.file}:${h.line ?? '?'}\``);
    L.push('');
  } else {
    L.push('Ei huomioita. Ei tekemistä.');
    L.push('');
  }
}

L.push(`## Automaattiset turvatarkistukset`);
L.push('');
L.push('Nämä ajetaan joka koodimuutoksella. Jos jokin muuttuu punaiseksi, se estää muutoksen.');
L.push('');
for (const g of gateResults) L.push(`- ${g.ok ? '🟢' : '🔴'} ${g.plain}`);
L.push('');

L.push(`## Mitä koneellisesti ei voi tarkistaa`);
L.push('');
L.push('Muutamaa turvasääntöä (esimerkiksi tarkistuksen oikea järjestys koodissa, tai vanhentuneen ominaisuuden poisto) ei voi tarkistaa automaattisesti. Niitä vartioivat testit, jotka ajetaan joka kerta. Kokonaisuus on katettu — osa koneella, osa testeillä.');
L.push('');
L.push('---');
L.push(`*Koneellisesti tuotettu. Raakadata: findings.json, gates.json samassa hakemistossa.*`);

writeFileSync(resolve(OUT, 'RAPORTTI.md'), L.join('\n') + '\n');

process.stderr.write(`\nRaportti kirjoitettu: ${norm(resolve(OUT, 'RAPORTTI.md'))}\n`);
process.stderr.write(`Verdikti: ${verdict} — ${headline}\n`);
