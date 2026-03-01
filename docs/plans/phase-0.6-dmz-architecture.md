# Phase 0.6: DMZ-arkkitehtuurin formalisointi — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md)*

---

## 0.6 DMZ-arkkitehtuurin formalisointi

> Lähde: `docs/nextlevel/aimeat-dmz-concept.md`

### 0.6.1 Tavoite

Formalisoida DMZ-konsepti osaksi AIMEAT-protokollan arkkitehtuuridokumentaatiota ja yhdistää se Phase 0.3 Consent Layeriin. Tämä on pääasiassa dokumentaatio-tehtävä — koodissa DMZ ilmenee consent-sääntöjen ja visibility-kontrollien kautta.

### 0.6.2 Uusi dokumentti

**Uusi tiedosto:** `docs/aimeat-dmz-architecture.md`

Sisältö:

#### 1. Johdanto — DMZ-metafora

- Verkkoturvallisuuden DMZ → AIMEAT:n tiedon DMZ
- Kuva: Private Zone → DMZ → Federation (päivitetty kaavio alkuperäisestä konseptista)

#### 2. Kolme vyöhykettä

| Vyöhyke | Kuvaus | Kuka päättää | Consent-rooli |
|---|---|---|---|
| **Private Zone** | Käyttäjän kone, paikallinen AI, private memory | Käyttäjä | Ei tarvita — data ei poistu |
| **DMZ** | Controlled sharing layer: federation-visible memory, actions, work queue | Käyttäjä consent-sääntöjen kautta | **Consent Layer hallitsee** |
| **Federation** | Muut nodet, agentit, palvelut | Protokolla (salaus, autentikointi) | Consent tarkistetaan lukuhetkellä |

#### 3. Datan virtaus vyöhykkeittäin

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA FLOW                                    │
│                                                                  │
│  ┌──────────────┐    CONSENT     ┌──────────┐    PROTOCOL    ┌──────────┐
│  │              │    RULES       │          │    ENCRYPTION  │          │
│  │  PRIVATE     │───────────────►│   DMZ    │───────────────►│FEDERATION│
│  │  ZONE        │  user decides  │          │  authenticated │          │
│  │              │  what crosses  │          │  & encrypted   │          │
│  │  visibility: │                │ visibility:│               │          │
│  │  "private"   │                │ "owner"/  │               │  Other   │
│  │              │                │ "federation"│              │  nodes   │
│  └──────────────┘                └──────────┘               └──────────┘
│                                       │                                  │
│                          ┌────────────┴────────────┐                    │
│                          │  CONSENT LAYER decides:  │                    │
│                          │  • WHO can read           │                    │
│                          │  • WHAT data patterns     │                    │
│                          │  • HOW LONG (expires)     │                    │
│                          │  • FOR WHAT PURPOSE       │                    │
│                          │  • AUDIT: who accessed    │                    │
│                          └───────────────────────────┘                    │
│                                                                          │
│  INBOUND: Outside → Inside = NEVER (by architecture)                    │
│  Only: requests arrive → queued → user/agent decides to respond          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4. Visibility → Vyöhyke -mapping

| Memory visibility | Vyöhyke | Consent tarvitaan? |
|---|---|---|
| `private` | Private Zone | Ei — vain omistaja näkee |
| `owner` | DMZ (rajoitettu) | Kyllä — consent päättää kuka lukee |
| `public` | Federation | Ei — kaikki näkevät |
| `federation` (tuleva) | DMZ (consent-ohjattu) | Kyllä — consent + scope |

**HUOM:** Nykyinen `visibility` on `private | owner | public`. Phase 0.3 Consent Layer lisää hienomman kontrollin `owner`-visibilityyn. Myöhemmin (Phase 1+) harkitaan `federation`-visibilityn lisäämistä.

#### 5. Consent + DMZ -integraatio

Taulukko joka näyttää miten consent-sääntö kartoittuu DMZ-vyöhykkeisiin:

```
Consent { scope: "dmz" }         → data näkyy vain DMZ:n kautta (saman noden sisällä)
Consent { scope: "federation" }  → data näkyy myös federaation kautta (muut nodet)
Consent { scope: "private" }     → ei varsinaista hyötyä — data pysyy privaattina
```

#### 6. Turvallisuusperiaatteet

1. **Outside → Inside = NEVER** — ulkomaailma ei koskaan pääse suoraan privaattiin dataan
2. **Consent on revocable** — käyttäjä voi peruuttaa suostumuksen milloin tahansa
3. **Audit trail** — kaikki datankäytöt kirjataan
4. **Encryption in transit** — federaatio-liikenne salataan
5. **Identity required** — datankäyttö vaatii aina tunnistetun identiteetin (GAII/GHII)

#### 7. Vaikutus myöhempiin phaseeihin

| Phase | Miten DMZ vaikuttaa |
|---|---|
| Phase 1 — Hakemistot | Hakemisto näyttää vain consent-ohjatut profiilit |
| Phase 1 — Tietolompakko | Portaalin UI näyttää DMZ-vyöhykkeen datan |
| Phase 2 — AI-matchaus | Matchaus lukee vain consent-sallitut profiilit |
| Phase 2 — Organismit | Organismi-jäsenyyden consent = shared workspace access |
| Phase 3 — EUDIW | EU-lompakko → GHII Tier 3 = DMZ-tason vahva identiteetti |

### 0.6.3 Koodimuutokset

Phase 0.6 on ensisijaisesti dokumentaatiotehtävä. Koodissa DMZ ilmenee:

1. **Memory visibility** (`private | owner | public`) — jo olemassa
2. **Consent Layer** (Phase 0.3) — hallitsee DMZ-vyöhykettä
3. **Federation encryption** — jo olemassa peering-mekanismissa

Ainoa mahdollinen koodimuutos:

**`src/routes/memory.ts`** — Lisää response-kenttä `zone` joka kertoo mihin vyöhykkeeseen data kuuluu:

```typescript
// GET /v1/memory/:key response:
{
  ...existingFields,
  zone: visibility === 'private' ? 'private' : visibility === 'public' ? 'federation' : 'dmz',
}
```

### 0.6.4 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | Private memory → zone = "private" | Vastaus sisältää `zone: "private"` |
| 2 | Owner memory → zone = "dmz" | Vastaus sisältää `zone: "dmz"` |
| 3 | Public memory → zone = "federation" | Vastaus sisältää `zone: "federation"` |

### 0.6.5 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `docs/aimeat-dmz-architecture.md` — DMZ-arkkitehtuuridokumentti |
| **Muokataan** | `src/routes/memory.ts` — lisää `zone`-kenttä vastauksiin (valinnainen) |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
