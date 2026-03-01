# Phase 0.8: Dokumentaation ylläpitosuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

---

### 0.8.1 Tavoite

Määritellä kaikki dokumentit ja artefaktit joita Phase 0 -muutokset edellyttävät päivitettäväksi. Tämä varmistaa, ettei yksikään dokumentti jää päivittämättä implementoinnin yhteydessä.

### 0.8.2 Dokumenttikartta

#### A. Protokolladokumentaatio (RFC / Core)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/01-core.md` | 0.1, 0.3, 0.7 | +Schema Locking -osio, +Consent Layer -perusteet, +Semantic-viittaus |
| `docs/02-identity.md` | 0.5 | +TOTP-tuki GHII-identiteetissä, +MFA-osio |
| `docs/03-economy.md` | — | Ei muutoksia Phase 0:ssa |
| `docs/04-trust.md` | 0.3 | +Consent ja audit trail -viittaus |
| `docs/05-federation.md` | 0.3, 0.6 | +DMZ-arkkitehtuuri, +consent-ohjattu datan jakaminen |
| `docs/06-actions.md` | 0.7 | +Semantic-annotaatiot action-kuvauksissa |
| `docs/07-boards.md` | 0.7 | +Semantic-tyypitys board-viesteissä |
| `docs/08-personal-node.md` | 0.6 | +DMZ-vyöhykkeet personal nodessa |
| `docs/09-community.md` | 0.2, 0.7 | +CSM-viittaus, +semantic-tyypitys yhteisöpalveluissa |

#### B. Pilaridokumentaatio (nextlevel/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/nextlevel/aimeat-json-schema-locking.md` | 0.1 | Päivitys vastaamaan toteutettua versiota (wildcard patterns, semantic) |
| `docs/nextlevel/aimeat-data-description-convention.md` | 0.7 | +§3.6 Semantic (Ontology) |
| `docs/nextlevel/aimeat-dmz-concept.md` | 0.6 | Päivitys linkittämään DMZ-arkkitehtuuridokumenttiin |
| `docs/nextlevel/aimeat-personal-node-spec.md` | 0.5, 0.6 | +TOTP-setup personal nodessa, +DMZ-vyöhykkeet |
| `docs/research/otp-totp-integraatio.md` | 0.5 | Merkkaus "implementoitu" + viittaus toteutukseen |

#### C. Uudet dokumentit (luodaan Phase 0:ssa)

| Dokumentti | Komponentti | Luonti |
|---|---|---|
| `docs/csm-spec.md` | 0.2 | CSM-spesifikaatio |
| `docs/csm-examples/*.csm.yaml` (7 kpl) | 0.2 | CSM-esimerkit |
| `docs/aimeat-interest-profile-spec.md` | 0.4 | Kiinnostusprofiili-spesifikaatio |
| `docs/aimeat-dmz-architecture.md` | 0.6 | DMZ-arkkitehtuuridokumentti |

#### D. API-spesifikaatio

| Tiedosto | Muutokset |
|---|---|
| `openapi.yaml` | +17 uutta endpointia (schema 4, CSM 4, consent 5, TOTP 4) |
| | +Uudet request/response schemat jokaiselle endpointille |
| | +Error-koodit (SCHEMA_VALIDATION_FAILED, CONSENT_DENIED, TOTP_ALREADY_ENABLED, jne.) |
| | +Security schemes (Bearer JWT laajennukset) |

**TÄRKEÄÄ:** `openapi.yaml` on kanoninen API-sopimus josta generoidaan:
- TypeScript-tyypit (client SDK)
- API-dokumentaatio (Swagger UI / Redoc)
- Mahdolliset client-kirjastot

Jokainen uusi endpoint PITÄÄ lisätä `openapi.yaml`:iin ennen kuin implementaatio katsotaan valmiiksi.

#### E. Projektin juuridokumentit

| Tiedosto | Muutokset |
|---|---|
| `README.md` | +Phase 0 -komponenttien maininta, +uudet ympäristömuuttujat |
| `aimeat/.env.example` | +10 uutta ympäristömuuttujaa (consent, TOTP) |
| `CLAUDE.md` | +Uudet route-tiedostot, +uudet service-tiedostot, +uudet testifaasit |

#### F. Masterplan ja Phase-dokumentit

| Tiedosto | Muutokset |
|---|---|
| `docs/plans/2026-03-01-cellularization-masterplan-design.md` | +Phase 0 status päivitys, +ontologia-viittaus |
| Phase 1-3 dokumentit (tulevat) | +Viittaukset Phase 0:n tuottamiin rajapintoihin |

### 0.8.3 Päivitysjärjestys

Dokumenttien päivitysjärjestys seuraa implementointijärjestystä:

```
1. openapi.yaml           ← Ensin API-sopimus (contract-first)
2. Uudet spesifikaatiot   ← csm-spec.md, interest-profile-spec.md, dmz-architecture.md
3. .env.example           ← Ympäristömuuttujat
4. RFC/Core-dokumentit    ← 01-core.md ... 09-community.md (vain viittaukset)
5. Pilaridokumentit       ← nextlevel/ (päivitykset vastaamaan toteutusta)
6. README.md              ← Projektikuvaus
7. CLAUDE.md              ← AI-assistentin ohjeet
8. Masterplan             ← Status-päivitys
```

### 0.8.4 Dokumentaation Definition of Done

Jokaisen Phase 0 -komponentin implementoinnin yhteydessä:

- [ ] `openapi.yaml` päivitetty uusilla endpointeilla
- [ ] Komponentin oma spesifikaatio luotu/päivitetty
- [ ] `.env.example` päivitetty uusilla ympäristömuuttujilla
- [ ] Vaikuttavat RFC-dokumentit päivitetty (vähintään viittaukset)
- [ ] `CLAUDE.md` päivitetty uusilla tiedostoilla ja komennoilla
- [ ] TypeScript-tyypitykset vastaavat `openapi.yaml`:a

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
