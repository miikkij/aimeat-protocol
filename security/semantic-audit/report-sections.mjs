/**
 * @file report-sections.mjs
 * @description Markdown builders for the audit report sections added on 2026-08-23: the AI-triage
 * state (what is acknowledged, what awaits a human), the non-static invariant review, dependency
 * vulnerabilities and the secret scan. Each function returns an array of markdown lines; the words
 * are Finnish because that is who reads the report.
 * @version-history
 *  - 1.0.0 (2026-08-23): first version.
 */

const INV_NAMES = {
  5: 'federaation allekirjoitus tarkistetaan ehdoitta',
  13: 'portti lukee normalisoidun arvon, ei raakaa pyyntöä',
  14: 'sääntö ennen kirjoitusta',
  16: 'deprekointi nimeää lipun, oletuksen ja poistoversion',
};

/** Section: what the AI triage has decided, and what still needs a person. */
export function triageSection(store, pendingConfirm, openInvariants) {
  const M = [];
  M.push('## AI-triage — kuittaukset ja ihmistä odottavat kohdat');
  M.push('');
  M.push('Vahdit hälyttävät herkästi tarkoituksella, joten jokainen osuma katselmoidaan kerran: AI lukee');
  M.push('osuman ympäröivine koodeineen ja joko kuittaa sen lailliseksi kuvioksi perusteluineen tai nostaa');
  M.push('sen ihmiselle. Kuittaus tallentuu (`security/semantic-audit/triage-store.json`) ja pysyy voimassa');
  M.push('kunnes kyseinen koodikohta muuttuu — sama osuma ei nouse katsottavaksi kahdesti. Uudet osumat');
  M.push('katselmoidaan ajamalla `pnpm audit:triage`.');
  M.push('');
  if (store.entries.length === 0) {
    M.push('Triagea ei ole vielä ajettu tälle koodille.');
    M.push('');
    return M;
  }
  const legit = store.entries.filter(e => e.verdict === 'legit');
  M.push(`Kuitattuja lailliseksi: **${legit.length}** · ihmistä odottaa: **${pendingConfirm.length + openInvariants.length}**`);
  M.push('');
  if (pendingConfirm.length) {
    M.push('### 🟠 Ihmisen vahvistusta odottavat osumat');
    M.push('');
    M.push('| Kohta | Vahti | AI:n perustelu | Päätös |');
    M.push('|---|---|---|---|');
    for (const e of pendingConfirm) {
      M.push(`| \`${e.file}:${e.line}\` | ${e.ruleId} | ${e.reason} | ${e.date} (${e.decidedBy}) |`);
    }
    M.push('');
    M.push('Kun kohta on katsottu: joko korjaa koodi, tai muuta kyseisen kuittauksen `verdict` arvoon');
    M.push('`legit` ja `decidedBy` arvoon `human` perusteluineen triage-storeen.');
    M.push('');
  }
  if (openInvariants.length) {
    M.push('### 🟠 Avoimet invarianttihavainnot (AI-katselmointi diffiä vasten)');
    M.push('');
    M.push('| Invariantti | Kohta | Havainto | Väli |');
    M.push('|---|---|---|---|');
    for (const f of openInvariants) {
      M.push(`| ${f.invariant} — ${INV_NAMES[f.invariant] || ''} | \`${f.file}\` | ${f.note} | ${f.commitRange} |`);
    }
    M.push('');
    M.push('Havainto suljetaan muuttamalla sen `status` arvoon `closed` triage-storeen, kun se on käsitelty.');
    M.push('');
  }
  if (!pendingConfirm.length && !openInvariants.length) {
    M.push('🟢 Ei mitään ihmisen jonossa: jokainen osuma on kuitattu ja invarianttikatselmointi on puhdas.');
    M.push('');
  }
  if (legit.length) {
    M.push('<details><summary>Lailliseksi kuitatut osumat perusteluineen</summary>');
    M.push('');
    M.push('| Kohta | Vahti | Perustelu | Kuitattu |');
    M.push('|---|---|---|---|');
    for (const e of legit) M.push(`| \`${e.file}:${e.line}\` | ${e.ruleId} | ${e.reason} | ${e.date} (${e.decidedBy}) |`);
    M.push('');
    M.push('</details>');
    M.push('');
  }
  return M;
}

/** Section: known CVEs in the dependency tree. */
export function depsSection(deps) {
  const M = [];
  M.push('## Riippuvuuksien haavoittuvuudet');
  M.push('');
  if (!deps.ok) {
    M.push(`🟠 Tarkistus ei valmistunut: ${deps.error}`);
    M.push('');
    return M;
  }
  const c = deps.counts;
  const worst = c.critical + c.high;
  M.push(`Koko riippuvuuspuu (${deps.totalDeps} pakettia) tarkistettiin tunnettuja haavoittuvuuksia (CVE) vasten.`);
  M.push('');
  M.push('| Kriittinen | Korkea | Kohtalainen | Matala |');
  M.push('|---|---|---|---|');
  M.push(`| ${c.critical} | ${c.high} | ${c.moderate} | ${c.low} |`);
  M.push('');
  if (deps.advisories.length === 0) {
    M.push('🟢 Ei yhtään tunnettua haavoittuvuutta riippuvuuksissa.');
  } else {
    M.push(`${worst ? '🔴' : '🟠'} Löydökset vakavimmasta alkaen:`);
    M.push('');
    M.push('| Paketti | Vakavuus | Mikä | Korjaus |');
    M.push('|---|---|---|---|');
    for (const a of deps.advisories.slice(0, 30)) {
      M.push(`| ${a.module} | ${a.severity} | [${a.title}](${a.url}) | ${a.fixed ? `päivitä versioon ${a.fixed}` : 'ei vielä korjausta'} |`);
    }
  }
  M.push('');
  return M;
}

/** Section: secrets in the full git history, redacted. */
export function secretsSection(secrets) {
  const M = [];
  M.push('## Salaisuudet git-historiassa');
  M.push('');
  M.push('Koko git-historia skannataan vuotaneiden salaisuuksien (avaimet, tokenit, salasanat) varalta.');
  M.push('Osumien sisältö peitetään aina — raporttiin ei koskaan päädy itse salaisuutta.');
  M.push('');
  if (!secrets.ok) {
    M.push(`🟠 Skannaus ei valmistunut: ${secrets.error}`);
    M.push('');
    return M;
  }
  if (secrets.count === 0) {
    M.push(`🟢 Ei yhtään ${secrets.baselined ? 'uutta ' : ''}osumaa. (gitleaks v${secrets.version}${secrets.baselined ? ', kuitatut aiemmat osumat ohitettu baselinen kautta' : ''})`);
    M.push('');
    return M;
  }
  M.push(`🔴 **${secrets.count} osumaa** jotka eivät ole kuitatussa baselinessa. Jokainen on käytävä läpi:`);
  M.push('vuotanut oikea salaisuus on VAIHDETTAVA (pelkkä poisto ei riitä, historia säilyy), ja väärä');
  M.push('hälytys kuitataan baselineen (`security/semantic-audit/gitleaks-baseline.json`).');
  M.push('');
  M.push('| Sääntö | Tiedosto | Rivi | Commit |');
  M.push('|---|---|---|---|');
  for (const f of secrets.findings) M.push(`| ${f.rule} | \`${f.file}\` | ${f.line} | \`${f.commit}\` |`);
  if (secrets.count > secrets.findings.length) M.push(`| … | yhteensä ${secrets.count} osumaa, täysi lista: \`secaudit/gitleaks.json\` | | |`);
  M.push('');
  return M;
}
