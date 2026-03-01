# 3.4 Advanced federation

*Alidokumentti: [phase-3-polish-future.md](./phase-3-polish-future.md)*

---

> Lähde: masterplan (§3.4), `docs/05-federation.md`

### 3.4.1 Tavoite

Laajentaa federaatiojärjestelmä multi-genesis -arkkitehtuuriksi: useamman genesis-noden välinen discovery, organismi-reputaatio, CSM-palveluiden automaattinen jakelu ja cross-node matchaus.

### 3.4.2 Cross-federation discovery

**Nykytilanne:** Yksi genesis-node per federaatio. Kaikki nodet tuntevat genesis-nodensa.

**Tavoite:** Useampi genesis-node voi peeriä keskenään → laajempi verkko.

**Genesis-peering -protokolla:**

```
Genesis A ←→ Genesis B:
  1. A kutsuu B:n: POST /v1/federation/genesis-peer
  2. B validoi A:n (readiness-testi + operaattorin hyväksyntä)
  3. Molemmat lisäävät toisensa "trusted genesis" -listaan
  4. Katalogi-sync: molemmat synkkaavat oman federaation cataloguen
  5. Profiili-index: molemmat jakavat anonymisoidut profiili-statistiikat
```

**Uudet endpointit:**

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| POST | `/v1/federation/genesis-peer` | Operator | Pyydä genesis-peering |
| GET | `/v1/federation/genesis-peers` | Operator | Listaa genesis-peerit |
| DELETE | `/v1/federation/genesis-peer/:id` | Operator | Poista genesis-peering |
| GET | `/v1/federation/cross-catalogue` | Tier 0 | Hae cross-federation catalogue |
| GET | `/v1/federation/network-stats` | Tier 0 | Koko verkon statistiikat |

### 3.4.3 Organismi-reputaatio

**Reputaation komponentit:**

| Komponentti | Paino | Laskenta |
|---|---|---|
| Jäsenmäärä | 0.20 | `log10(members) / log10(max_members)` |
| Aktiivisuus | 0.25 | Postaukset/viikko viimeisen kuukauden aikana |
| Jäsenten trust-keskiarvo | 0.25 | Jäsenten trust-pisteiden keskiarvo |
| Ikä | 0.15 | `min(age_days / 365, 1.0)` |
| Flag-historia | 0.15 | `max(1.0 - (total_flags / (members * 0.1)), 0)` |

**Uusi endpoint:**

| Metodi | Polku | Auth | Kuvaus |
|---|---|---|---|
| GET | `/v1/organisms/:id/reputation` | Tier 0 | Organismin reputaatiopisteet |

### 3.4.4 CSM-palveluiden automaattinen federation-jakelu

Kun operaattori julkaisee CSM-palvelun, se voidaan automaattisesti jakaa federation-peereille:

```
1. Operaattori: POST /v1/csm { ..., "federate": true }
2. Catalogue-sync lisää CSM:n federated catalogueen
3. Peer-nodet vastaanottavat CSM:n ja lisäävät omaan katalogiin
4. Peer-noden käyttäjät voivat löytää + käyttää palvelua
```

**Uusi kenttä CsmRecordiin:** `federate: boolean` (oletus: false)

### 3.4.5 Cross-node matchaus-agentti

Laajennetaan Phase 2.1 matchaus-agenttiä federaation yli:

```
1. Node A:n matchaus-agentti pyytää anonymisoitua profiili-dataa peeriltä B
2. B palauttaa: { interests: [...], city: "...", hash: "..." }
   (ei GHII:ta, ei nimeä — vain kiinnostukset + sijainti)
3. A:n matchaus-agentti laskee match-scoren
4. Jos match → A lähettää B:lle "match request" anonymisoidusti
5. B:n node ilmoittaa käyttäjälleen: "Toisen noden käyttäjä kiinnostui samoista asioista"
6. Molemminpuolinen accept → GHII-tiedot vaihdetaan
```

**Yksityisyydensuoja:**
- Profiilidata anonymisoituna (ei GHII:ta ennen molemminpuolista acceptia)
- Hash-pohjainen parinmuodostus (ei voi kohdistaa yksittäiseen henkilöön)
- Cross-node match-pyyntö sisältää vain hash + kiinnostukset

### 3.4.6 Storage-muutokset

**Uudet record-tyypit:**

```typescript
export interface GenesisPeerRecord {
  id: string;
  genesisNodeId: string;       // Toisen genesis-noden ID
  genesisUrl: string;          // URL
  publicKey: string;
  status: 'pending' | 'active' | 'suspended';
  lastSyncAt: string;
  catalogueHash: string;       // Viimeisin synkattu catalogue-hash
  createdAt: string;
  updatedAt: string;
}

export interface OrganismReputationRecord {
  organismId: string;
  score: number;               // 0-100
  breakdown: {
    memberScore: number;
    activityScore: number;
    trustScore: number;
    ageScore: number;
    flagScore: number;
  };
  calculatedAt: string;
}
```

### 3.4.7 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Genesis-peering pyyntö | 201, pending |
| 2 | Genesis-peering hyväksyntä | Status → active |
| 3 | Cross-catalogue haku | Molempien federaatioiden tulokset |
| 4 | Network-stats | Kokonaislukuja kaikista genesis-peereistä |
| 5 | Organismi-reputaatio: aktiivinen ryhmä | Score > 60 |
| 6 | Organismi-reputaatio: tyhjä ryhmä | Score < 20 |
| 7 | CSM federation-jakelu | CSM näkyy peer-nodessa |
| 8 | Cross-node matchaus: anonymisoitu pyyntö | Hash + kiinnostukset, ei GHII:ta |
| 9 | Cross-node matchaus: molemminpuolinen accept | GHII:t vaihdettu |
| 10 | Genesis-depeering | Grace period, sync lopetetaan |

### 3.4.8 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/services/genesis-peering.ts` — Cross-federation peering |
| **Uusi** | `src/services/organism-reputation.ts` — Reputaatiolaskenta |
| **Uusi** | `src/services/cross-node-matching.ts` — Anonymisoitu cross-node matchaus |
| **Muokataan** | `src/routes/federation.ts` — Genesis-peer endpointit, cross-catalogue |
| **Muokataan** | `src/routes/organisms.ts` — Reputaatio-endpoint |
| **Muokataan** | `src/routes/csm.ts` — federate-kenttä |
| **Muokataan** | `src/storage/interface.ts` — GenesisPeerRecord, OrganismReputationRecord |
| **Muokataan** | `src/storage/memory.ts` — In-memory toteutus |
| **Muokataan** | `src/config.ts` — Cross-federation konfiguraatio |
| **Muokataan** | `openapi.yaml` — Genesis-peer, reputation, cross-catalogue endpointit |
| **Muokataan** | `.env.example` — CROSS_FEDERATION -muuttujat |

---

← [Phase 3: Polish + tulevaisuus](./phase-3-polish-future.md)
