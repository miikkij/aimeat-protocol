# Phase 1.7: Semanttinen ontologia (Phase 1) — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

> Lähde: Phase 0.7 (ontologia), Phase 0.7b (retrofit), `docs/nextlevel/aimeat-data-description-convention.md`

### 1.7.1 Tavoite

Varmistaa, että kaikki Phase 1:n uudet record-tyypit ja endpointit tukevat Phase 0.7:ssä määriteltyä semanttista ontologiaa. Kaikki uudet rakenteet saavat valinnaisen `semantic?`-kentän.

### 1.7.2 Phase 1 -rakenteiden semanttiset annotaatiot

#### EmailVerificationRecord — ei tarvitse semanttista annotaatiota

Sisäinen tekninen record, ei jaeta federaatiossa eikä katalogissa.

#### FlagRecord

```typescript
// Ei tarvitse semanttista annotaatiota
// Sisäinen moderointityökalu, ei julkista dataa
```

#### DirectoryEntry (hakemiston tuloste)

```json
{
  "semantic": {
    "@context": {
      "schema": "https://schema.org/"
    },
    "@type": "schema:Person",
    "schema:knowsAbout": ["lintubongaus", "puutarhanhoito"],
    "schema:homeLocation": {
      "@type": "schema:Place",
      "schema:address": {
        "@type": "schema:PostalAddress",
        "schema:addressLocality": "Espoo",
        "schema:addressRegion": "Uusimaa",
        "schema:addressCountry": "FI"
      }
    }
  }
}
```

#### CSM-palvelukuvaus (harrastehakemisto)

```json
{
  "semantic": {
    "@context": {
      "schema": "https://schema.org/"
    },
    "@type": "schema:WebApplication",
    "schema:applicationCategory": "DirectoryService",
    "schema:audience": {
      "@type": "schema:PeopleAudience",
      "schema:suggestedAge": "16+"
    }
  }
}
```

#### Match-ilmoitus (email-konteksti)

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Message",
    "schema:about": "community-discovery-match",
    "schema:sender": "match-agent@aimeat-finland-001"
  }
}
```

### 1.7.3 Vaikutus endpointeihin

| Endpoint | Semantic-kenttä | Ontologia |
|---|---|---|
| `GET /v1/catalogue/directory` | Valinnainen `semantic` per DirectoryEntry | schema:Person + schema:Place |
| `GET /v1/catalogue/directory/stats` | Ei tarvita | — |
| `POST /v1/flags` | Ei tarvita | — |
| `GET /v1/flags/summary` | Ei tarvita | — |
| Portal-sivut | HTML-metatiedot | schema.org microdata |

### 1.7.4 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Directory-haku palauttaa semantic-kentän | Oikea @context ja @type |
| 2 | Directory-haku ilman semanttista annotaatiota | Toimii normaalisti (valinnainen) |
| 3 | CSM-parsinta säilyttää semantic-kentän | Semantic passthrough |

### 1.7.5 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `src/services/directory.ts` — Semantic-annotaatio DirectoryEntryyn |
| **Muokataan** | `openapi.yaml` — DirectoryEntry-schema + semantic |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
