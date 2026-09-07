/**
 * The human content of the audit report: what each guard protects, why it matters, how it is
 * tested, what a violation looks like, and a deliberately-broken snippet used to PROVE the guard
 * catches a violation (not just that clean code passes). Kept apart from generate-report.mjs so the
 * report's words live in one readable place. Finnish, because that is who reads it.
 */

import { AUDIT_CHECKS } from '../../aimeat/scripts/lib/check-registry.mjs';

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
export const CHECKS = AUDIT_CHECKS.map(({ script, label }) => [script, label, `pnpm ${script}`]);

// Invariants that cannot be a clean static rule, and what covers them instead. Since 2026-08-23 the
// AI diff review (ai-triage.mjs) reads every commit range against these four, so "katselmointi" is a
// run, not a hope.
export const NOT_STATIC = [
  ['Tarkistuksen oikea järjestys', 'Sääntö ennen kirjoitusta, ei jälkeen. Tämä on kontrollivuon järjestys — staattinen haku ei näe sitä luotettavasti.', 'Kattavuus: E2E-testit + AI-diffikatselmointi joka triage-ajolla.'],
  ['Vanhentuneen ominaisuuden poisto', 'Deprekoinnin on nimettävä lippu, oletus ja poistoversio. Tämä on politiikka, ei koodikuvio.', 'Kattavuus: AI-diffikatselmointi joka triage-ajolla.'],
  ['Otsakkeen luotettavuus autorisoinnissa', 'Laillinen tunnus-otsake ja hyökkäyksen väite-otsake näyttävät koodissa samalta. Ei erotettavissa koneella.', 'Kattavuus: Host-johdettu alkuperä + AI-diffikatselmointi joka triage-ajolla.'],
  ['Federaation allekirjoituksen ehdottomuus', 'Ehtolause allekirjoitustarkistuksen ympärillä voi olla laillinen tai vika — muoto on sama. Ei erotettavissa koneella.', 'Kattavuus: federaation E2E-testit + AI-diffikatselmointi joka triage-ajolla.'],
];
