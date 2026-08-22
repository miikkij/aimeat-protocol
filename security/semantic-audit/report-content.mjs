/**
 * The human content of the audit report: what each guard protects, why it matters, how it is
 * tested, what a violation looks like, and a deliberately-broken snippet used to PROVE the guard
 * catches a violation (not just that clean code passes). Kept apart from generate-report.mjs so the
 * report's words live in one readable place. Finnish, because that is who reads it.
 */

// Each guard: the ast-grep rule id, and everything the report says about it.
export const GUARDS = [
  {
    id: 'raw-sub-into-storage-arg-no-resolve',
    tech: 'resolve-identity',
    protects: 'Kukaan ei näe toisen asiakkaan dataa',
    why:
      'Kirjautuneen käyttäjän tunnus tulee pyynnön mukana kahdessa muodossa: pelkkä nimi (`alice`) ' +
      'ja täysi tunnus (`alice@node`). Jos koodi hakee dataa pelkällä nimellä eikä täydellä ' +
      'tunnuksella, se voi osua väärään tietueeseen. Pahimmassa tapauksessa asiakas A:n pyyntö ' +
      'lukisi asiakas B:n tiedostot. Siksi jokaisen datahaun on ratkaistava täysi tunnus ennen kantaa.',
    tool: 'ast-grep (rakenteellinen koodihaku)',
    method:
      'Etsii kohdat joissa raaka `req.auth.sub` menee suoraan kantakutsun argumenttiin ilman että ' +
      'sama funktio kutsuu `resolveIdentity`ä.',
    notAccepted: 'const files = await storage.listStorageFiles(req.auth!.sub);',
    accepted: 'const id = resolveIdentity(req.auth!, nodeId);\nconst files = await storage.listStorageFiles(id);',
    // A file that MUST trigger the rule — used to prove the guard works.
    selfCheck:
      'export function bad(req, storage) {\n' +
      '  return storage.listStorageFiles(req.auth!.sub);\n' +
      '}\n',
    triage:
      'Kaikki nykyiset osumat ovat laillisia: agentti-istunnossa `sub` ON oikea tunnus, ja ' +
      'attribuutiokentät (kuka teki) käyttävät sitä oikein. Raja pitää. Ei tekemistä.',
  },
  {
    id: 'role-or-scope-agent-bypasses-scope',
    tech: 'permission-word',
    protects: 'Jokainen toiminto vaatii oikean luvan',
    why:
      'Kun ovi tarkistaa "onko kutsuja agentti TAI onko sillä lupa X", agentti pääsee läpi pelkän ' +
      'roolin perusteella ennen kuin lupaa X edes katsotaan. Silloin lupasana on koriste: omistaja ' +
      'luulee hallitsevansa jotain jota ei oikeasti tarkisteta tuolla ovella.',
    tool: 'ast-grep',
    method: "Etsii kutsut `requireRoleOrScope('agent', …)`, joissa agentti-rooli ohittaa lupasanan.",
    notAccepted: "router.post('/x', requireRoleOrScope('agent', 'organism:invite'), handler)",
    accepted: "router.post('/x', requireScope('organism:invite'), handler)",
    selfCheck:
      "export const r = requireRoleOrScope('agent', 'organism:invite');\n",
    triage:
      'Neljä "kutsu jäsen" -ovea kannattaa vilkaista: vaativatko ne varmasti oikean luvan. Ei merkki ' +
      'viasta — tarkistuslista.',
  },
  {
    id: 'owner-name-cross-owner-widening',
    tech: 'owner-name',
    protects: 'Vain tilin omistaja voi muuttaa omaa tiliään',
    why:
      'Tilin nimi kulkee jokaisen omistajalle kuuluvan tunnuksen mukana — myös agenttien ja ' +
      'sovellusten. Tarkistus "omistaja !== nimi" torjuu vain eri henkilön, mutta päästää läpi ' +
      'kaiken mikä toimii tämän henkilön nimissä (agentit, sovellukset). Tilin muutokseen (salasana, ' +
      'poisto, vienti) se ei riitä — silloin pitää vaatia nimenomaan omistajaa itseään.',
    tool: 'ast-grep',
    method: "Etsii kuvion `owner !== name && !roles.includes('operator')`, joka levittää oven eikä kaventaa.",
    notAccepted: "if (req.auth!.owner !== name && !req.auth!.roles.includes('operator')) return deny();",
    accepted: 'router.delete(\'/account\', requireOwnerPrincipal(), handler)',
    selfCheck:
      "export function bad(req, name) {\n" +
      "  if (req.auth!.owner !== name && !req.auth!.roles.includes('operator')) return;\n" +
      "}\n",
    triage:
      'Tilin vienti ja poisto kannattaa vilkaista: käyttävätkö ne tiukinta omistaja-tarkistusta. ' +
      'Kolmas osuma (instanssin omistajuus) on laillinen, koska se ei koske itse tiliä.',
  },
  {
    id: 'optional-auth-if-not-req-auth-gate',
    tech: 'optional-auth',
    protects: 'Kirjautuminen vaaditaan oikeasti',
    why:
      'Järjestelmä liittää jokaiseen pyyntöön tunnuksen — myös kirjautumattomaan, jolloin se saa ' +
      'jaetun "anonyymi"-tunnuksen. Siksi tarkistus "jos ei tunnusta" ei koskaan täsmää: tunnus on ' +
      'aina olemassa. Ovi joka luottaa siihen päästää anonyymin sisään kuin kirjautuneen.',
    tool: 'ast-grep',
    method: 'Etsii reiteistä `if (!req.auth)` -tarkistuksen, jota käytetään pääsyn porttina.',
    notAccepted: 'if (!req.auth) { res.status(401).end(); return; }',
    accepted: 'router.get(\'/x\', requireAuth(), handler)  // ja anonyymi: req.auth.anonymous === true',
    selfCheck:
      'export function bad(req, res) {\n' +
      '  if (!req.auth) { res.status(401).end(); return; }\n' +
      '}\n',
    triage:
      'Kolme näkymää kannattaa vilkaista: torjuvatko ne varmasti kirjautumattoman. Todennäköisesti ' +
      'kunnossa, mutta varmistuksen arvoista.',
  },
];

// The automatic ratchets: plain name + why it matters + tool.
export const CHECKS = [
  ['check:route-scopes', 'Jokainen muutos vaatii luvan', 'Muutos-toiminto ilman lupatarkistusta on oikeuksien kiertoreitti. Skripti laskee: jokaisella muuttavalla reitillä on oltava lupavahti.'],
  ['check:denial-coverage', 'Luvaton pääsy testataan ja estetään', 'Jokaiselle tunnuksia koskevalle ominaisuudelle on testi joka yrittää luvatonta pääsyä ja odottaa 403:a.'],
  ['check:outbound-fetch', 'Ulkoiset yhteydet tarkistetaan', 'Palvelimen ulos ottamat yhteydet kulkevat tarkistuksen läpi, ettei niitä voi ohjata sisäverkkoon (SSRF).'],
  ['check:trusted-keys', 'Salaisuuksiin ei pääse käsiksi väärin', 'Avaimet joita palvelin lukee ja joihin se luottaa eivät saa olla sovelluksen kirjoitettavissa.'],
  ['check:storage-parity', 'Data tallentuu samoin joka tietokannalla', 'Uusi tietotyyppi on toteutettava molemmilla tietokannoilla, ettei toinen taustajärjestelmä käyttäydy eri tavalla.'],
  ['check:ext-entrypoints', 'Laajennukset eivät saa piiloreittejä', 'Laajennuksen sisäänkäynnit on ilmoitettava, ei pääteltävä — ettei synny vahvistamatonta pintaa.'],
  ['check:shared-impl', 'Jokainen toiminto tehdään yhdessä paikassa', 'Sama toiminto ei saa olla toteutettu kahdesti (esim. työkalu ohi reitin), jottei toinen kopio jää ilman lupatarkistusta.'],
  ['check:sse-parity', 'Reaaliaikanäkymä vastaa oikeaa dataa', 'Reaaliaikainen syöte näyttää saman kuin varsinainen rajapinta, ei eri sääntöjä.'],
  ['check:copied-logic', 'Turvapäätöstä ei kirjoiteta kahdesti', 'Sama turvapäätös kahdessa paikassa ajautuu erilleen; skripti vaatii yhden lähteen.'],
  ['check:liaison-surface', 'Python-paketti vastaa palvelinta', 'CrewAI-liaison-paketti ei saa tarjota työkalua jota palvelin ei enää tue.'],
  ['check:mcp-tools', 'AI-työkalut samat joka rajapinnassa', 'AI-työkalujen NIMET täsmäävät node-, connector- ja CLI-pinnalla, ettei jokin ovi tarjoa eri työkaluja.'],
  ['check:mcp-schemas', 'AI-työkalujen parametrit samat', 'AI-työkalujen PARAMETRIT täsmäävät joka pinnalla, ettei parametri katoa hiljaa yhdellä ovella.'],
];

// Invariants that cannot be a clean static rule, and what covers them instead.
export const NOT_STATIC = [
  ['Tarkistuksen oikea järjestys', 'Sääntö ennen kirjoitusta, ei jälkeen. Tämä on kontrollivuon järjestys — staattinen haku ei näe sitä luotettavasti.', 'Kattavuus: E2E-testit.'],
  ['Vanhentuneen ominaisuuden poisto', 'Deprekoinnin on nimettävä lippu, oletus ja poistoversio. Tämä on politiikka, ei koodikuvio.', 'Kattavuus: katselmointi.'],
  ['Otsakkeen luotettavuus autorisoinnissa', 'Laillinen tunnus-otsake ja hyökkäyksen väite-otsake näyttävät koodissa samalta. Ei erotettavissa koneella.', 'Kattavuus: katselmointi + Host-johdettu alkuperä.'],
];
