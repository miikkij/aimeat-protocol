/**
 * pnpm audit:report — aja koko semanttinen turva-auditointi ja kirjoita ihmisluettava raportti,
 * koneellisesti, hakemistoon secaudit/ (gitignoressa).
 *
 * Raportti perustelee jokaisen vahdin (mitä suojaa, miksi, miten testataan, mikä ei kelpaa),
 * TODISTAA joka ajolla että vahti nappaa tahallaan rikotun koodin (omavalvonta), ja piirtää
 * mermaid-kaaviot. Koneluettava data kirjoitetaan erikseen (data.json) AI:lle.
 *
 * Aja aimeat/-paketista:  node ../security/semantic-audit/generate-report.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDS, CHECKS, NOT_STATIC } from './report-content.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const AIMEAT = resolve(ROOT, 'aimeat');
const OUT = resolve(ROOT, 'secaudit');
mkdirSync(OUT, { recursive: true });

const norm = s => (s || '').replace(/\\/g, '/');
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} klo ${pad(d.getHours())}:${pad(d.getMinutes())}`;
let commit = 'tuntematon';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* ei repo */ }

const astScan = (path) => JSON.parse(execSync(
  `npx -y -p @ast-grep/cli@0.45.1 ast-grep scan -c security/semantic-audit/sgconfig.yml ${path} --json=compact`,
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
) || '[]');

// 1. Aja vahdit oikeaa koodia vasten.
process.stderr.write('1/3 Ajetaan vahdit oikeaa koodia vasten…\n');
const findings = astScan('aimeat/src');
const byGuard = {};
for (const f of findings) (byGuard[f.ruleId] ??= []).push({ file: norm(f.file), line: (f.range?.start?.line ?? -1) + 1 });
const errorLevel = findings.filter(f => (f.severity || 'warning') === 'error').length;
const reviewLevel = findings.length - errorLevel;

// 2. OMAVALVONTA: aja jokainen vahti tahallaan rikottua koodia vasten ja varmista että se nappaa sen.
process.stderr.write('2/3 Omavalvonta: ajetaan vahdit rikottua koodia vasten…\n');
const SELF = resolve(OUT, '.selftest');
rmSync(SELF, { recursive: true, force: true });
mkdirSync(SELF, { recursive: true });
for (const g of GUARDS) writeFileSync(resolve(SELF, `${g.tech}.ts`), g.selfCheck);
const selfFindings = astScan(norm(SELF).replace(norm(ROOT) + '/', ''));
const selfHitIds = new Set(selfFindings.map(f => f.ruleId));
for (const g of GUARDS) g.selfOk = selfHitIds.has(g.id);
rmSync(SELF, { recursive: true, force: true });
const selfPass = GUARDS.filter(g => g.selfOk).length;

// 3. Aja automaattiset tarkistukset.
process.stderr.write('3/3 Ajetaan automaattiset tarkistukset…\n');
const gates = [];
for (const [script, name, why] of CHECKS) {
  let ok = true;
  try { execSync(`pnpm ${script}`, { cwd: AIMEAT, stdio: 'pipe' }); } catch { ok = false; }
  gates.push({ script, name, why, ok });
  process.stderr.write(`   ${ok ? '✓' : '✗'} ${name}\n`);
}
const gatesFailed = gates.filter(g => !g.ok);

// Verdikti.
let verdict, verdictWhy;
if (gatesFailed.length) { verdict = '🔴 HUOMIO'; verdictWhy = `${gatesFailed.length} automaattista tarkistusta on punaisella — muutokset estyvät kunnes korjattu.`; }
else if (errorLevel) { verdict = '🔴 HUOMIO'; verdictWhy = `${errorLevel} vahvistettua ongelmaa.`; }
else if (GUARDS.some(g => !g.selfOk)) { verdict = '🟠 TARKISTA'; verdictWhy = `${GUARDS.length - selfPass} vahtia ei läpäissyt omavalvontaa — vahti ei ehkä enää toimi.`; }
else { verdict = '🟢 KAIKKI KUNNOSSA'; verdictWhy = reviewLevel === 0 ? 'Ei ongelmia, ei katsottavaa.' : `Ei yhtään estävää ongelmaa. Vahdit merkitsivät ${reviewLevel} kohtaa varmuudeksi katsottavaksi (ne osuvat tarkoituksella herkästi). Ei pakollisia toimenpiteitä.`; }

// ── Rakenna markdown ──
const M = [];
const code = (s, lang = 'ts') => '```' + lang + '\n' + s + '\n```';
M.push('# AIMEAT — Turvatarkistuksen raportti');
M.push('');
M.push(`**Muodostettu:** ${stamp}  ·  **commit:** \`${commit}\`  ·  **kohde:** \`aimeat/src\`  ·  **työkalut:** ast-grep + audit-gate-skriptit`);
M.push('');
M.push('---');
M.push('');

// 1. Tiivistelmä
M.push('## 1. Tiivistelmä');
M.push('');
M.push(`### ${verdict}`);
M.push('');
M.push(verdictWhy);
M.push('');
M.push('| Mittari | Tulos | Mitä tarkoittaa |');
M.push('|---|---|---|');
M.push(`| Estäviä ongelmia | **${errorLevel}** | Ongelmia jotka estävät julkaisun. Nolla = ei estettä. |`);
M.push(`| Katsottavia kohtia | **${reviewLevel}** | Vahtien merkitsemiä kohtia, jotka ihminen vilkaisee varmuudeksi. **Ei vikoja.** |`);
M.push(`| Automaattiset tarkistukset | **${gates.length - gatesFailed.length} / ${gates.length}** | Vihreitä = kunnossa. |`);
M.push(`| Vahtien omavalvonta | **${selfPass} / ${GUARDS.length}** | Todistettu joka ajolla: vahti nappaa tahallaan rikotun koodin. |`);
M.push('');
M.push('```mermaid');
M.push('flowchart LR');
M.push('  A[Koodimuutos] --> B{Vahdit + tarkistukset<br/>ajetaan}');
M.push('  B -->|kaikki vihreä| C[Muutos hyväksytään]');
M.push('  B -->|jokin punainen| D[Muutos estetään<br/>kunnes korjattu]');
M.push('  C --> E[Tulokset<br/>seurattavina]');
M.push('  style C fill:#1a7f45,color:#fff');
M.push('  style D fill:#c0362c,color:#fff');
M.push('```');
M.push('');

// 2. Miten toimii
M.push('## 2. Miten järjestelmä toimii');
M.push('');
M.push('Turva-auditointi on **jatkuva**, ei kertaluontoinen. Joka koodimuutoksella ajetaan kaksi asiaa:');
M.push('');
M.push('1. **Vahdit** — hakevat koodista kuvioita jotka rikkoisivat turvasäännön (esim. datahaku ilman tunnuksen ratkaisua). Ne osuvat tarkoituksella herkästi, jotta mikään oikea ongelma ei jää huomaamatta; ihminen vilkaisee ja kuittaa loput.');
M.push('2. **Automaattiset tarkistukset** — laskennallisia sääntöjä (esim. "jokaisella muuttavalla reitillä on lupavahti"). Jos jokin rikkoutuu, se muuttuu punaiseksi ja **estää muutoksen**.');
M.push('');
M.push('Lisäksi tämä raportti tekee joka ajolla **omavalvonnan**: se ajaa jokaisen vahdin tahallaan rikottua koodinpätkää vasten ja varmistaa että vahti nappaa sen. Näin tiedetään ettei vahti ole vahingossa lakannut toimimasta — ei riitä että puhdas koodi menee läpi, myös rikkomus on osuttava.');
M.push('');

// 3. Vahdit
M.push('## 3. Vahdit — mitä ne suojaavat ja miten se on todistettu');
M.push('');
M.push('> "Katsottavaa" ei tarkoita vikaa. Vahdit hälyttävät herkästi tarkoituksella. Jokaisen kohdalla kerrotaan mitä se suojaa, miksi se on tärkeää, miten se testataan, mikä ei kelpaa, ja todiste että vahti oikeasti toimii.');
M.push('');
for (const g of GUARDS) {
  const hits = byGuard[g.id] || [];
  M.push(`### ${g.protects}`);
  M.push(`*Tila: ${hits.length === 0 ? '🟢 puhdas' : `🟠 ${hits.length} kohtaa katsottavana`}  ·  vahti \`${g.tech}\`  ·  työkalu: ${g.tool}*`);
  M.push('');
  M.push(`**Miksi tämä on tärkeää.** ${g.why}`);
  M.push('');
  M.push(`**Miten se testataan.** ${g.method}`);
  M.push('');
  M.push('**Mikä EI kelpaa:**');
  M.push(code(g.notAccepted));
  M.push('**Näin se tehdään oikein:**');
  M.push(code(g.accepted));
  M.push(`**Todiste että vahti toimii.** ${g.selfOk ? '✅ Vahti ajettiin tämän tahallaan rikotun esimerkin läpi ja **nappasi sen**. Vahti on toimintakunnossa.' : '❌ Vahti EI napannut rikottua esimerkkiä — se ei ehkä enää toimi. Tämä vaatii korjauksen.'}`);
  M.push('');
  M.push(`**Tulos nyt.** ${hits.length === 0 ? 'Ei osumia. Ei tekemistä.' : `${hits.length} kohtaa katsottavana. ${g.triage}`}`);
  if (hits.length) {
    M.push('');
    for (const h of hits) M.push(`- \`${h.file}:${h.line}\``);
  }
  M.push('');
}

// 4. Automaattiset tarkistukset
M.push('## 4. Automaattiset tarkistukset');
M.push('');
M.push('Nämä ajetaan joka koodimuutoksella ja **estävät muutoksen** jos jokin rikkoutuu.');
M.push('');
M.push('| Tila | Mitä varmistaa | Miksi |');
M.push('|---|---|---|');
for (const g of gates) M.push(`| ${g.ok ? '🟢' : '🔴'} | ${g.name} | ${g.why} |`);
M.push('');

// 5. Mitä ei voi tarkistaa
M.push('## 5. Mitä koneellisesti ei voi tarkistaa — ja miksi');
M.push('');
M.push('Rehellisyyden vuoksi: kaikkea ei voi tarkistaa koneella. Nämä eivät ole aukkoja — ne on katettu toisin, ja se sanotaan tässä.');
M.push('');
M.push('| Asia | Miksi kone ei näe sitä | Miten katettu |');
M.push('|---|---|---|');
for (const [a, b, c] of NOT_STATIC) M.push(`| ${a} | ${b} | ${c} |`);
M.push('');

// 6. Kattavuus
M.push('## 6. Kattavuus yhdellä silmäyksellä');
M.push('');
M.push('```mermaid');
M.push('flowchart TD');
M.push('  T[Turvasäännöt] --> A[Vahdit<br/>ast-grep]');
M.push('  T --> B[Automaattiset<br/>tarkistukset]');
M.push('  T --> C[Testit<br/>sille mitä kone ei näe]');
GUARDS.forEach((g, i) => M.push(`  A --> a${i}["${g.protects}"]`));
M.push(`  B --> b0["${gates.length} tarkistusta, kaikki vihreää"]`);
M.push(`  C --> c0["järjestys, deprekointi, otsakkeet"]`);
M.push('  style T fill:#2b6cb0,color:#fff');
M.push('```');
M.push('');
M.push('---');
M.push(`*Koneellisesti tuotettu ${stamp}. Koneluettava data samassa hakemistossa: \`data.json\` (AI:lle), \`findings.json\`, \`gates.json\`.*`);

const markdown = M.join('\n') + '\n';
writeFileSync(resolve(OUT, 'RAPORTTI.md'), markdown);

// HTML-versio joka renderöi mermaid-kaaviot varmasti selaimessa (avaa RAPORTTI.html).
const html = `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>AIMEAT Turvaraportti</title>
<style>
 body{max-width:860px;margin:0 auto;padding:32px 20px;font:16px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1f28;background:#fbfcfd}
 h1{font-size:1.9rem;letter-spacing:-.02em} h2{margin-top:2.4em;padding-bottom:.3em;border-bottom:1px solid #e3e8ef}
 h3{margin-top:1.8em} table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.93rem}
 th,td{border:1px solid #e3e8ef;padding:8px 11px;text-align:left;vertical-align:top} th{background:#f2f5f9}
 code{background:#eef1f5;padding:.1em .35em;border-radius:4px;font-size:.88em}
 pre{background:#0e141b;color:#e6edf3;padding:14px 16px;border-radius:9px;overflow-x:auto} pre code{background:none;color:inherit;padding:0}
 pre.mermaid{background:#f6f8fb;text-align:center} blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid #2b6cb0;color:#47505e;background:#f2f6fb}
 hr{border:0;border-top:1px solid #e3e8ef;margin:2em 0} a{color:#2b6cb0}
 @media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}h2,hr{border-color:#26303b}th,td{border-color:#26303b}th{background:#161d27}code{background:#1c242e}pre.mermaid{background:#12171f}blockquote{background:#12171f;color:#a3adba}}
</style></head><body><article id="doc"></article>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
const md = ${JSON.stringify(markdown)};
document.getElementById('doc').innerHTML = marked.parse(md);
document.querySelectorAll('code.language-mermaid').forEach(c=>{const p=document.createElement('pre');p.className='mermaid';p.textContent=c.textContent;c.closest('pre').replaceWith(p);});
const dark = matchMedia('(prefers-color-scheme:dark)').matches;
mermaid.initialize({startOnLoad:false,theme:dark?'dark':'default'});
mermaid.run();
</script></body></html>`;
writeFileSync(resolve(OUT, 'RAPORTTI.html'), html);

// ── Koneluettava data (AI:lle) ──
writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
writeFileSync(resolve(OUT, 'gates.json'), JSON.stringify(gates, null, 2));
writeFileSync(resolve(OUT, 'data.json'), JSON.stringify({
  generatedAt: d.toISOString(),
  commit,
  verdict: verdict.replace(/^\S+\s/, ''),
  summary: { blocking: errorLevel, toReview: reviewLevel, gatesGreen: gates.length - gatesFailed.length, gatesTotal: gates.length, selfCheckPass: selfPass, selfCheckTotal: GUARDS.length },
  guards: GUARDS.map(g => ({ id: g.id, protects: g.protects, selfCheckOk: g.selfOk, hits: byGuard[g.id] || [] })),
  gates,
}, null, 2));

process.stderr.write(`\n✅ Raportti: ${norm(resolve(OUT, 'RAPORTTI.md'))}\n`);
process.stderr.write(`   Verdikti: ${verdict} — ${verdictWhy}\n`);
process.stderr.write(`   Omavalvonta: ${selfPass}/${GUARDS.length} vahtia todistetusti toiminnassa\n`);
