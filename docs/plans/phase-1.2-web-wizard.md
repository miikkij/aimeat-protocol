# Phase 1.2: Web-wizard — Implementointisuunnitelma

*Osa Phase 1 "Ensimmäinen yhteisö" -kokonaisuutta. Ks. [Phase 1 yleiskatsaus](./phase-1-first-community.md)*

---

## 1.2 Web-wizard (node setup)

> Lähde: masterplan (§1.2), `docs/nextlevel/aimeat-personal-node-spec.md`

### 1.2.1 Tavoite

Rakentaa web-pohjainen konfigurointityökalu joka aktivoituu kun AIMEAT-node käynnistetään ensimmäisen kerran ilman konfiguraatiota. Wizard korvaa manuaalisen `.env`-tiedoston muokkauksen graafisella käyttöliittymällä.

**Tunnistus:** Kun `config.json` puuttuu TAI ympäristömuuttuja `AIMEAT_SETUP_MODE=true` → Express servaa wizard-UI:n kaikkien normaalien routejen sijaan.

### 1.2.2 Wizard-flow

5 askelta:

| Askel | Sisältö | Tallennetaan |
|---|---|---|
| 1. Tervetuloa | Kieli (fi/en), mikä on AIMEAT, mitä wizard tekee | `locale` |
| 2. Node-perustiedot | Noden nimi, tyyppi (personal/full), portti, base URL | `nodeId`, `nodeType`, `port`, `baseUrl` |
| 3. Identiteetti | GHII-identiteetti: luo uusi TAI tuo olemassaoleva (import keypair) | `ownerName`, `displayName`, keypair |
| 4. Ankkurioperaattori | Valinta listalta (genesis-nodet) TAI custom URL | `anchorNodeId`, `anchorUrl` |
| 5. Yhteenveto | Kaikki asetukset yhteenvetona, "Käynnistä" -nappi | → `config.json` + `.env` |

### 1.2.3 Arkkitehtuuri

**Server-side:**

```
Wizard Mode (setup):
  GET  /setup                  → Wizard HTML/JS/CSS (SPA)
  GET  /setup/status           → Nykyinen tila (mikä askel)
  POST /setup/step/:n          → Tallenna askel
  POST /setup/complete         → Kirjoita config + restart
  GET  /setup/discover-anchors → Hae tunnetut genesis-nodet
```

**Toteutustapa:**
- Wizard on **minimaalinen SPA** (Single Page Application) ilman build-steppejä
- HTML + vanilla JS + CSS — ei React/Vue/bundleria
- Yksi `wizard.html` + `wizard.js` + `wizard.css` — servataan Express-staattisina tiedostoina
- Server-side validointi joka stepissä (Zod)
- Wizard-state pidetään muistissa (ei persistoida ennen "Complete")

**Miksi ei bundleria?** Koska:
1. Wizard käytetään kerran — ei tarvitse optimoida
2. Ei lisää build-riippuvuuksia
3. Pidetään deployment yksinkertaisena

### 1.2.4 Storage-muutokset

Wizard ei luo uusia record-tyyppejä. Se kirjoittaa:

1. **`config.json`** — Noden konfiguraatio (JSON, luettavissa startupissa)
2. **`.env`** — Ympäristömuuttujat (generoidaan config.json:n pohjalta)
3. **OwnerRecord** — Ensimmäinen omistaja (wizard kutsuu olemassaolevaa `/v1/owners` -endpointia sisäisesti)
4. **GHIIRecord** — Ensimmäinen GHII-identiteetti (wizard kutsuu `/v1/ghii` -endpointia)

### 1.2.5 Konfiguraatio

#### Uudet ympäristömuuttujat

```env
# ── Setup ─────────────────────────────────────────────────
# AIMEAT_SETUP_MODE=false          # true = pakota wizard-moodi
# AIMEAT_SETUP_ALLOWED_IPS="127.0.0.1,::1"  # Wizard saavutettavissa vain näistä IP:istä
```

#### MeatConfig-laajennukset

```typescript
export interface MeatConfig {
  // ... nykyiset kentät ...

  // Wizard (Phase 1.2)
  setupMode: boolean;
  setupAllowedIps: string[];
}
```

### 1.2.6 Turvallisuuskäytännöt

| Käytäntö | Toteutus |
|---|---|
| IP-rajoitus | Wizard vain localhost:lta (oletuksena), konfiguroitava |
| HTTPS-kehotus | Wizard varoittaa jos ei localhost eikä HTTPS |
| Password-vahvuus | Minimum 12 merkkiä, admin-salasanalle |
| Config-kirjoitus | Atominen: kirjoita temp → rename (ei korruptoidu crashissa) |
| Ei uudelleenaktivoidu | Kun config.json on olemassa, wizard on disabled |

### 1.2.7 Uusi route: Wizard

**Tiedosto:** `src/routes/wizard.ts`

```typescript
export function wizardRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // Serve wizard SPA
  router.get('/setup', (req, res) => { /* serve wizard.html */ });

  // API endpoints for wizard steps
  router.get('/setup/status', (req, res) => { /* current state */ });
  router.post('/setup/step/:n', (req, res) => { /* validate + save step */ });
  router.post('/setup/complete', (req, res) => { /* write config, signal restart */ });
  router.get('/setup/discover-anchors', (req, res) => { /* known genesis nodes */ });

  return router;
}
```

### 1.2.8 Testitapaukset

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | GET /setup ilman config.json → wizard HTML | 200, HTML |
| 2 | GET /setup kun config.json on olemassa | 403 tai redirect → / |
| 3 | POST /setup/step/1 kelvollisella datalla | 200, step tallennettu |
| 4 | POST /setup/step/2 puuttuvalla nimellä | 400, validointivirhe |
| 5 | POST /setup/step/3 uudella identiteetillä | 200, keypair generoitu |
| 6 | POST /setup/step/3 importoidulla keypairilla | 200, keypair validoitu |
| 7 | POST /setup/complete kaikki stepit täytetty | 200, config.json kirjoitettu |
| 8 | POST /setup/complete puuttuvilla stepeillä | 400, "Steps 3-4 missing" |
| 9 | GET /setup ei-sallitusta IP:stä | 403 |
| 10 | Discover-anchors palauttaa tunnetut nodet | 200, lista |

### 1.2.9 Tiedostolista

| Toimenpide | Tiedosto |
|---|---|
| **Uusi** | `src/routes/wizard.ts` — Wizard-backend |
| **Uusi** | `src/static/wizard.html` — Wizard SPA |
| **Uusi** | `src/static/wizard.js` — Wizard frontend-logiikka |
| **Uusi** | `src/static/wizard.css` — Wizard tyylit |
| **Muokataan** | `src/config.ts` — setupMode, setupAllowedIps |
| **Muokataan** | `src/server.ts` — Wizard-moodi tarkistus, staattisten tiedostojen palvelu |
| **Muokataan** | `.env.example` — SETUP-muuttujat |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
