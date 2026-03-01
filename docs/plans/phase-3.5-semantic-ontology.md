# 3.5 Semanttinen ontologia (Phase 3 -rakenteet)

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

---

### 3.5.1 Phase 3 -rakenteiden semanttiset annotaatiot

#### PushSubscriptionRecord — ei tarvita

Sisäinen tekninen record.

#### GenesisPeerRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Organization",
    "schema:memberOf": "aimeat:CrossFederation"
  }
}
```

#### OrganismReputationRecord

```json
{
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Rating",
    "schema:ratingValue": 78,
    "schema:bestRating": 100,
    "schema:worstRating": 0
  }
}
```

#### W3C Verifiable Credential (AIMEAT-myönnetty)

Noudattaa W3C VC v2.0 -rakennetta — semanttinen annotaatio on sisäänrakennettu standardiin (`@context`, `type`, `credentialSubject`).

### 3.5.2 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Genesis-peer response sisältää semantic | schema:Organization |
| 2 | Reputation response sisältää semantic | schema:Rating |
| 3 | VC noudattaa W3C VC v2.0 -rakennetta | Validointityökalun läpi |

---

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
