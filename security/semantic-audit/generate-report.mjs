/**
 * pnpm audit:report — aja koko semanttinen turva-auditointi ja kirjoita ihmisluettava raportti,
 * koneellisesti, hakemistoon secaudit/ (gitignoressa).
 *
 * Raportti perustelee jokaisen vahdin (mitä suojaa, miksi, miten testataan, mikä ei kelpaa),
 * TODISTAA joka ajolla että vahti nappaa tahallaan rikotun koodin (omavalvonta), ja piirtää
 * mermaid-kaaviot. Koneluettava data kirjoitetaan erikseen (data.json) AI:lle.
 *
 * 2026-08-23 alkaen raportti lukee myös triage-muistin (triage-store.json: AI:n ja ihmisen
 * kuittaamat osumat + avoimet invarianttihavainnot, ks. ai-triage.mjs), riippuvuuksien tunnetut
 * haavoittuvuudet (pnpm audit) ja git-historian salaisuusskannauksen (gitleaks, peitetyin osumin).
 *
 * Aja aimeat/-paketista:  node ../security/semantic-audit/generate-report.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDS, CHECKS, NOT_STATIC } from './report-content.mjs';
import { astScan, fingerprintOf, loadStore, norm } from './audit-lib.mjs';
import { triageSection, depsSection, secretsSection } from './report-sections.mjs';
import { runDepsAudit } from './deps-audit.mjs';
import { runSecretsScan } from './secrets-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const AIMEAT = resolve(ROOT, 'aimeat');
const OUT = resolve(ROOT, 'secaudit');
mkdirSync(OUT, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} klo ${pad(d.getHours())}:${pad(d.getMinutes())}`;
let commit = 'tuntematon';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* ei repo */ }

// 1. Aja vahdit oikeaa koodia vasten, ja jaa osumat triage-muistin perusteella:
//    kuitatut (legit), ihmistä odottavat (confirm) ja kokonaan triagemattomat (fresh).
process.stderr.write('1/5 Ajetaan vahdit oikeaa koodia vasten…\n');
const store = loadStore();
const ackByFp = new Map(store.entries.map(e => [e.fingerprint, e]));
const findings = astScan('aimeat/src');
const byGuard = {};
let ackedLegit = 0;
const freshFindings = [];
for (const f of findings) {
  const fp = fingerprintOf(f);
  const ack = ackByFp.get(fp);
  const hit = { file: norm(f.file), line: (f.range?.start?.line ?? -1) + 1, fingerprint: fp, ack: ack || null };
  (byGuard[f.ruleId] ??= []).push(hit);
  if (ack?.verdict === 'legit') ackedLegit++;
  else if (!ack) freshFindings.push(hit);
}
const liveFps = new Set(findings.map(fingerprintOf));
const pendingConfirm = store.entries.filter(e => e.verdict === 'confirm' && liveFps.has(e.fingerprint));
const openInvariants = store.invariantFindings.filter(f => f.status === 'open');
const errorLevel = findings.filter(f => (f.severity || 'warning') === 'error').length;
// Katsottavaa on vain se mitä kukaan ei ole vielä kuitannut: triagemattomat + ihmistä odottavat.
const reviewLevel = freshFindings.length + pendingConfirm.length;

// 2. OMAVALVONTA: aja jokainen vahti tahallaan rikottua koodia vasten ja varmista että se nappaa sen.
process.stderr.write('2/5 Omavalvonta: ajetaan vahdit rikottua koodia vasten…\n');
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
process.stderr.write('3/5 Ajetaan automaattiset tarkistukset…\n');
const gates = [];
for (const [script, name, why] of CHECKS) {
  let ok = true;
  try { execSync(`pnpm ${script}`, { cwd: AIMEAT, stdio: 'pipe' }); } catch { ok = false; }
  gates.push({ script, name, why, ok });
  process.stderr.write(`   ${ok ? '✓' : '✗'} ${name}\n`);
}
const gatesFailed = gates.filter(g => !g.ok);

// 4. Riippuvuuksien tunnetut haavoittuvuudet.
process.stderr.write('4/5 Tarkistetaan riippuvuudet (pnpm audit)…\n');
const deps = runDepsAudit(AIMEAT);
const depsWorst = deps.ok ? deps.counts.critical + deps.counts.high : 0;

// 5. Salaisuudet git-historiassa (gitleaks, peitetyin osumin).
process.stderr.write('5/5 Skannataan git-historia salaisuuksien varalta…\n');
const secrets = await runSecretsScan(ROOT, OUT);
const newSecrets = secrets.ok ? secrets.count : 0;

// Verdikti.
let verdict, verdictWhy;
if (gatesFailed.length) { verdict = '🔴 HUOMIO'; verdictWhy = `${gatesFailed.length} automaattista tarkistusta on punaisella — muutokset estyvät kunnes korjattu.`; }
else if (errorLevel) { verdict = '🔴 HUOMIO'; verdictWhy = `${errorLevel} vahvistettua ongelmaa.`; }
else if (newSecrets) { verdict = '🔴 HUOMIO'; verdictWhy = `${newSecrets} kuittaamatonta salaisuusosumaa git-historiassa — käytävä läpi heti.`; }
else if (GUARDS.some(g => !g.selfOk)) { verdict = '🟠 TARKISTA'; verdictWhy = `${GUARDS.length - selfPass} vahtia ei läpäissyt omavalvontaa — vahti ei ehkä enää toimi.`; }
else if (depsWorst) { verdict = '🟠 TARKISTA'; verdictWhy = `${depsWorst} korkean tai kriittisen tason haavoittuvuutta riippuvuuksissa.`; }
else if (pendingConfirm.length || openInvariants.length) { verdict = '🟠 TARKISTA'; verdictWhy = `${pendingConfirm.length + openInvariants.length} kohtaa odottaa ihmisen vahvistusta (AI-triage tai invarianttikatselmointi).`; }
else if (!secrets.ok || !deps.ok) { verdict = '🟠 TARKISTA'; verdictWhy = 'Osa tarkistuksista ei valmistunut — katso osiot alta.'; }
else { verdict = '🟢 KAIKKI KUNNOSSA'; verdictWhy = freshFindings.length === 0 ? 'Ei ongelmia, ei katsottavaa: jokainen osuma on kuitattu ja kaikki tarkistukset vihreitä.' : `Ei yhtään estävää ongelmaa. ${freshFindings.length} uutta osumaa odottaa triagea (\`pnpm audit:triage\`).`; }

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
M.push('## Tiivistelmä');
M.push('');
M.push(`### ${verdict}`);
M.push('');
M.push(verdictWhy);
M.push('');
M.push('| Mittari | Tulos | Mitä tarkoittaa |');
M.push('|---|---|---|');
M.push(`| Estäviä ongelmia | **${errorLevel}** | Ongelmia jotka estävät julkaisun. Nolla = ei estettä. |`);
M.push(`| Katsottavia kohtia | **${reviewLevel}** | Osumia joita kukaan ei ole vielä kuitannut (${freshFindings.length} triagematonta, ${pendingConfirm.length} ihmisen jonossa). **Ei vikoja.** |`);
M.push(`| Kuitattuja osumia | **${ackedLegit}** | AI:n tai ihmisen lailliseksi toteamia, perustelu tallessa. Eivät nouse uudelleen. |`);
M.push(`| Automaattiset tarkistukset | **${gates.length - gatesFailed.length} / ${gates.length}** | Vihreitä = kunnossa. |`);
M.push(`| Vahtien omavalvonta | **${selfPass} / ${GUARDS.length}** | Todistettu joka ajolla: vahti nappaa tahallaan rikotun koodin. |`);
M.push(`| Riippuvuushaavoittuvuudet | **${deps.ok ? `${depsWorst} vakavaa / ${Object.values(deps.counts).reduce((a, b) => a + b, 0)} yht.` : 'ei ajettu'}** | Tunnetut CVE:t riippuvuuspuussa (${deps.ok ? deps.totalDeps : '?'} pakettia). |`);
M.push(`| Salaisuuksia historiassa | **${secrets.ok ? `${newSecrets} uutta` : 'ei ajettu'}** | Koko git-historia, osumat aina peitettyinä. |`);
M.push(`| Avoimia invarianttihavaintoja | **${openInvariants.length}** | AI:n diffikatselmoinnin nostamat järjestys- ja politiikkahuolet. |`);
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
M.push('## Miten järjestelmä toimii');
M.push('');
M.push('Turva-auditointi on **jatkuva**, ei kertaluontoinen. Joka koodimuutoksella ajetaan neljä asiaa:');
M.push('');
M.push('1. **Vahdit** — hakevat koodista kuvioita jotka rikkoisivat turvasäännön (esim. datahaku ilman tunnuksen ratkaisua). Ne osuvat tarkoituksella herkästi, jotta mikään oikea ongelma ei jää huomaamatta.');
M.push('2. **AI-triage** — jokainen vahdin osuma katselmoidaan kerran: AI lukee koodin osuman ympäriltä ja joko kuittaa sen lailliseksi kuvioksi perusteluineen tai nostaa sen ihmiselle. Kuittaus säilyy kunnes se koodikohta muuttuu. Sama ajo katselmoi git-muutokset niitä turvasääntöjä vasten joita konehaku ei tavoita (tarkistusten järjestys, deprekointipolitiikka, otsakkeiden luotettavuus, federaation allekirjoitus).');
M.push('3. **Automaattiset tarkistukset** — laskennallisia sääntöjä (esim. "jokaisella muuttavalla reitillä on lupavahti"). Jos jokin rikkoutuu, se muuttuu punaiseksi ja **estää muutoksen**.');
M.push('4. **Ympäristön tarkistukset** — riippuvuuspuun tunnetut haavoittuvuudet (CVE) ja koko git-historian salaisuusskannaus.');
M.push('');
M.push('Lisäksi tämä raportti tekee joka ajolla **omavalvonnan**: se ajaa jokaisen vahdin tahallaan rikottua koodinpätkää vasten ja varmistaa että vahti nappaa sen. Näin tiedetään ettei vahti ole vahingossa lakannut toimimasta — ei riitä että puhdas koodi menee läpi, myös rikkomus on osuttava.');
M.push('');

// 3. Vahdit
M.push('## Vahdit — mitä ne suojaavat ja miten se on todistettu');
M.push('');
M.push('> "Katsottavaa" ei tarkoita vikaa. Vahdit hälyttävät herkästi tarkoituksella. Jokaisen kohdalla kerrotaan mitä se suojaa, miksi se on tärkeää, miten se testataan, mikä ei kelpaa, ja todiste että vahti oikeasti toimii.');
M.push('');
for (const g of GUARDS) {
  const hits = byGuard[g.id] || [];
  const open = hits.filter(h => h.ack?.verdict !== 'legit');
  const acked = hits.length - open.length;
  M.push(`### ${g.protects}`);
  M.push(`*Tila: ${open.length === 0 ? `🟢 puhdas${acked ? ` (${acked} osumaa kuitattu lailliseksi)` : ''}` : `🟠 ${open.length} kohtaa katsottavana`}  ·  vahti \`${g.tech}\`  ·  työkalu: ${g.tool}*`);
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
  M.push(`**Tulos nyt.** ${hits.length === 0
    ? 'Ei osumia. Ei tekemistä.'
    : open.length === 0
      ? `Kaikki ${acked} osumaa on kuitattu lailliseksi perusteluineen (katso AI-triage-osio). Ei tekemistä.`
      : `${open.length} kohtaa katsottavana${acked ? ` (lisäksi ${acked} jo kuitattu)` : ''}. ${g.triage}`}`);
  if (open.length) {
    M.push('');
    for (const h of open) M.push(`- \`${h.file}:${h.line}\`${h.ack ? ` — ${h.ack.reason}` : ' — ei vielä triagea'}`);
  }
  M.push('');
}

// AI-triage: kuittaukset ja ihmistä odottavat kohdat.
M.push(...triageSection(store, pendingConfirm, openInvariants));

// Automaattiset tarkistukset
M.push('## Automaattiset tarkistukset');
M.push('');
M.push('Nämä ajetaan joka koodimuutoksella ja **estävät muutoksen** jos jokin rikkoutuu.');
M.push('');
M.push('| Tila | Mitä varmistaa | Miksi |');
M.push('|---|---|---|');
for (const g of gates) M.push(`| ${g.ok ? '🟢' : '🔴'} | ${g.name} | ${g.why} |`);
M.push('');

// Riippuvuudet ja salaisuudet.
M.push(...depsSection(deps));
M.push(...secretsSection(secrets));

// Mitä ei voi tarkistaa
M.push('## Mitä koneellisesti ei voi tarkistaa — ja miten se on katettu');
M.push('');
M.push('Rehellisyyden vuoksi: kaikkea ei voi tarkistaa koneella. Nämä eivät ole aukkoja — ne on katettu toisin, ja se sanotaan tässä.');
M.push('');
M.push('| Asia | Miksi kone ei näe sitä | Miten katettu |');
M.push('|---|---|---|');
for (const [a, b, c] of NOT_STATIC) M.push(`| ${a} | ${b} | ${c} |`);
M.push('');

// Kattavuus
M.push('## Kattavuus yhdellä silmäyksellä');
M.push('');
M.push('```mermaid');
M.push('flowchart TD');
M.push('  T[Turvasäännöt] --> A[Vahdit<br/>ast-grep]');
M.push('  T --> B[Automaattiset<br/>tarkistukset]');
M.push('  T --> C[AI-triage ja -katselmointi<br/>sille mitä konehaku ei näe]');
M.push('  T --> D[Ympäristö]');
GUARDS.forEach((g, i) => M.push(`  A --> a${i}["${g.protects}"]`));
M.push(`  B --> b0["${gates.length} tarkistusta, ${gatesFailed.length === 0 ? 'kaikki vihreää' : `${gatesFailed.length} punaisella`}"]`);
M.push(`  C --> c0["osumien kuittaus perusteluineen"]`);
M.push(`  C --> c1["järjestys, deprekointi, otsakkeet,<br/>federaation allekirjoitus"]`);
M.push(`  D --> d0["riippuvuuksien CVE:t"]`);
M.push(`  D --> d1["salaisuudet git-historiassa"]`);
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
  summary: {
    blocking: errorLevel, toReview: reviewLevel, acknowledged: ackedLegit,
    pendingHuman: pendingConfirm.length, openInvariantFindings: openInvariants.length,
    gatesGreen: gates.length - gatesFailed.length, gatesTotal: gates.length,
    selfCheckPass: selfPass, selfCheckTotal: GUARDS.length,
    depVulns: deps.ok ? deps.counts : null, newSecrets: secrets.ok ? secrets.count : null,
  },
  guards: GUARDS.map(g => ({ id: g.id, protects: g.protects, selfCheckOk: g.selfOk, hits: byGuard[g.id] || [] })),
  gates,
  deps,
  secrets,
  invariantFindings: openInvariants,
}, null, 2));

process.stderr.write(`\n✅ Raportti: ${norm(resolve(OUT, 'RAPORTTI.md'))}\n`);
process.stderr.write(`   Verdikti: ${verdict} — ${verdictWhy}\n`);
process.stderr.write(`   Omavalvonta: ${selfPass}/${GUARDS.length} vahtia todistetusti toiminnassa\n`);
