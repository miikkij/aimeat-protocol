# Soluuntuminen Masterplan — Design Document

*2026-03-01 — Kokonaissuunnitelma AIMEAT:n soluuntumis-ominaisuuksille*

---

## Tavoite

Toteuttaa kaikki ominaisuudet joita tarvitaan siihen, että ihmiset voivat "soluuntua" AIMEAT-federaation kautta: löytää toisensa, organisoitua yhteisöiksi, hallita dataansa turvallisesti, ja luoda palveluita jotka palvelevat oikeita ihmisiä — ei korporaatioita.

## Arkkitehtuuri

Hybrid-malli: **Phase 0 lineaarinen** (perusinfra joka mahdollistaa kaiken muun) → **Phase 1+ vertical slices** (jokainen phase tuottaa yhden kokonaisen end-to-end palvelun infralaajennusten lisäksi).

DMZ-konsepti ohjaa kaikkea: Private Zone → DMZ (controlled sharing) → Federation.

## Riippuvuudet olemassaolevaan

| Olemassaoleva | Hyödynnetään | Laajennetaan |
|---|---|---|
| Memory API (private/federation/public) | Consent-profiili tallentuu memoryna | + per-recipient, expires, audit |
| MSM (YAML-palvelukuvaukset) | Pohja palvelukuvauksille | CSM = erillinen community-formaatti |
| JSON Schema Locking -speksi | Implementoidaan koodiin | + open/strict mode |
| Data Description Convention | Quality/trust metadata | + flaggaus-mekanismi |
| Catalogue (haku, paginaatio) | Hakemistojen pohja | + directory-endpoint, profiilihaku |
| GHII-identiteettijärjestelmä | Tier 0-3 | + TOTP, email-vahvistus, web-rekisteröinti |
| OTP/TOTP-tutkimus | Implementoidaan | Phase 0 |
| DMZ-konseptidokumentti | Arkkitehtuuriohje | Formalisoidaan consent+visibility -malliin |

---

## Phase 0: Foundation (lineaarinen perusinfra)

> Rakennetaan pohja jolle kaikki muu nojaa. Ei näkyvää palvelua vielä — pelkkää infraa.

### 0.1 JSON Schema Locking (implementaatio)

**Mitä:** Toteutetaan `docs/nextlevel/aimeat-json-schema-locking.md` -speksi koodiin.

**Tekniset vaatimukset:**
- Dependency: `ajv` + `ajv-formats`
- Uudet endpointit:
  - `PUT /v1/memory/{key}/schema` — aseta schema
  - `GET /v1/memory/{key}/schema` — lue schema
  - `DELETE /v1/memory/{key}/schema` — poista schema
  - `GET /v1/schemas?prefix={prefix}` — listaa schemat
- Storage: uusi `memory_schemas` Map/taulu
- Validointilogiikka: memory-kirjoitus → tarkista onko schemaa → validoi AJV:llä → hyväksy/hylkää
- **`schema_mode`:** palvelun tekijä päättää `open` (additionalProperties: true, oletus) tai `strict` (additionalProperties: false)
- AJV compile cache performanssille

**Miksi Phase 0:** Kaikki myöhemmät palvelut (CSM, marketplace, hakemistot) nojaavat schemaan.

### 0.2 CSM — Community Service Manifest

**Mitä:** Uusi YAML-formaatti community-palveluille, erillinen MSM:stä.

**CSM vs MSM:**
- MSM = ulkoinen API-integraatio (Stripe, Wolt, OpenWeather)
- CSM = sisäinen community-palvelu (markkinapaikka, hakemisto, foorumi, treffisivusto)

**CSM-kenttärakenne:**
```yaml
csm: "1.0"
service:
  name: "Harrastehakemisto"
  type: "directory"  # marketplace|directory|forum|dating|news|opinion|auction|media
  description: "Löydä harrastuksia ja samanhenkisiä läheltäsi"

schema_mode: "open"  # open|strict — palvelun tekijä päättää

data_schema:
  required:
    name: { type: string, min: 1, max: 200 }
    category: { type: string, enum: ["luonto", "urheilu", "taide", ...] }
    location: { type: object, properties: { city: string, area: string } }
  optional:
    description: { type: string, max: 2000 }
    contact: { type: string }
    image_url: { type: string, format: uri }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false  # Phase 2

ui_hints:
  list_view: ["name", "category", "location"]
  detail_view: ["name", "description", "category", "location", "contact"]
  search_fields: ["name", "category", "location.city"]
```

**Deliverables:**
- `docs/csm-spec.md` — CSM-spesifikaatio
- `docs/csm-examples/hobby-directory.csm.yaml` — esimerkkihakemisto
- `docs/csm-examples/marketplace.csm.yaml` — esimerkkimarkkinapaikka
- CSM-parseri koodissa: lukee YAML, luo schemat, rekisteröi endpointit

### 0.3 Consent Layer

**Mitä:** Consent-profiili memoryssä + endpointit + audit trail. DMZ-konseptin mukainen: consent hallitsee mitä siirtyy Private → DMZ → Federation.

**Consent-profiili:**
```json
{
  "key": "consent.{ghii}.profile",
  "value": {
    "default_policy": "private",
    "consents": [
      {
        "id": "consent-001",
        "data_pattern": "profile.*.interests",
        "recipient": "*",
        "purpose": "discovery",
        "scope": "federation",
        "expires": null,
        "granted": "2026-03-15T10:00:00Z",
        "status": "active"
      }
    ]
  }
}
```

**Endpointit:**
- `POST /v1/consent` — myönnä suostumus (data_pattern, recipient, purpose, scope, expires)
- `GET /v1/consent` — listaa omat suostumukset
- `GET /v1/consent/{id}` — yksittäinen suostumus
- `DELETE /v1/consent/{id}` — peru suostumus
- `GET /v1/consent/audit?days=30` — kaikki datankäytöt viimeiseltä N päivältä

**Per-recipient + aikaperusteinen consent:**
- `recipient`: `*` (kaikki), GAII (tietty agentti), `organism.{id}` (ryhmä)
- `expires`: ISO 8601 datetime tai `null` (toistaiseksi)
- Vanhentuneet suostumukset → `status: "expired"` automaattisesti

**Integraatio memory-readiin:**
- Memory GET → tarkista consent → palauta vain data johon on suostumus
- Audit: kirjaa kaikki datankäytöt (kuka luki, milloin, mitä avainta)

**DMZ-formalisointi:**
- Dokumentointi: miten Private/DMZ/Federation -vyöhykkeet ja consent toimivat yhdessä
- Private = vain omalla koneella, consent ei voi avata
- DMZ = consent-ohjattu: näkyy vain niille joille consent on myönnetty
- Federation = julkinen, ei consent-rajoituksia

### 0.4 Kiinnostusprofiili-standardi

**Mitä:** Standardoitu memory-avainrakenne ihmisprofiileille.

**Avainrakenne:**
```
profile.{ghii}.interests       → ["lintubongaus", "retro-pelit", ...]
profile.{ghii}.location        → {"country": "FI", "city": "Espoo", "area": "Tapiola", "geo": [60.175, 24.805]}
profile.{ghii}.bio             → "Teknologiasta kiinnostunut luontoharrastaja"
profile.{ghii}.availability    → "evenings-weekends"
profile.{ghii}.seeking         → ["samanhenkiset harrastajat"]
```

**JSON Schema (open mode):**
```json
{
  "type": "object",
  "required": ["interests"],
  "properties": {
    "interests": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "location": { "type": "object", "properties": { "city": { "type": "string" } } },
    "bio": { "type": "string", "maxLength": 500 }
  },
  "additionalProperties": true
}
```

### 0.5 OTP/TOTP-tuki

**Mitä:** Toteutetaan `docs/research/otp-totp-integraatio.md` -tutkimuksen mukaisesti.

**Tekniset vaatimukset:**
- Dependency: `otpauth` + `qrcode`
- Storage-laajennukset: `totpSecret`, `totpEnabled`, `totpBackupCodes` GHIIRecord/OwnerRecordiin
- Uudet endpointit:
  - `POST /v1/auth/totp/setup` — generoi secret + QR-koodi
  - `POST /v1/auth/totp/verify` — vahvista TOTP-koodi
  - `DELETE /v1/auth/totp` — poista TOTP käytöstä
- Kirjautumismuutokset: JWT-login + optional TOTP-steppi
- Turvallisuus: AES-256-GCM salakirjoitus at rest, rate limiting, backup-koodit

### 0.6 DMZ-arkkitehtuurin formalisointi

**Mitä:** Dokumentoidaan ja formalisoidaan DMZ-konsepti osaksi consent- ja visibility-mallia.

**Deliverable:** `docs/aimeat-dmz-architecture.md` — yhdistää:
- `docs/nextlevel/aimeat-dmz-concept.md` (konsepti)
- Phase 0.3 consent layer (implementaatio)
- Memory visibility (private/federation/public)
- Personal node security model

---

## Phase 1: "Ensimmäinen yhteisö" (vertical slice + infraa)

> Tavoite: harrastehakemisto end-to-end + ihmiskerroksen infra. Erkki-polun avaaminen.

### 1.1 Email-järjestelmä

**Tekniset vaatimukset:**
- Dependency: `nodemailer`
- .env-laajennukset:
  - `AIMEAT_SMTP_HOST`, `AIMEAT_SMTP_PORT`, `AIMEAT_SMTP_USER`, `AIMEAT_SMTP_PASS`, `AIMEAT_SMTP_FROM`
  - `AIMEAT_REQUIRE_EMAIL_CONFIRMATION` (true/false) — operaattori päättää
  - `AIMEAT_EMAIL_CONFIRMATION_REQUIRED` (true/false) — vaatiiko vahvistuksen
- Email-service: `src/services/email.ts`
  - sendVerification(to, token)
  - sendMagicLink(to, loginUrl)
  - sendNotification(to, subject, body)
  - sendMatchSuggestion(to, matches)
- Template-engine: HTML + plain text fallback
- Konfiguraatio-tarkistus: jos SMTP ei konfiguroitu → email-ominaisuudet disabled, varoitus logiin

### 1.2 Web-wizard (node setup)

- Konfiguraatiomoodi: kun `/data/config.json` puuttuu → Express servaa wizard-UI:n
- Wizard-flow (5 askelta):
  1. Tervetuloa + kieli
  2. Node-nimi + tyyppi (personal/full)
  3. GHII-identiteetti (luonti tai import)
  4. Ankkurioperaattori (valinta listalta tai custom URL)
  5. Yhteenveto + käynnistys
- Wizard kirjoittaa `config.json` + `.env` → uudelleenkäynnistys normaali-moodiin

### 1.3 GHII-rekisteröinti + tietolompakko-näkymä portaalissa

**Rekisteröinti (Erkki-polku):**
- Web-lomake: nimi/nimimerkki, sähköposti, paikkakunta, kiinnostukset (monivalinta)
- GHII Tier 1 luonti
- Email-vahvistus (jos operaattori vaatii)
- Magic link -kirjautuminen TAI TOTP

**Tietolompakko-näkymä:**
- Portaalin "Tietolompakkoni" -sivu
- Näyttää kaikki aktiiviset suostumukset: mitä jaettu, kenelle, millä ehdoilla
- Peru-nappi joka suostumukselle
- Auditointiraportti: kuka on käyttänyt dataasi
- Vie kaikki tiedot -nappi (GDPR export)

### 1.4 Hakemistot (paikallinen + temaattinen)

- Uusi endpoint: `GET /v1/catalogue/directory`
  - Query: `?city=Espoo&interest=lintubongaus&radius_km=10`
  - Indeksointi `profile.*.location` + `profile.*.interests` -kentistä
- Paikallinen hakemisto: "Espoossa 15 jäsentä, 3 ryhmää"
- Temaattinen hakemisto: "Lintubongaus: 28 jäsentä, 5 ryhmää"
- Portaali-UI: selaa hakemistoja, klikkaa → näe profiilit ja ryhmät

### 1.5 Tiedon laatusuodatus — pohja

- Data Description Convention -kenttien huomiointi endpointeissa
- Uusi endpoint: `POST /v1/memory/{key}/flag`
  - Syy: `unreliable`, `inappropriate`, `illegal`, `spam`
  - Yksi flag per käyttäjä per avain (ei duplikaatteja)
- `GET /v1/memory/{key}/flags` — flagien yhteenveto
- Flag-counter memory-metadataan
- Vastaanottajan suodatin: `?max_flags=0` memory-haussa

### 1.6 Vertical Slice: Harrastehakemisto

**Ensimmäinen CSM-pohjainen palvelu:**
- `hobby-directory.csm.yaml` kuvaa palvelun
- Portaali-UI:
  - Selaa harrastuksia kategorioittain
  - Katso läheiset (maantieteellinen haku)
  - Ilmoittaudu kiinnostuneeksi (→ luo kiinnostusprofiili + consent)
  - Näe muut kiinnostuneet (→ profiilit joilla matching consent)
- Email-ilmoitus: "Tapiolassa 2 muuta kiinnostunut lintubongauksesta"
- **Yhdistää:** profiilit (0.4) + schemat (0.1) + consent (0.3) + hakemistot (1.4) + email (1.1)

---

## Phase 2: "Markkinapaikka + yhteisötyökalut" (vertical slice + infraa)

> Tavoite: toimiva markkinapaikka + organismit + yhteistyövälineet.

### 2.1 AI-matchaus-agentti

- Federation-agentti: lukee `federation`-profiileja
- Vertailee kiinnostuksia + maantieteellistä läheisyyttä
- Opt-in suositteluviestit (email tai mailbox)
- Operaattori-konfiguraatio: `AIMEAT_MATCHING_ENABLED` (true/false)
- Matchaus-algoritmi: shared interests count × distance weighting × activity recency

### 2.2 Organismi/ryhmä-entiteetti

- Uusi record-tyyppi: `OrganismRecord`
  - nimi, kuvaus, tyyppi, sijainti, kiinnostukset
  - jäsenlista, board-linkki, liittymispolitiikka (open/approval_required)
  - hakemistomerkintä (paikallinen + temaattinen)
- Endpointit:
  - `POST /v1/organisms` — luo organismi
  - `GET /v1/organisms` — haku + listaus
  - `GET /v1/organisms/{id}` — yksittäinen
  - `POST /v1/organisms/{id}/join` — liity
  - `POST /v1/organisms/{id}/leave` — poistu
  - `DELETE /v1/organisms/{id}` — poista (vain perustaja/admin)

### 2.3 Collaborative workspaces

- Shared memory spaces: organismi-jäsenet kirjoittavat yhteiseen namespaceen
- Pääsynhallinta: organism-jäsenyys + consent-pohjainen
- Memory-namespace: `organism.{id}.shared.*`
- AI-agentit voivat osallistua organismin työhön (consent-ohjattu)

### 2.4 Laatusuodatus — advanced

- Moderointityökalut: organismi-admin tai operaattori käsittelee flageja
- Appeals-mekanismi: flagatun sisällön omistaja voi valittaa
- Auto-hide: kun flag-kynnys ylittyy → piilota automaattisesti (konfiguroitava per organismi)
- Optionaalisesti enabloitavissa per organismi/board: `moderation.auto_hide_enabled: true`

### 2.5 CSM-templatekirjasto

Valmiit CSM-pohjat eri palvelutyypeille:

| Template | Tyyppi | Data | Erityispiirteet |
|---|---|---|---|
| `marketplace.csm.yaml` | marketplace | ilmoitukset, hinnat, kategoriat | morsel-transaktiot, myyjä-arviot |
| `dating-directory.csm.yaml` | dating | profiilit, kiinnostukset | arkaluonteinen data, vahva consent, anonyymi matchaus |
| `news-feed.csm.yaml` | news | artikkelit, lähteet, kategoriat | freshness-scoring, source credibility |
| `opinion-board.csm.yaml` | opinion | mielipiteet, äänet, kommentit | moderointi, flaggaus, anonyymi optio |
| `auction.csm.yaml` | auction | tuotteet, tarjoukset, aikataulu | aikarajat, morsel-escrow |
| `video-directory.csm.yaml` | media | videot, kategoriat, arviot | embeds, thumbnail, koko-rajoitukset |

Jokainen template sisältää: data schema (open/strict), consent requirements, UI hints, moderation defaults.

### 2.6 Vertical Slice: Markkinapaikka

- `marketplace.csm.yaml` kuvaa palvelun
- Myynti-ilmoitukset memory-avaimina (myyjän nodessa)
- Haku, suodatus, kategorisointi catalogue-endpointin kautta
- Morsel-pohjaiset transaktiot (ostaja → myyjä)
- Arviot ja luottamuspisteet
- **Yhdistää:** CSM (0.2) + schemat (0.1) + consent (0.3) + organismit (2.2) + flaggaus (1.5)

---

## Phase 3: Polish + tulevaisuus

> Viimeistely, standardit, skaalaus.

### 3.1 Mobiilisovellus (PWA)
- Progressive Web App — ei native
- Portaalin responsiivinen versio + push-ilmoitukset (Web Push API)
- Offline-tuki: paikallinen cache, sync kun online
- Service worker: background sync, offline reading

### 3.2 Graafinen personal node -asennusohjelma
- Electron tai Tauri -pohjainen desktop-sovellus
- One-click install → wizard (Phase 1.2) integroituna
- Sisäänrakennettu LM Studio / Ollama -yhdistäminen
- System tray: näe noden status, morselit, ilmoitukset

### 3.3 EUDIW / MyData / W3C VC -integraatiot
- GHII Tier 3: OpenID4VP-presentaatioiden vastaanotto EU:n lompakosta
- SD-JWT-todistusten validointi
- MyData consent receipt -mallin integraatio audit trailiin
- W3C Verifiable Credentials -pohjainen attestation GHII:lle
- Suomen luottamusverkko (FTN) -yhteensopivuus

### 3.4 Advanced federation
- Cross-federation discovery (useamman genesis-noden välillä)
- Reputation-järjestelmä organismeille
- CSM-palveluiden automaattinen federation-jakelu
- Cross-node matchaus-agentti (matchaa profiileja eri nodejen välillä)

---

## Traceability: tutkimussuositukset → masterplan

### Dokumentti 1 (Soluuntuminen) suositukset

| Suositus | Alkuperäinen prio | Masterplan-sijainti | Muutos |
|---|---|---|---|
| Standardoitu kiinnostusprofiili | P0 | Phase 0.4 | — |
| Web-portaalin rekisteröityminen | P0 | Phase 1.3 | P0→P1 (tarvitsee email-infran) |
| Paikallinen + temaattinen hakemisto | P1 | Phase 1.4 | — |
| AI-matchaus-agentti | P1 | Phase 2.1 | P1→P2 (tarvitsee hakemistot + profiilit ensin) |
| Ryhmä/organismi-entiteetti | P2 | Phase 2.2 | — |
| Sähköposti/push-ilmoitukset | P2 | Phase 1.1 | P2→P1 (email on perustaa wizardille + rekisteröitymiselle) |
| Mobiilisovellus | P3 | Phase 3.1 | — |
| Graafinen personal node -asennus | P3 | Phase 3.2 | — |

### Dokumentti 2 (BBS→AI) suositukset

| Suositus | Alkuperäinen prio | Masterplan-sijainti | Muutos |
|---|---|---|---|
| Consent-profiili memoryssä | P0 | Phase 0.3 | — |
| Audit trail -endpoint | P0 | Phase 0.3 | — |
| Per-vastaanottaja + aikaperusteinen consent | P1 | Phase 0.3 | P1→P0 (osa consent-profiili-schemaa) |
| Tietolompakko-näkymä portaalissa | P1 | Phase 1.3 | — |
| MyData consent receipt -integraatio | P2 | Phase 3.3 | P2→P3 (ulkoinen standardi-integraatio) |
| EUDIW-yhteensopiva GHII Tier 3 | P2 | Phase 3.3 | P2→P3 (ulkoinen standardi-integraatio) |
| W3C VC -attestation GHII:lle | P3 | Phase 3.3 | — |

### Lisäykset (jounis_ideas.md + brainstorming)

| Lisäys | Masterplan-sijainti | Lähde |
|---|---|---|
| JSON Schema Locking implementaatio | Phase 0.1 | Olemassaoleva speksi + YAML-joustavuus-idea |
| CSM (Community Service Manifest) | Phase 0.2 | Erillinen formaatti community-palveluille |
| OTP/TOTP-tuki | Phase 0.5 | Olemassaoleva tutkimus |
| DMZ-formalisointi | Phase 0.6 | Olemassaoleva konseptidokumentti |
| Web-wizard | Phase 1.2 | jounis_ideas: "miksei wizard CLI:n sijasta" |
| Tiedon laatusuodatus | Phase 1.5 + 2.4 | jounis_ideas: data quality filtering |
| CSM-templatekirjasto | Phase 2.5 | jounis_ideas: marketplace, dating, news, auction... |
| Collaborative workspaces | Phase 2.3 | jounis_ideas: shared memory spaces |

---

## Riippuvuuskaavio

```
Phase 0 (lineaarinen):
  0.1 Schema Locking ──→ 0.2 CSM (tarvitsee schemoja)
  0.3 Consent Layer  ──→ 0.4 Profiilit (tarvitsee consentia)
  0.5 OTP/TOTP       ──→ (riippumaton)
  0.6 DMZ-formalisointi ──→ (riippuu 0.3:sta)

Phase 1 (vertical slice: harrastehakemisto):
  1.1 Email         ──→ 1.3 Rekisteröinti (tarvitsee emailia)
  1.2 Wizard        ──→ (riippuu koko Phase 0:sta)
  1.4 Hakemistot    ──→ 1.6 Harrastehakemisto (tarvitsee hakemistoja)
  1.5 Flaggaus      ──→ 1.6 Harrastehakemisto (tarvitsee flaggausta)
  1.6 = yhdistää kaikki yllä

Phase 2 (vertical slice: markkinapaikka):
  2.1 AI-matchaus   ──→ 2.6 Marketplace (tarvitsee matchausta)
  2.2 Organismit    ──→ 2.3 Workspaces (tarvitsee organismeja)
  2.5 CSM-templates ──→ 2.6 Marketplace (tarvitsee templateja)
  2.6 = yhdistää kaikki yllä

Phase 3: kaikki riippuu Phase 0-2:sta
```

---

## Kieli ja tyyli

- **Masterplan:** Suomi
- **Tekniset speksit (CSM, endpointit):** Englanti (koodiin liittyvät)
- **Portaali-UI:** Suomi + englanti (i18n olemassa)

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
