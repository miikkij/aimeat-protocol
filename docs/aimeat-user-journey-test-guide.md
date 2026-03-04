# AIMEAT User Journey — Testausohje Phase 0-3

Kattava testauspolku kaikkien AIMEAT-ominaisuuksien todentamiseen.
Suorita vaiheet jrjestyksess Phase 0:sta Phase 3:een.

**Vaatimukset:**
- Node.js 24.x, pnpm
- AIMEAT-node kytettavissa (`cd aimeat && pnpm dev`)
- Oletus: `http://localhost:40050` (portti 40050)

**Muuttujat:** Korvaa `$TOKEN`, `$OWNER_TOKEN`, `$GAII` jne. oikeilla arvoilla sit mukaa kun saat niit vastauksista.

---

## 0. Kaynnista node

```bash
cd aimeat
pnpm dev
```

Tarkista konsolista ADMIN_PASSWORD (esim. `TestAdminPw123!`) — tarvitset sit myohemmin.

---

## Phase 0 — Core Foundation

### 0.1 Bootstrap & Discovery

```bash
# Protocolan perustiedot
curl http://localhost:40050/

# Well-known endpoint
curl http://localhost:40050/.well-known/aimeat

# OpenAPI spec
curl http://localhost:40050/v1/spec -o openapi.yaml
echo "Spec ladattu, $(wc -l < openapi.yaml) rivia"
```

**Odotettu:** Jokainen palauttaa JSON/YAML-vastauksen AIMEAT-envelopessa.

### 0.2 Admin Setup — Ensimmainen omistaja (operator)

```bash
# Rekisteroi ensimmainen owner = operator
curl -X POST http://localhost:40050/v1/admin/setup/register?pw=TestAdminPw123! \
  -H 'Content-Type: application/json' \
  -d '{"name":"testowner","display_name":"Test Owner"}'
```

**Tallenna vastauksesta:** `private_key` ja `gaii` — tarvitset naita!

### 0.3 Autentikaatio

```bash
# Hae JWT-token (allekirjoita private keyllasi)
# Kayta e2e-testien mallia tai:
curl -X POST http://localhost:40050/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"gaii":"$GAII","signature":"$SIGNATURE","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
```

**Vaihtoehto (helpompi):** Kayta suoraan E2E-testia joka hoitaa allekirjoituksen:
```bash
npx tsx test/e2e-full.ts
```

### 0.4 Agenttien rekisterointi

```bash
curl -X POST http://localhost:40050/v1/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"testi-agentti","capabilities":["memory","actions"]}'
```

**Tallenna:** agentin `gaii` ja `private_key`.

### 0.5 Memory CRUD

```bash
# Kirjoita
curl -X POST http://localhost:40050/v1/memory \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"testi.avain","value":{"viesti":"moi maailma"},"visibility":"private"}'

# Lue
curl http://localhost:40050/v1/memory/testi.avain \
  -H "Authorization: Bearer $AGENT_TOKEN"

# Hae
curl "http://localhost:40050/v1/memory/search?q=moi" \
  -H "Authorization: Bearer $AGENT_TOKEN"

# Paivita
curl -X PUT http://localhost:40050/v1/memory/testi.avain \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":{"viesti":"paivitetty"}}'

# Poista
curl -X DELETE http://localhost:40050/v1/memory/testi.avain \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

### 0.6 Schema Locking

```bash
# Aseta JSON Schema
curl -X PUT http://localhost:40050/v1/memory/testi.schema/schema \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"schema":{"type":"object","required":["nimi"],"properties":{"nimi":{"type":"string"}}}}'

# Kirjoita validilla datalla — pitaisi onnistua
curl -X POST http://localhost:40050/v1/memory \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"testi.schema","value":{"nimi":"validi"}}'

# Kirjoita ei-validilla datalla — pitaisi epaonnistua (400)
curl -X POST http://localhost:40050/v1/memory \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"testi.schema","value":{"puuttuu":"nimi-kentta"}}'

# Listaa kaikki schemat
curl http://localhost:40050/v1/schemas \
  -H "Authorization: Bearer $TOKEN"
```

### 0.7 Consent (suostumuskerros)

```bash
# Luo suostumus
curl -X POST http://localhost:40050/v1/consent \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ownerGaii":"$GAII","granteeGaii":"$AGENT_GAII","scope":"memory.testi.*","permission":"read"}'

# Listaa suostumukset
curl http://localhost:40050/v1/consent \
  -H "Authorization: Bearer $TOKEN"

# Audit trail
curl http://localhost:40050/v1/consent/audit \
  -H "Authorization: Bearer $TOKEN"
```

### 0.8 Actions & Work Queue

```bash
# Julkaise action
curl -X POST http://localhost:40050/v1/actions \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"testi-action","description":"Testipalvelu","price":5}'

# Loyda actioita
curl http://localhost:40050/v1/actions

# Tilaa tyo
curl -X POST http://localhost:40050/v1/work/request \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"$ACTION_ID","input":{"data":"testisyote"}}'

# Katso inbox
curl http://localhost:40050/v1/work/inbox \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

---

## Phase 1 — Identity & Community

### 1.1 GHII-rekisterointi (ihmisidentiteetti)

```bash
# Rekisteroi GHII-profiili
curl -X POST http://localhost:40050/v1/ghii \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Testi Kayttaja","city":"Helsinki","country":"FI","interests":["teknologia","musiikki"]}'

# Hae profiili
curl http://localhost:40050/v1/ghii/$GHII_ID

# Listaa kaikki GHII:t
curl http://localhost:40050/v1/ghii/list
```

### 1.2 TOTP (kaksivaiheinen tunnistautuminen)

```bash
# Aloita TOTP-setup (palauttaa secret + QR URI)
curl -X POST http://localhost:40050/v1/ghii/totp/setup \
  -H "Authorization: Bearer $TOKEN"

# Vahvista TOTP-koodi (kayta authenticator-appista)
curl -X POST http://localhost:40050/v1/ghii/totp/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}'
```

### 1.3 Wallet & Morsel-talous

```bash
# Tarkista saldo
curl http://localhost:40050/v1/wallet \
  -H "Authorization: Bearer $TOKEN"

# Tapahtumahistoria
curl http://localhost:40050/v1/wallet/history \
  -H "Authorization: Bearer $TOKEN"

# Pyda morseleita (jos alle rajan)
curl -X POST http://localhost:40050/v1/wallet/request \
  -H "Authorization: Bearer $TOKEN"
```

### 1.4 CSM — Palvelumaarittelyt

```bash
# Listaa valmiit CSM-pohjat
curl http://localhost:40050/v1/csm/templates

# Hae yksittainen pohja
curl http://localhost:40050/v1/csm/templates/hobby-directory

# Rekisteroi oma CSM (federation-yhteensopiva)
curl -X POST http://localhost:40050/v1/csm \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"service":{"name":"testi-palvelu","type":"directory","description":"Testipalvelu"},"data_schema":{"fields":[{"name":"nimi","type":"string","required":true}]},"federate":true}'

# Listaa rekisteroidyt CSM:t
curl http://localhost:40050/v1/csm \
  -H "Authorization: Bearer $TOKEN"
```

### 1.5 MSM — Ulkoiset API-integraatiot

```bash
# Listaa MSM-pohjat
curl http://localhost:40050/v1/msm/templates

# Rekisteroi MSM
curl -X POST http://localhost:40050/v1/msm \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"service":{"name":"testi-msm","type":"webhook","description":"Testi-webhook"},"endpoints":[{"url":"https://example.com/hook","method":"POST"}]}'
```

### 1.6 Catalogue & Directory

```bash
# Master-katalogi
curl http://localhost:40050/v1/catalogue

# Kaikki agentit
curl http://localhost:40050/v1/catalogue/agents

# Kaikki actionit
curl http://localhost:40050/v1/catalogue/actions

# Ihmishaku (kiinnostukset + sijainti)
curl "http://localhost:40050/v1/catalogue/directory?city=Helsinki&interest=teknologia"

# Katalogin hash (synkronointiin)
curl http://localhost:40050/v1/catalogue/hash
```

### 1.7 Boards (keskustelupalstat)

```bash
# Luo board
curl -X POST http://localhost:40050/v1/boards \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"testi-board","description":"Testipalsta","visibility":"public"}'

# Kirjoita viesti
curl -X POST http://localhost:40050/v1/boards/$BOARD_ID/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Ensimmainen viesti!"}'

# Lue viestit
curl http://localhost:40050/v1/boards/$BOARD_ID/posts

# Listaa kaikki boardit
curl http://localhost:40050/v1/catalogue/boards
```

### 1.8 Flags & Appeals (moderointi)

```bash
# Liputa sisaltoa
curl -X POST http://localhost:40050/v1/flags \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetType":"post","targetId":"$POST_ID","reason":"spam","description":"Testilippu"}'

# Listaa liput (operator)
curl http://localhost:40050/v1/flags \
  -H "Authorization: Bearer $TOKEN"

# Valita lipusta
curl -X POST http://localhost:40050/v1/flags/$FLAG_ID/appeal \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Ei ole spam"}'
```

### 1.9 Matches (AI-yhdistaminen)

```bash
# Listaa ehdotetut matchit
curl http://localhost:40050/v1/matches \
  -H "Authorization: Bearer $TOKEN"

# Match-tilastot
curl http://localhost:40050/v1/matches/stats \
  -H "Authorization: Bearer $TOKEN"
```

---

## Phase 2 — Extensions & Marketplace

### 2.1 Node Extension System

**Enablointi:** Aseta `.env`:iin `AIMEAT_EXTENSIONS_ENABLED=true` ja kaynnista uudelleen.

```bash
# Listaa asennetut extensionit
curl http://localhost:40050/v1/extensions

# Asenna extension (YAML manifest)
curl -X POST http://localhost:40050/v1/extensions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "testi-extension",
    "version": "1.0.0",
    "description": "Testiextension",
    "author": "testowner",
    "requiredApis": ["memory"],
    "actions": [{
      "id": "hello",
      "name": "Hello Action",
      "description": "Palauttaa tervehdyksen",
      "code": "module.exports = async function(ctx) { return { greeting: \"Moi \" + (ctx.input.name || \"maailma\") }; }"
    }]
  }'

# Aktivoi extension
curl -X POST http://localhost:40050/v1/extensions/testi-extension/activate \
  -H "Authorization: Bearer $TOKEN"

# Suorita extension-action
curl -X POST http://localhost:40050/v1/ext/testi-extension/hello \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Matti"}'

# Hae extensionin tiedot
curl http://localhost:40050/v1/extensions/testi-extension

# Deaktivoi
curl -X POST http://localhost:40050/v1/extensions/testi-extension/deactivate \
  -H "Authorization: Bearer $TOKEN"

# Poista
curl -X DELETE http://localhost:40050/v1/extensions/testi-extension \
  -H "Authorization: Bearer $TOKEN"
```

**Odotettu `hello`-actionilta:** `{ "data": { "greeting": "Moi Matti" } }`

### 2.2 Marketplace Extension (esimerkki)

Katso `docs/extensions/marketplace-behaviors/` — valmis extension-manifest marketplace-toiminnallisuuksille:
- `purchase.js` — Ostotapahtuma
- `deliver.js` — Toimitus
- `rate.js` — Arvostelu

### 2.3 Membership Extension (esimerkki)

Katso `docs/extensions/membership-behaviors/` — ryhmien hallinta:
- `join.js` — Liity ryhmaan
- `invite.js` — Kutsu jasen
- `leave.js` — Poistu ryhmasta
- `promote.js` — Ylenna jasen

---

## Phase 3 — Federation & Identity

### 3.1 PWA & Push Notifications

**Enablointi:** Aseta `.env`:iin:
```
AIMEAT_PUSH_ENABLED=true
AIMEAT_VAPID_PUBLIC_KEY=<generoitu avain>
AIMEAT_VAPID_PRIVATE_KEY=<generoitu avain>
```

```bash
# Hae VAPID public key
curl http://localhost:40050/v1/push/vapid-key

# Tilaa push-ilmoitukset
curl -X POST http://localhost:40050/v1/push/subscribe \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"subscription":{"endpoint":"https://fcm.googleapis.com/test","keys":{"p256dh":"test","auth":"test"}}}'

# Testipush (operator)
curl -X POST http://localhost:40050/v1/push/test \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Testi","body":"Push toimii!"}'
```

**Selain:** Avaa `http://localhost:40050/v1/portal` — PWA-manifest + service worker ladataan automaattisesti.

### 3.2 EUDIW & Identity Verification

**Enablointi:** `AIMEAT_EUDIW_ENABLED=true`

```bash
# Pyda OpenID4VP-authorizaatiopyynto
curl http://localhost:40050/v1/ghii/verify/eudiw/request \
  -H "Authorization: Bearer $TOKEN"

# Lisaa luotettu myontaja (operator)
curl -X POST http://localhost:40050/v1/trusted-issuers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Issuer","url":"https://issuer.example.com","publicKey":"test-key","type":"eudiw"}'

# Listaa luotetut myontajat
curl http://localhost:40050/v1/trusted-issuers \
  -H "Authorization: Bearer $TOKEN"

# Hae W3C Verifiable Credential
curl http://localhost:40050/v1/ghii/$GHII_ID/credential \
  -H "Authorization: Bearer $TOKEN"
```

### 3.3 MyData Consent Receipt

```bash
# Hae MyData KI-CR -kuitti suostumukselle
curl http://localhost:40050/v1/consent/$CONSENT_ID/receipt \
  -H "Authorization: Bearer $TOKEN"
```

**Odotettu:** KI-CR v1.1.0 -muotoinen consent receipt (FI-lainsaadanto).

### 3.4 Federation & Genesis Peering

**Enablointi:** `AIMEAT_CROSS_FEDERATION_ENABLED=true`

```bash
# Verkoston tilastot
curl http://localhost:40050/v1/federation/network-stats

# Cross-federation -katalogi
curl http://localhost:40050/v1/federation/cross-catalogue

# Pyda genesis-peering (operator)
curl -X POST http://localhost:40050/v1/federation/genesis-peer \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"genesisNodeId":"remote-node-001","genesisUrl":"https://remote.example.com","publicKey":"test-pubkey"}'

# Listaa genesis-peerit
curl http://localhost:40050/v1/federation/genesis-peers \
  -H "Authorization: Bearer $TOKEN"

# Hyvaksy peering
curl -X PUT http://localhost:40050/v1/federation/genesis-peer/$PEER_ID/approve \
  -H "Authorization: Bearer $TOKEN"

# Keskeyta peering
curl -X PUT http://localhost:40050/v1/federation/genesis-peer/$PEER_ID/suspend \
  -H "Authorization: Bearer $TOKEN"
```

### 3.5 Organism Reputation

```bash
# Hae organismin maine (schema:Rating)
curl http://localhost:40050/v1/organisms/$ORG_ID/reputation
```

### 3.6 Admin-toiminnot

```bash
# Admin dashboard
curl http://localhost:40050/v1/admin/dashboard \
  -H "Authorization: Bearer $TOKEN"

# Katso noden konfiguraatio
curl http://localhost:40050/v1/admin/config \
  -H "Authorization: Bearer $TOKEN"

# Tilastot
curl http://localhost:40050/v1/stats
```

---

## Portaalit (selain)

Avaa selaimessa:

| URL | Kuvaus |
|-----|--------|
| `http://localhost:40050/v1/portal` | Paaportal (human.html) |
| `http://localhost:40050/v1/profile` | Profiilisivu |
| `http://localhost:40050/v1/hobbies` | Harrastusdirectory |
| `http://localhost:40050/v1/marketplace` | Markkinapaikka |
| `http://localhost:40050/v1/guides` | Kayttoohjeet |
| `http://localhost:40050/v1/aimeat-os` | AIMEAT OS -tietopaketti |

---

## GDPR-toiminnot

```bash
# Vie kaikki tiedot (GDPR Article 15)
curl http://localhost:40050/v1/owners/testowner/export \
  -H "Authorization: Bearer $TOKEN"

# Poista tili kokonaan (GDPR Article 17 — cascade delete)
curl -X DELETE http://localhost:40050/v1/owners/testowner \
  -H "Authorization: Bearer $TOKEN"
```

---

## Automaattiset E2E-testit

Helpoin tapa todentaa kaikki kerralla:

```bash
cd aimeat

# Kaynnista testiserveri portissa 40251
AIMEAT_PORT=40251 pnpm dev &

# Aja kaikki E2E-testit
npx tsx test/e2e-full.ts          # 85 testia (core)
npx tsx test/e2e-extensions.ts     # 21 testia (extensions)

# Aja yksikkotestit
npx vitest run                     # 457 testia, 38 tiedostoa
```

**Kokonaistestimarat:**

| Tyyppi | Maara |
|--------|-------|
| Unit (vitest) | 457 |
| E2E core | 85 |
| E2E extensions | 21 |
| **Yhteensa** | **563** |

---

*AIMEAT Protocol Test Guide — Overscale Solutions Oy, 2026-03-04*
