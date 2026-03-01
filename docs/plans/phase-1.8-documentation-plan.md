# Phase 1.8: Dokumentaation ylläpito — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

> Lähde: Phase 0.8 (dokumentaation ylläpitosuunnitelma)

### 1.8.1 Tavoite

Päivittää kaikki olemassaolevat dokumentit Phase 1 -muutosten mukaisesti.

### 1.8.2 Dokumenttikartta

#### A. Protokolladokumentaatio (docs/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/01-core.md` | 1.5 (flaggaus) | Flagging-mekanismi lisätään data quality -osioon |
| `docs/03-boards.md` | 1.5 (flaggaus) | Flagging mahdollisuus board-posteille |
| `docs/05-federation.md` | 1.4 (hakemistot) | Directory-haku federaation kautta |
| `docs/08-human-layer.md` | 1.1, 1.3 (email, rekisteröinti) | Email-vahvistus, magic link, tietolompakko |
| `docs/09-community.md` | 1.6 (harrastehakemisto) | Ensimmäinen CSM-palvelu esimerkkinä |

#### B. Pilaridokumentaatio (docs/nextlevel/)

| Dokumentti | Vaikuttavat komponentit | Tarvittavat muutokset |
|---|---|---|
| `docs/nextlevel/aimeat-personal-node-spec.md` | 1.2 (wizard) | Web-wizard -viittaus |
| `docs/nextlevel/aimeat-data-description-convention.md` | 1.5 (flaggaus) | Flag-mekanismi maininta |
| `docs/ghii-identity-and-network-plan.md` | 1.3 (rekisteröinti) | Web-rekisteröinti, email-vahvistus, magic link |

#### C. Uudet dokumentit

| Dokumentti | Komponentti |
|---|---|
| `docs/csm-spec.md` | 0.2 CSM (jos ei vielä luotu Phase 0:ssa) |
| `docs/csm-examples/hobby-directory.csm.yaml` | 1.6 Harrastehakemisto |

#### D. API-spesifikaatio

**`openapi.yaml`** — Phase 1:n uudet endpointit:

| Endpoint | Komponentti | Tyyppi |
|---|---|---|
| `POST /v1/ghii/register-web` | 1.3 | Uusi |
| `POST /v1/ghii/verify-email` | 1.3 | Uusi |
| `POST /v1/ghii/magic-link` | 1.3 | Uusi |
| `GET /v1/ghii/magic-link/verify` | 1.3 | Uusi |
| `GET /v1/catalogue/directory` | 1.4 | Uusi |
| `GET /v1/catalogue/directory/stats` | 1.4 | Uusi |
| `POST /v1/flags` | 1.5 | Uusi |
| `GET /v1/flags/summary/:type/:id` | 1.5 | Uusi |
| `GET /v1/flags` | 1.5 | Uusi (operator) |
| `PUT /v1/flags/:id` | 1.5 | Uusi (operator) |
| `GET /setup` | 1.2 | Uusi |
| `POST /setup/step/:n` | 1.2 | Uusi |
| `POST /setup/complete` | 1.2 | Uusi |
| `GET /v1/portal/human/wallet` | 1.3 | Uusi |
| `GET /v1/portal/human/hobbies` | 1.6 | Uusi |

**Yhteensä: 15 uutta endpointia.**

**Uusi error code:** `ALREADY_FLAGGED`, `EMAIL_UNAVAILABLE`

#### E. Projektin juuridokumentit

| Dokumentti | Muutokset |
|---|---|
| `README.md` | Phase 1 -ominaisuudet |
| `.env.example` | SMTP, SETUP, MATCH_NOTIFICATION -muuttujat |
| `CLAUDE.md` | Email-service pattern, wizard-arkkitehtuuri |

### 1.8.3 Päivitysjärjestys

1. `openapi.yaml` — Contract-first (15 uutta endpointia)
2. `src/storage/interface.ts` — Record-tyypit
3. `src/config.ts` — Konfiguraatio
4. Route- ja service-tiedostot
5. Speksidokumentit (docs/*.md)
6. `.env.example`
7. `CLAUDE.md`
8. `README.md`

### 1.8.4 Dokumentaation Definition of Done

- [ ] `openapi.yaml` päivitetty 15 uudella endpointilla
- [ ] Jokainen uusi endpoint dokumentoitu (request/response esimerkit)
- [ ] `.env.example` päivitetty kaikilla uusilla ympäristömuuttujilla
- [ ] `CLAUDE.md` päivitetty Phase 1 -konventioilla
- [ ] Speksidokumentit viittaavat Phase 1 -ominaisuuksiin

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
