# Phase 2.6: Markkinapaikka (Vertical Slice) — Implementointisuunnitelma

*Osa Phase 2 "Markkinapaikka + yhteisötyökalut" -kokonaisuutta. Ks. [Phase 2 yleiskatsaus](./phase-2-marketplace-community.md)*

---

## 2.6 Vertical Slice: Markkinapaikka

> Lähde: masterplan (§2.6)

### 2.6.1 Tavoite

Rakentaa toinen kokonainen end-to-end CSM-palvelu: **markkinapaikka**. Markkinapaikka yhdistää kaikki Phase 2 -komponentit yhdeksi kokonaisuudeksi. Myyjät listaavat tuotteita ja palveluita, ostajat hakevat ja ostavat morselipohjaisesti, organismit toimivat kauppayhteisöinä.

### 2.6.2 Markkinapaikan arkkitehtuuri

```
Myyjä (personal node tai agentti):
  ├── Luo ilmoitus (memory-avain: marketplace.{seller}.listing.{id})
  ├── Schema-validointi (marketplace.csm.yaml)
  ├── Consent: marketplace-purpose, federation-scope
  └── Listing-fee: 2 morseliä

Ostaja (portaali tai agentti):
  ├── Hae ilmoituksia (catalogue/directory)
  ├── Katso tiedot (read listing memory key)
  ├── Osta → morsel-transaktio (escrow → settlement)
  └── Arvioi kauppa (rating)

Federaatio:
  ├── Ilmoitukset synkataan catalogue-sync:llä
  ├── Cross-node kauppa: +1 morsel routing fee
  └── Trust-pisteet vaikuttavat näkyvyyteen
```

### 2.6.3 Uudet endpointit

#### POST /v1/marketplace/listings

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/listings` |
| **Auth** | Vaatii JWT |
| **Content-Type** | application/json |

**Request body:**
```json
{
  "title": "TypeScript-koodausapua 2h",
  "description": "Kokenut full-stack kehittäjä tarjoaa TypeScript-koodausapua. Express, React, Node.js.",
  "category": "palvelut",
  "price_morsels": 50,
  "condition": "digital",
  "availability": "on_request",
  "location": { "city": "Espoo" },
  "tags": ["typescript", "nodejs", "koodaus"]
}
```

**Logiikka:**
1. Validoi marketplace.csm.yaml -scheman mukaan
2. Veloita listing_fee (2 morseliä)
3. Tallenna memory-avaimeen: `marketplace.{owner}.listing.{uuid}`
4. Luo consent: `scope: federation`, `purpose: marketplace`
5. Ilmoitus näkyy hakemistossa ja cataloguessa

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "listingId": "listing-uuid",
    "memoryKey": "marketplace.jouni.listing.listing-uuid",
    "listingFee": 2,
    "status": "active"
  }
}
```

#### GET /v1/marketplace/listings

| Kenttä | Arvo |
|---|---|
| **Metodi** | GET |
| **Polku** | `/v1/marketplace/listings` |
| **Auth** | Tier 0 (julkinen) |
| **Query** | `?category=palvelut&city=Espoo&min_price=10&max_price=100&sort=price_morsels&page=1` |

#### GET /v1/marketplace/listings/:id

Yksittäinen ilmoitus.

#### POST /v1/marketplace/listings/:id/purchase

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/listings/:id/purchase` |
| **Auth** | Vaatii JWT |

**Logiikka:**
1. Tarkista ostajan morsel-saldo (hinta + transaction_fee)
2. Luo escrow: siirrä morselit escrowiin
3. Luo WorkRecord (tracking code) ostajan ja myyjän välille
4. Ilmoita myyjälle (email + mailbox)
5. Myyjä toimittaa → escrow release → morselit myyjälle
6. Transaktio-fee palaa operaattorille (burn tai treasury)

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "purchaseId": "work-tracking-code",
    "totalCost": 53,
    "breakdown": { "price": 50, "transactionFee": 3 },
    "status": "pending_delivery",
    "sellerGhii": "liisa29@aimeat-finland-001"
  }
}
```

#### POST /v1/marketplace/purchases/:id/rate

| Kenttä | Arvo |
|---|---|
| **Metodi** | POST |
| **Polku** | `/v1/marketplace/purchases/:id/rate` |
| **Auth** | Vaatii JWT (ostaja) |

**Request body:**
```json
{
  "score": 5,
  "comment": "Erinomaista työtä, suosittelen!"
}
```

**Arvio vaikuttaa myyjän trust-pisteisiin** (Phase 0 trust score system).

### 2.6.4 Portaali-UI

| Sivu | Polku | Kuvaus |
|---|---|---|
| Markkinapaikka | `/v1/portal/human/marketplace` | Selaa ilmoituksia |
| Haku | `/v1/portal/human/marketplace/search` | Hae + suodata |
| Ilmoitus | `/v1/portal/human/marketplace/listing/:id` | Yksittäinen ilmoitus |
| Osta | `/v1/portal/human/marketplace/listing/:id/buy` | Osto-flow |
| Luo ilmoitus | `/v1/portal/human/marketplace/sell` | Uusi ilmoitus -lomake |
| Omat ilmoitukset | `/v1/portal/human/marketplace/my-listings` | Hallinnoi omia |
| Omat ostot | `/v1/portal/human/marketplace/my-purchases` | Ostohistoria + arvioi |

### 2.6.5 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Luo ilmoitus | 201, listing + consent + listing_fee veloitettu |
| 2 | Luo ilmoitus ilman saldoa | 402, INSUFFICIENT_MORSELS |
| 3 | Hae ilmoituksia (category=palvelut) | 200, suodatettu lista |
| 4 | Osta palvelu | 200, escrow luotu, myyjälle ilmoitus |
| 5 | Osta ilman saldoa | 402, INSUFFICIENT_MORSELS |
| 6 | Myyjä toimittaa → escrow release | Morselit myyjälle |
| 7 | Arvioi kauppa | 200, trust-pisteet päivitetty |
| 8 | Cross-node kauppa | +1 morsel routing fee |
| 9 | Ilmoitus validointivirhe (schema) | 400 |
| 10 | Flagattu ilmoitus piilotetaan (auto-hide) | Ei näy haussa |
| 11 | Hakemistohaku ilmoituksille | Ilmoitukset löytyvät |
| 12 | Portaali: end-to-end osto | Koko polku toimii |

### 2.6.6 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/marketplace.ts` — Marketplace-endpointit |
| **Uusi** | `src/services/marketplace.ts` — Marketplace business logic |
| **Uusi** | `src/routes/portal-marketplace.ts` — Marketplace portaali |
| **Muokataan** | `src/services/directory.ts` — Marketplace-ilmoitusten indeksointi |
| **Muokataan** | `src/routes/wallet.ts` — Escrow-tuki marketplace-transaktioille |
| **Muokataan** | `src/services/trust.ts` — Marketplace-arviot trust-pisteisiin |
| **Muokataan** | `src/server.ts` — marketplaceRouter, portal-marketplace mount |
| **Muokataan** | `openapi.yaml` — Marketplace-endpointit |
| **Muokataan** | `src/config.ts` — Marketplace-konfiguraatio |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
