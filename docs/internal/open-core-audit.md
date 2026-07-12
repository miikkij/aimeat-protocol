# Open core -rajan auditointi (AIMEAT)

**Päiväys:** 2026-06-10
**Laajuus:** `aimeat-protocol` (julkinen, `miikkij/aimeat-protocol`) ja sisarrepo `crewfive` (julkinen, `miikkij/crewaimeat`) + `crewfive-backup-pre-filterrepo.bundle`. Muut `e:\dev\GitHub`-kansiot eivät ole AIMEAT-repoja.
**Menetelmä:** Kolme rinnakkaista tarkastusta (hakemistoluokittelu, työpuun salaisuusskannaus, git-historian salaisuusskannaus) + kriittisten löydösten manuaalinen verifiointi (`git ls-files`, `git log -S`, sisällön tarkistus). Salaisuusarvot on raportissa peitetty (8 ensimmäistä merkkiä).

> **EI SIIRRETTY EIKÄ POISTETTU MITÄÄN** — tämä on pelkkä raportti.

---

## Tiivistelmä

1. **B-koria (managed-arvo) ei käytännössä ole näissä repoissa.** Provisiointia, Hetzner/Scaleway-kutsuja, warm poolia, Stripe/laskutusta, tuotanto-deploy-pipelinea tai backup-automaatiota ei löytynyt kummastakaan reposta. Managed-kerros on siis vielä rakentamatta — hyvä uutinen open core -rajan kannalta, mutta `aimeat-cloud`-privaattirepo kannattaa perustaa *ennen* kuin sitä aletaan rakentaa.
2. **C-korissa on kaksi kriittistä, julkiseen GitHubiin pushattua salasanavuotoa** (`***REMOVED***` ja `***REMOVED***`) sekä historiasta poistettu mutta historiaan jäänyt paikallisen MongoDB:n tunnus. Nämä vaativat **rotaation, ei pelkkää poistoa**.
3. **Levyllä (gitignoroituna) makaa oikeita API-avaimia irtotiedostoissa** (`openrouter_key.log`, `xai_api_key.log`, `crewfive\xaikey.log`, `crewfive\email_setup.log`) — eivät gitissä, mutta yhden `.gitignore`-virheen päässä vuodosta.
4. **Rajatapauksia 5 kpl** (mm. crewfiven `crews/`-paketit ja `docs/internal/`-strategiadokumentit, jotka ovat crewfivessä julkisessa gitissä) — päätökset sinulla, listattu alla.

---

## A-kori: AVOIN YDIN (yhteenveto)

Seuraavat alueet kuuluvat selvästi MIT-repoon ja ovat siellä nyt — ei toimenpiteitä:

| Alue | Polku |
|---|---|
| Protokollaspeksi + RFC | `docs/` (julkinen osa: `01-core.md`…`09-community.md`, RFC v3.0, endpoint-referenssit) |
| API-sopimus | `openapi.yaml` |
| Node-referenssitoteutus | `aimeat/src/` (reitit, storage-abstraktio SQLite/MongoDB/Postgres, auth/GAII, federaatio, morsel-talous, MCP-työkalut) |
| Frontend-SPA | `aimeat/public/` |
| Desktop-sovellus | `aimeat-desktop/` (Tauri) |
| Python-SDK | `python/aimeat-crewai/` |
| CrewAI-integraatio | `crewfive` (crewaimeat-runko, liaison, daemon, `startup.prompt.md`) |
| Self-host-asennus | `aimeat/Dockerfile`, `aimeat/docker-compose.sqlite.yml`, `aimeat/docker-compose.postgres.yml`, `.env.example`-pohjat, `docs/personal-node-setup-guide.md` |
| CI | `.github/workflows/` (lint/build/test — ei tuotanto-deployta) |
| Testit | `aimeat/test/` (19 E2E-suitea), Playwright-infra |

**Huom:** `aimeat/src/routes/instances.ts` ja MCP-työkalut `aimeat_instance_create/list/status` ovat **pakettiekosysteemin instansseja** (CSM-pakettien asennus/migraatio protokollan sisällä), **eivät** VM/node-provisiointia. Ne kuuluvat A-koriin. Nimi on harhaanjohtava — jos managed-puolelle tulee joskus oikea node-provisiointi, nimeä se eri tavalla (esim. `node_provision_*`).

---

## B-kori: MANAGED-ARVO (löydökset)

Varsinaista B-koodia (provisiointi, pilvi-API:t, laskutus, tuotanto-ops) **ei löytynyt kummastakaan reposta**. Haut kattoivat: `hetzner`, `hcloud`, `scaleway`, `scw`, `stripe`, `billing`, `provision`, `warm pool`, `terraform`, `ansible`, `systemd`, `backup`, `runbook` — nolla osumaa koodissa.

B-luonteista *sisältöä* löytyi kuitenkin seuraavasti:

| # | Polku | Perustelu | Git-status |
|---|---|---|---|
| B1 | `docs/internal/` (aimeat-protocol, ~30 tiedostoa: organism-suunnitelmat, arkkitehtuurivisiot, CONTINUATION-promptit, gaps-and-improvements) | Sisäiset suunnittelu- ja jatkuvuusdokumentit — työskentelykontekstia, ei julkista dokumentaatiota | **Ei gitissä** (gitignored, vain levyllä) |
| B2 | `crewfive/docs/internal/` (`01-positioning.md`, `02-segments-and-next-poc.md`, `04-operational-state.md`, `06-expectations-per-group.md` ym.) | Go-to-market-strategia, asiakassegmentit, operatiivinen tila — liiketoimintastrategiaa | ⚠️ **TRACKED julkisessa crewfive-repossa** |
| B3 | `docs/businessfinland/` | Gitignoressa "Business strategy (private)" — kansiota **ei ole levyllä** tällä hetkellä; ignore-sääntö on varotoimi | Ei gitissä, ei levyllä |
| B4 | Juuren työlokit ja kuvakaappaukset (`*.log`-muistiinpanot, `phase*.log`, `jounisideas.log`, `*.png`-verifiointikuvat) | Kehityssession artefakteja, eivät kuulu mihinkään repoon julkaistavaksi — eivät tosin salaisia (tarkastettu) | Lokit ei gitissä; **osa png:istä saattaa olla** — siivousasia |
| B5 | `.tmp_ocean_archive.html`, `.tmp_ocean_c2d.html` | Talletettuja Cloudflare-virhesivuja (blog.oceanprotocol.com) — roskaa julkisessa repossa | ⚠️ **TRACKED** — poista |

**Johtopäätös:** Ainoa aito "B-kori julkisessa gitissä" -ongelma on **B2** (crewfiven strategiadokumentit). Muut ovat hygieniaa.

---

## C-kori: SENSITIIVINEN (löydökset)

### KRIITTINEN — committattu ja pushattu julkiseen GitHubiin

| # | Polku | Mikä | Status |
|---|---|---|---|
| C1 | `docs/plans/frontend-component-unification.md:157,159` | Operator-tunnus `happyadmin` + salasana `***REMOVED***` plaintextinä, kahdesti, valmiina `loginWithPassword(...)`-rivinä — perässä ironisesti "Do not commit these credentials." | **TRACKED, julkinen** (commit `f6fdedb5`, 2026-06-02, `origin/main`) |
| C2 | `docs/superpowers/plans/prompts/ui-design-compliance-audit.md:519` ja `docs/superpowers/plans/prompts/full-reaudit-prompt.md:342` | `Admin password (.env): ***REMOVED***` — **sama arvo kuin nykyinen `AIMEAT_ADMIN_PASSWORD`** paikallisessa `aimeat\.env`:ssä; samoissa tiedostoissa myös dev-tunnus `buildertest`/`Test1234` | **TRACKED, julkinen** (commit `b9f23ea2`, `origin/main`) |
| C3 | `aimeat/.env.test.mongodb` (poistettu HEAD:ista, **jäljellä historiassa**) | Oikean paikallisen WSL/Docker-MongoDB:n tunnukset `databasem…:kaikenti…@localhost` | Historiassa commiteissa mm. `c69e9eae`, `f9a1b1ca`, `b854d988` — julkisessa historiassa vaikka tiedosto on poistettu |

**Vakavuusarvio:** C1:n salasana on sama kuin crewfiven `.env`:n aimeat.io-tuotantotilin (`happydud…`) kirjautumissalasana ja yhden merkin päässä tuotannon SMTP-salasanasta (`mail.aimeat.io` / `notifications@aimeat.io`). Eli julkisesti vuotanut arvo **ei ole vain localhost-dev-salasana** — salasanan uudelleenkäyttö laajentaa vaikutuksen tuotantoon.

### KORKEA — oikeita salaisuuksia levyllä, ei gitissä (vain .gitignoren varassa)

| # | Polku | Mikä |
|---|---|---|
| H1 | `openrouter_key.log` (repon juuri) | Elävä OpenRouter-avain (`sk-or-v1-fe610f0b…`) irtotiedostossa |
| H2 | `xai_api_key.log` (repon juuri) | Elävä xAI-avain (`xai-0w7TuTsd…`) |
| H3 | `crewfive\xaikey.log` | Toinen, eri xAI-avain (`xai-wPpzKP6s…`) |
| H4 | `crewfive\.env` | Toinen OpenRouter-avain (`sk-or-v1-a6c8f8b9…`), Tavily-avain (`tvly-dev…`), aimeat.io-tilin salasana (= C1-arvo), tuotannon SMTP-salasana |
| H5 | `aimeat\.env` | `AIMEAT_ADMIN_PASSWORD` (= C2-arvo), SMTP-salasana, `AIMEAT_ENCRYPTION_KEY`, **VAPID-yksityisavain**, paikalliset Mongo-tunnukset, operaattorin nimi + katuosoite |
| H6 | `crewfive\email_setup.log` | Tuotannon SMTP-blokki plaintextinä (`mail.aimeat.io`, `notifications@aimeat.io`, salasana) |

Mikään näistä ei ole gitissä (verifioitu `git log --all` + `ls-files`) — mutta H1–H3 ja H6 ovat irtotiedostoja, joiden ainoa suoja on `*.log`-ignore-sääntö. Avaimet kuuluvat vain `.env`:iin tai avainnippuun.

### KESKITASO

- `aimeat\.env` sisältää operaattorin **henkilötiedot** (nimi, katuosoite) — GDPR-näkökulmasta hyvä tiedostaa, ei gitissä.
- `aimeat.io`-viittaukset koodissa/dokumentaatiossa ovat tarkoituksellisia (julkinen hosted-node) — ei vuoto.
- Kovakoodattuja tuotanto-IP:itä **ei löytynyt**. SQLite-testikannat (`dify-test.db`, `.test-e2e.db`) sisältävät vain anonyymiä testidataa.

---

## Git-historian tarkistus (C-kori) — rotaatiovaatimukset

Salaisuus joka on *joskus* ollut julkisessa historiassa on vuotanut, vaikka tiedosto olisi myöhemmin poistettu. Pelkkä poisto tai edes history-rewrite ei riitä — **arvo on rotatoiva**.

| Commit | Pvm | Tiedosto | Vuoto | Tila nyt |
|---|---|---|---|---|
| `f6fdedb5` | 2026-06-02 | `docs/plans/frontend-component-unification.md` | `happyadmin` / `***REMOVED***` | Yhä HEAD:issa, julkinen |
| `b9f23ea2` | — | `docs/superpowers/plans/prompts/*.md` (2 kpl) | `***REMOVED***` (= nykyinen admin-pw), `buildertest`/`Test1234` | Yhä HEAD:issa, julkinen |
| `c69e9eae`, `f9a1b1ca`, `b854d988` ym. | — | `aimeat/.env.test.mongodb` | Paikallisen Mongon tunnukset | Poistettu HEAD:ista, **jäljellä historiassa** |

**Puhtaiksi todetut:** API-avaimia (`sk-or-`, `sk-ant-`, `xai-`, `ghp_`, `AKIA`, private key -blokit, `hcloud`, `scw_`) **ei ole koskaan committattu kumpaankaan repoon** — kaikki historiaosumat olivat i18n-placeholdereita, katkaistuja esimerkki-JWT:itä tai `.env.example`-pohjia. `openrouter_key.log`, `xai_api_key.log`, oikeat `.env`-tiedostot, `*.pem`/`*.key` ja `docs/internal/` eivät ole koskaan olleet trackattuina aimeat-protocolissa.

**crewfive:** nykyinen historia (131 committia) puhdas — ei koskaan salaisuuksia. **Bundle** (`crewfive-backup-pre-filterrepo.bundle`): aiempi filter-repo-siivous poisti **yritysnimiä ja PRH-tunnuksen**, ei salaisuuksia; siivoamattomia committeja ei koskaan pushattu (verifioitu GitHub-API:sta — pre-scrub-SHA:t eivät ole noudettavissa). Bundle ei vaadi rotaatiota, mutta pidä se poissa pilvisynkasta jos yritysnimisiivous oli luottamuksellisuussyistä.

### Rotaatiolista (prioriteettijärjestyksessä)

1. **aimeat.io-tilin (`happydud…`) salasana** — sama arvo kuin julkinen C1. **Heti.**
2. **`mail.aimeat.io` SMTP-salasana** (`notifications@aimeat.io`) — yhden merkin päässä C1-arvosta; vaihda samalla.
3. **`AIMEAT_ADMIN_PASSWORD`** (= C2, julkinen) — kaikkialla missä arvoa käytetään, erityisesti jos sama aimeat.io-tuotantonodessa.
4. **`happyadmin`-dev-salasana** paikallisella nodella + kaikkialla missä uudelleenkäytetty.
5. Paikallisen Docker-Mongon tunnukset (C3) — matala prioriteetti (localhost-bind), mutta julkisessa historiassa.
6. *Harkinnan mukaan:* H1–H4-API-avaimet (OpenRouter ×2, xAI ×2, Tavily) — eivät ole vuotaneet gitiin, mutta ovat lojuneet irtotiedostoissa; halpa rotatoida samalla.

Lisäksi: scrubbaa C1/C2-rivit HEAD:ista heti (tämä ei korvaa rotaatiota). Historian uudelleenkirjoitus (filter-repo + force push) on rotaation jälkeen valinnainen kosmeettinen toimi.

---

## Jakosuunnitelma: `aimeat-cloud` (privaatti repo)

Koska B-koodia ei vielä ole, kyse on enemmän **rajan pystyttämisestä etukäteen** kuin siirrosta. Ehdotus:

### Vaihe 1 — Perusta `aimeat-cloud` ja siirrä olemassa oleva B-sisältö

Uuden privaattirepon runko:

```
aimeat-cloud/
├── docs/
│   ├── internal/        ← aimeat-protocol/docs/internal/ (levyltä; ei git-historiaa siirrettävänä)
│   ├── strategy/        ← crewfive/docs/internal/ (vaatii poiston crewfiven julkisesta historiasta, ks. alla)
│   └── runbooks/        ← uudet tuotanto-playbookit kirjoitetaan tänne alusta asti
├── provisioning/        ← tuleva: instanssien luonti/tuhoaminen, warm pool, Hetzner/Scaleway-API:t
├── billing/             ← tuleva: Stripe-integraatio
├── onboarding/          ← tuleva: asiakaskohtainen konfigurointi
├── ops/                 ← tuleva: deploy-pipeline, backup-automaatio, monitorointi
└── crews-pro/           ← MAHDOLLISESTI: myytävät vertikaalipaketit (rajatapaus R1, päätös sinulla)
```

Siirtojärjestys:
1. Luo privaatti repo, siirrä `docs/internal/` sinne (pelkkä levykopiointi — kansio ei ole gitissä, joten ei historiaongelmaa). Jätä `docs/internal/`-ignore-sääntö aimeat-protocoliin varotoimeksi.
2. `crewfive/docs/internal/` → `aimeat-cloud/docs/strategy/`. Tämä **on** crewfiven julkisessa historiassa: pelkkä siirto ei piilota vanhoja versioita. Päätä haluatko (a) vain poistaa HEAD:ista (historia jää luettavaksi) vai (b) filter-repo + force push (crewfivessä on tehty kerran ennenkin). Strategiadokumenteissa ei ole salaisuuksia, joten (a) voi riittää.
3. Lisää aimeat-cloudiin heti `CLAUDE.md`/README-sääntö: *"kaikki Hetzner/Scaleway/Stripe/provisiointi/ops-koodi kirjoitetaan tähän repoon, ei koskaan aimeat-protocoliin"* — raja pitää parhaiten kun se on kirjattu molempien repojen ohjeisiin.

### Vaihe 2 — Hygienia julkisessa repossa

4. Poista C1/C2-salasanarivit dokumenteista (rotaation jälkeen tai samanaikaisesti).
5. Poista trackatut roskat: `.tmp_ocean_archive.html`, `.tmp_ocean_c2d.html`; arvioi juuren `*.png`-kuvakaappaukset.
6. Siirrä irtotiedostoavaimet (H1–H3, H6) `.env`-tiedostoihin ja poista lokitiedostot levyltä.
7. Harkitse `.gitignore`-sääntöä `*key*.log` / secret-scanning pre-commit -hookkia (esim. gitleaks) estämään toistuminen.

### Katkeavat importit/riippuvuudet

- **Ei yhtään koodi-importtia katkea** — siirrettävä aines on pelkkää dokumentaatiota. `aimeat/src`, `python/`, `aimeat-desktop/` ja crewfiven koodi eivät viittaa `docs/internal/`-sisältöön.
- `CLAUDE.md` viittaa tiedostoon `docs/internal/aimeat-dev-organism-plan.md` — päivitä viittaus tai jätä kansiosta stub.
- Crewfiven README/`startup.prompt.md` eivät viittaa `docs/internal/`-kansioon (viittaavat crews-rakenteeseen — relevanttia vain jos R1-rajatapauksessa siirrät crews-paketteja).
- Appdev-organismin `main-context` saattaa viitata internal-dokumentteihin — tarkista kun siirto tehdään.

---

## Rajatapaukset — päätökset sinulla, en päätä puolestasi

| # | Kohde | Jännite |
|---|---|---|
| R1 | **`crewfive/crews/` — valmiit CrewAI-crewit (~kymmeniä)** | Speksin mukaan "vertikaalien agenttipaketit (valmiit CrewAI-crewit myyntiin)" = B-kori. Mutta ne ovat nyt julkisia ja toimivat samalla *esimerkkeinä* jotka opettavat crewaimeat-integraation. Vaihtoehdot: kaikki julki (OSS-esimerkit, raha tulee managed-hostauksesta) / kaikki privaattiin / hybridi (perus-crewit julki, vertikaalipremiumit `aimeat-cloud/crews-pro`). Huom: jo julkaistun poistaminen ei poista sitä forkeista. |
| R2 | **`docker-compose.*.yml` + `Dockerfile`** | Self-hostaaja tarvitsee nämä → A-kori-peruste vahva. Mutta sama compose on todennäköisesti managed-instanssien deploy-pohja. Ehdotus harkittavaksi: geneerinen self-host-compose julki, tuotantokohtainen (volyymit, backupit, monitorointi) aimeat-cloudiin — mutta päätös sinun. |
| R3 | **`crewfive/docs/internal/` historia** | Sisältö siirtyy privaattiin (B2), mutta jääkö vanha versio julkiseen git-historiaan (kevyt) vai tehdäänkö toinen filter-repo + force push (raskas, katkaisee forkkien historian)? |
| R4 | **Tuleva backup-automaatio** | Speksisi listaa backup-automaation B-koriin, mutta self-hostaaja tarvitsee backup-ohjeen/skriptin myös. Raja kannattaa päättää ennen kuin kumpaakaan kirjoitetaan: esim. dokumentoitu `mongodump`/SQLite-kopiointiohje julki, ajastettu monen asiakkaan backup-orkestrointi privaattiin. |
| R5 | **`startup.prompt.md` + crewfiven onboarding-runbook-luonne** | Nyt selvästi avoin onboarding-apu (A). Jos siihen alkaa kertyä managed-asiakkaan provisiointilogiikkaa (node-instanssin tilaus tms.), raja ylittyy huomaamatta — seurattava. |

---

## Liite: tarkistettu mutta puhdas (false positive -lista)

- `startup.prompt.md` — ei salaisuuksia, kehottaa kysymään avaimet käyttäjältä. A-kori.
- `ai-assisted*.log`, `portal.log`, `debug.log`, `formeandothers.log`, `jounisideas.log`, `organisms-ui-renew.log`, `phase*.log` — dev-muistiinpanoja, ei salaisuuksia (B4-siivousasia silti).
- Historian `sk-or-v1`-osumat = i18n-placeholdereita; `eyJhbGciOi…`-osumat = katkaistuja esimerkki-JWT:itä; `mongodb+srv://` = validointivirheviesti.
- `.env.test.sqlite`/`.env.test.memory` historiassa = vain dummy-arvot (`test-admin-pw`, sekvenssiavain `01020304…`).
- `aimeat_instance_*`-MCP-työkalut ja `instances.ts` = pakettiekosysteemiä, ei provisiointia (verifioitu lähdekoodista).
- Searxng-compose crewfivessä (`infra/searxng/`) = kehitystyökalu, ei tuotantoinfra.
