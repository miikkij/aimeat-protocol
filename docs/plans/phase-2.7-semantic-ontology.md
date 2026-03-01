# Phase 2.7: Semanttinen ontologia (Phase 2) — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

---

## 2.7 Semanttinen ontologia (Phase 2 -rakenteet)

> Lähde: Phase 0.7

### 2.7.1 Phase 2 -rakenteiden semanttiset annotaatiot

#### OrganismRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Organization",
    "schema:memberOf": "aimeat:Federation",
    "schema:areaServed": {
      "@type": "schema:Place",
      "schema:address": { "@type": "schema:PostalAddress", "schema:addressLocality": "Espoo" }
    }
  }
}
```

#### MatchRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:RecommendAction",
    "schema:instrument": "aimeat:MatchingEngine",
    "schema:object": { "@type": "schema:Person" }
  }
}
```

#### Marketplace Listing

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Offer",
    "schema:priceCurrency": "MORSEL",
    "schema:availability": "schema:InStock",
    "schema:seller": { "@type": "schema:Person" }
  }
}
```

### 2.7.2 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Organism-response sisältää semantic-kentän | schema:Organization |
| 2 | Marketplace listing sisältää semantic | schema:Offer |
| 3 | Match-response sisältää semantic | schema:RecommendAction |

### 2.7.3 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Muokataan** | `src/routes/organisms.ts` — Semantic-annotaatiot |
| **Muokataan** | `src/routes/marketplace.ts` — Semantic-annotaatiot |
| **Muokataan** | `src/routes/matches.ts` — Semantic-annotaatiot |
| **Muokataan** | `openapi.yaml` — Semantic-schemat |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
