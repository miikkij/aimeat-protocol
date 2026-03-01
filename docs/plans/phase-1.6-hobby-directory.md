# Phase 1.6: Harrastehakemisto (Vertical Slice) — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

## 1.6 Vertical Slice: Harrastehakemisto

> Lähde: masterplan (§1.6)

### 1.6.1 Tavoite

Rakentaa ensimmäinen kokonainen CSM-pohjainen palvelu: **harrastehakemisto**. Tämä on AIMEAT:n "Hello World" — todiste siitä, että protokolla tuottaa oikeaa arvoa oikeille ihmisille.

**Harrastehakemisto yhdistää:**
- Phase 0.1: Schema Locking (profiilien validointi)
- Phase 0.2: CSM (palvelukuvaus)
- Phase 0.3: Consent Layer (datan jakamisen hallinta)
- Phase 0.4: Kiinnostusprofiilit (standardoitu profiilidata)
- Phase 0.7: Semanttinen ontologia (schema.org-annotaatiot)
- Phase 1.1: Email (ilmoitukset)
- Phase 1.3: GHII-rekisteröinti (Erkki-polku)
- Phase 1.4: Hakemistot (maantieteellinen + temaattinen haku)
- Phase 1.5: Flaggaus (sisällön laatu)

### 1.6.2 CSM-kuvaus

**Tiedosto:** `docs/csm-examples/hobby-directory.csm.yaml`

```yaml
csm: "1.0"
service:
  name: "Harrastehakemisto"
  type: "directory"
  description: "Löydä harrastuksia ja samanhenkisiä ihmisiä läheltäsi"
  locale: "fi"

schema_mode: "open"

data_schema:
  required:
    interests:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string, default: "FI" }
      required: [city]
  optional:
    bio: { type: string, maxLength: 500 }
    availability: { type: string, enum: ["anytime", "mornings", "evenings", "weekends", "evenings-weekends"] }
    seeking: { type: array, items: { type: string } }

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["displayName", "interests", "location.city"]
  detail_view: ["displayName", "bio", "interests", "location", "availability", "seeking"]
  search_fields: ["interests", "location.city", "location.area"]
```

### 1.6.3 Portaali-UI

**Harrastehakemiston portaali-sivut:**

| Sivu | Polku | Kuvaus |
|---|---|---|
| Etusivu | `/v1/portal/human/hobbies` | Selaa harrastuksia kategorioittain |
| Haku | `/v1/portal/human/hobbies/search` | Hae kiinnostuksen + sijainnin perusteella |
| Profiili | `/v1/portal/human/hobbies/profile/:ghii` | Näe toisen harrastajan profiili |
| Ilmoittaudu | `/v1/portal/human/hobbies/join` | Luo oma profiili + consent |
| Omat tiedot | `/v1/portal/human/hobbies/me` | Muokkaa profiilia, näe ketkä näkee |

**UI-toteutus:** Server-rendered HTML (kuten portal-human.ts). Ei SPA-frameworkia.

### 1.6.4 Toimintalogiikka

#### Erkki-polku (end-to-end):

```
1. Erkki avaa portaalin → /v1/portal/human
       ↓
2. "Rekisteröidy" → /v1/portal/human/register (Phase 1.3)
   - Syöttää: Erkki, erkki@email.fi, Espoo/Tapiola, [lintubongaus, puutarhanhoito]
       ↓
3. Saa vahvistussähköpostin → vahvistaa → Level 1
       ↓
4. Ohjataan harrastehakemistoon → /v1/portal/human/hobbies
       ↓
5. Näkee: "Tapiolassa 3 muuta lintubongaajaa"
       ↓
6. Klikkaa profiilia → näkee Antin profiilin (consent sallii)
       ↓
7. Saa sähköpostin: "Tapiolassa 2 uutta lintubongaajaa tällä viikolla"
```

#### Email-ilmoitukset

**Uusi background-job:** `matchNotificationJob`

Logiikka:
1. Käy läpi hakemiston indeksi
2. Etsi profiilit joilla on uusia matcheja (edellisen ajokierroksen jälkeen lisättyjä)
3. Jos matcheja löytyy JA käyttäjällä on emailHash + consent ilmoituksiin → lähetä email
4. `sendMatchSuggestion()` (Phase 1.1 EmailService)

**Konfiguraatio:**
```env
# AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS=24    # Kuinka usein tarkistetaan
# AIMEAT_MATCH_NOTIFICATION_ENABLED=true          # Operaattori voi disabloida
```

### 1.6.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | CSM-tiedoston parsinta → schema luotu | Oikeat validoinnit |
| 2 | Rekisteröityminen → profiili näkyy hakemistossa | Erkki löytyy hakemistosta |
| 3 | Haku: city=Espoo, interest=lintubongaus | Erkki löytyy |
| 4 | Profiili näkyy vain consentilla | Ilman consentia ei löydy |
| 5 | Consent peruttu → profiili poistuu hakemistosta | Ei löydy |
| 6 | Flaggaus → auto-hide 5 flagilla | Profiili piilossa |
| 7 | Email-ilmoitus uusista matcheista | Email lähetetty (mocked) |
| 8 | End-to-end: rekisteröinti → haku → profiili → match-email | Koko polku toimii |

### 1.6.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/csm-examples/hobby-directory.csm.yaml` — CSM-kuvaus |
| **Uusi** | `src/routes/portal-hobbies.ts` — Harrastehakemiston portaali |
| **Uusi** | `src/services/match-notification.ts` — Match-ilmoitus-job |
| **Muokataan** | `src/routes/portal-human.ts` — Linkki harrastehakemistoon |
| **Muokataan** | `src/server.ts` — portal-hobbies mount, notification-job |
| **Muokataan** | `src/config.ts` — matchNotificationIntervalHours, matchNotificationEnabled |
| **Muokataan** | `.env.example` — MATCH_NOTIFICATION -muuttujat |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
