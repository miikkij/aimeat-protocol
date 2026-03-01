# Tutkimus: Palveluiden Nopea Liittäminen AIMEAT-Actioneiksi

> **Tavoite:** Määritellä palvelukuvausformaatti (MEAT Service Manifest), jolla ulkoinen palvelu voidaan kuvata niin, että AI-agentti generoi siitä täydellisen AIMEAT-actionin automaattisesti — sekunneissa, ei tunneissa.

## 1. Nykytila: Miten AIMEAT-Action Julkaistaan Tänään

Nykyinen `POST /v1/actions` -rajapinta vaatii seuraavat kentät:

```json
{
  "id": "translate-text",
  "display_name": "Translate Text",
  "description": "Translate text between languages using DeepL API",
  "category": "translation",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "Text to translate" },
      "source_lang": { "type": "string" },
      "target_lang": { "type": "string" }
    },
    "required": ["text", "target_lang"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "translated_text": { "type": "string" },
      "detected_source_lang": { "type": "string" }
    }
  },
  "pricing": { "base_morsels": 2, "per_unit": { "unit": "characters", "morsels_per_1000": 1 } },
  "estimated_time_seconds": 5,
  "tags": ["translation", "deepl", "multilingual"],
  "webhook_url": "https://my-agent.example.com/hooks/translate"
}
```

**Ongelma:** Tämän kaiken kirjoittaminen käsin on hidasta ja virhealtista. Jokainen uusi palvelu vaatii:
1. Input/output-skeemojen suunnittelu käsin
2. Oikean categoryn valinta (12 vaihtoehtoa)
3. Hinnoittelumallin miettiminen
4. Tagien keksiminen
5. Webhook-endpointin rakentaminen

---

## 2. Olemassa Olevat Palvelukuvausstandardit

### 2.1 OpenAPI (entinen Swagger)

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐⭐⭐ Teollisuusstandardi, v3.1 |
| **AI-valmius** | ⭐⭐⭐⭐ LLM-funktioiksi muunnettavissa automaattisesti |
| **Levinneisyys** | ⭐⭐⭐⭐⭐ Käytännössä kaikilla REST-APIilla |
| **Automaattinen generointi** | ⭐⭐⭐⭐ Useita OpenAPI→MCP-muuntimia |

OpenAPI on REST-APIen kuvausten de facto standardi. Se kuvaa endpointit, parametrit, vastetyypit ja autentikoinnin JSON Schema -pohjaisilla skeemoilla. **Tämä on vahvin lähtökohta**, koska:
- Lähes jokaisella julkisella APIlla on OpenAPI-spec
- OpenAPI→MCP-muuntimia on jo useita (Stainless, openapi-mcp-generator)
- JSON Schema on suoraan yhteensopiva AIMEAT:n `input_schema`/`output_schema` -kenttien kanssa
- LLM:t ymmärtävät OpenAPI-skeemoja erittäin hyvin

**Muunnosesimerkki:**
```yaml
# OpenAPI endpointti
/weather/{city}:
  get:
    summary: Get weather for a city
    parameters:
      - name: city
        in: path
        required: true
        schema:
          type: string

# → AIMEAT Action (automaattinen muunnos)
{
  "id": "get-weather",
  "display_name": "Get Weather",
  "description": "Get weather for a city",
  "input_schema": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "City name" }
    },
    "required": ["city"]
  }
}
```

### 2.2 MCP (Model Context Protocol) — Anthropic

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐ Uusi (2024-2025), aktiivinen kehitys |
| **AI-valmius** | ⭐⭐⭐⭐⭐ Suunniteltu nimenomaan AI-agenteille |
| **Levinneisyys** | ⭐⭐⭐⭐ 2000+ MCP-serveriä, nopea kasvu |
| **Automaattinen generointi** | ⭐⭐⭐ OpenAPI→MCP-muuntimia olemassa |

MCP on Anthropicin avoin standardi, joka määrittelee miten AI-mallit löytävät ja kutsuvat ulkoisia työkaluja. MCP-toolien määritelmä on hyvin lähellä AIMEAT-actionia:

```json
{
  "name": "get_issue",
  "description": "Get a single issue by number",
  "inputSchema": {
    "type": "object",
    "properties": {
      "owner": { "type": "string" },
      "repo": { "type": "string" },
      "issue_number": { "type": "integer" }
    },
    "required": ["owner", "repo", "issue_number"]
  }
}
```

**Yhtäläisyydet AIMEAT:iin:** `name`→`id`, `description`→`description`, `inputSchema`→`input_schema`. Muunnos on triviaalinen.

**Ero:** MCP ei sisällä hinnoittelua, aikaarviota tai tageja — nämä ovat AIMEAT-lisäyksiä jotka tuovat taloudellisen kerroksen.

### 2.3 A2A (Agent-to-Agent Protocol) — Google

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐ Erittäin tuore (huhtikuu 2025) |
| **AI-valmius** | ⭐⭐⭐⭐⭐ Agent Card -konsepti |
| **Levinneisyys** | ⭐⭐⭐ 50+ partneria (Salesforce, SAP, PayPal, Atlassian) |
| **Automaattinen generointi** | ⭐⭐ Toistaiseksi rajoitettu |

Googlen A2A-protokolla tuo "Agent Card" -konseptin: JSON-dokumentti osoitteessa `/.well-known/agent.json`, joka kuvaa agentin kyvykkyydet, endpointin ja autentikaatiovaatimukset. Tämä on konseptuaalisesti sama kuin AIMEAT:n `GET /` bootstrap + catalogue.

**A2A ja AIMEAT täydentävät toisiaan:**
- A2A = agenttien välinen verkostokerros (kommunikaatio)
- AIMEAT = agenttien palvelukerros (talous, luottamus, työsopimukset)

**Agent Card esimerkki:**
```json
{
  "name": "translation-agent",
  "description": "Translates text between languages",
  "url": "https://translation.example.com",
  "capabilities": ["translation", "language-detection"],
  "authentication": { "type": "bearer" },
  "skills": [
    {
      "id": "translate",
      "name": "Translate Text",
      "description": "Translates text from one language to another",
      "inputSchema": { ... },
      "outputSchema": { ... }
    }
  ]
}
```

### 2.4 AsyncAPI

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐⭐ Linux Foundation -projekti |
| **AI-valmius** | ⭐⭐ Ei suunniteltu AI:lle |
| **Levinneisyys** | ⭐⭐⭐ Event-driven -maailmassa vakio |
| **Relevanssi** | ⭐⭐⭐ AIMEAT boardit ovat event-driven |

AsyncAPI kuvaa event-pohjaisia APIja (Kafka, WebSocket, MQTT). Se on relevantti AIMEAT:n board-ilmoituksille ja webhook-pohjaisille actioneille, mutta ei ole ensisijainen muunnosformaatti.

### 2.5 GraphQL SDL

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐⭐⭐ Vakiintunut |
| **AI-valmius** | ⭐⭐⭐ Introspection-tuki |
| **Levinneisyys** | ⭐⭐⭐ Shopify, GitHub, jne. |
| **Muunnettavuus** | ⭐⭐⭐ Vaatii enemmän työtä kuin OpenAPI |

GraphQL-skeemasta voi generoida AIMEAT-actioneja introspectionin kautta, mutta se on monimutkaisempaa kuin OpenAPI-muunnos koska queryt ja mutaatiot pitää pilkkoa erillisiksi actioneiksi.

### 2.6 Coinbase CDP AgentKit — Action Provider -malli

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐ Tuotantovalmis |
| **AI-valmius** | ⭐⭐⭐⭐⭐ AI-natiivi |
| **Relevanssi** | ⭐⭐⭐⭐ Kryptomaksuintegraatiot |
| **Malli** | Action Provider + Wallet Provider -arkkitehtuuri |

Coinbase AgentKit määrittelee "action providerit" jotka rekisteröivät toimintoja AI-agenttien käyttöön. 50+ valmista actionia TypeScript, 30+ Python. Tämä on lähimpänä AIMEAT-actionia — ja sisältää `scripts/generate-action-provider/` -skriptin joka scaffoldaa uusia action-providereita automaattisesti.

### 2.7 Composio — 850+ konnektoria

| Ominaisuus | Arvio |
|-----------|-------|
| **Kypsyys** | ⭐⭐⭐⭐ 27k+ GitHub-tähteä |
| **AI-valmius** | ⭐⭐⭐⭐⭐ LLM-optimoidut skeemat |
| **Levinneisyys** | ⭐⭐⭐⭐ 850+ valmista integraatiota |
| **Relevanssi** | ⭐⭐⭐⭐⭐ Tästä voidaan oppia |

Composio on kehittäjälähtöinen integraatioalusta AI-agenteille. Se tarjoaa:
- Managed OAuth + token refresh
- Pre-built toolkitit (GitHub, Slack, Asana, jne.)
- MCP Gateway -yhteensopivuus
- Tracing & logging

**Composion opetus AIMEAT:lle:** Rakennetaan "action toolkit" -rekisteri johon kuka tahansa voi kontribuoida valmiita palvelukuvauksia.

---

## 3. Ehdotus:AIMEAT Service Manifest (MSM)

Yhdistämällä parhaat puolet kaikista tutkituista standardeista ehdotan**AIMEAT Service Manifest (MSM)** -formaattia. Tämä on YAML/JSON-dokumentti joka kuvaa ulkoisen palvelun niin, että AI-agentti voi automaattisesti:

1. **Generoida** AIMEAT-actionin (`POST /v1/actions`)
2. **Rakentaa** webhook-handlerin
3. **Konfiguroida** hinnoittelun ja tagit
4. **Testata** integraation

### 3.1 MSM-formaatti

```yaml
#AIMEAT Service Manifest v1.0
msm: "1.0"
service:
  name: "DeepL Translation"
  description: "Professional translation service with 30+ languages"
  homepage: "https://www.deepl.com"
  category: "translation"                  # AIMEAT-kategoria
  tags: ["translation", "deepl", "multilingual", "professional"]

# Autentikointi ulkoiseen palveluun
auth:
  type: "api_key"                          # api_key | oauth2 | bearer | none
  header: "Authorization"
  prefix: "DeepL-Auth-Key"
  env_var: "DEEPL_API_KEY"                 # Ympäristömuuttuja josta avain luetaan

# Actionit — yksi MSM voi sisältää useita
actions:
  - id: "translate-text"
    display_name: "Translate Text"
    description: >
      Translate text from one language to another using DeepL's neural
      machine translation. Supports 30+ languages with high accuracy.
    
    # Ulkoisen API:n kutsu
    endpoint:
      method: POST
      url: "https://api-free.deepl.com/v2/translate"
      content_type: "application/json"

    # Input-skeema (käyttäjän tarjoama data)
    input:
      text:
        type: string
        required: true
        description: "Text to translate"
        max_length: 50000
      source_lang:
        type: string
        required: false
        description: "Source language code (e.g., EN, FI, DE). Auto-detect if omitted."
        enum: ["BG","CS","DA","DE","EL","EN","ES","ET","FI","FR","HU","ID","IT","JA","KO","LT","LV","NB","NL","PL","PT","RO","RU","SK","SL","SV","TR","UK","ZH"]
      target_lang:
        type: string
        required: true
        description: "Target language code"
        enum: ["BG","CS","DA","DE","EL","EN-GB","EN-US","ES","ET","FI","FR","HU","ID","IT","JA","KO","LT","LV","NB","NL","PL","PT-BR","PT-PT","RO","RU","SK","SL","SV","TR","UK","ZH-HANS","ZH-HANT"]

    # Input→API request -muunnos (template)
    request_mapping: |
      {
        "text": ["{input.text}"],
        "source_lang": "{input.source_lang}",
        "target_lang": "{input.target_lang}"
      }

    # API response→output -muunnos
    output:
      translated_text:
        type: string
        description: "Translated text"
        from: "translations[0].text"       # JSONPath API-vastauksesta
      detected_source_lang:
        type: string
        description: "Detected source language"
        from: "translations[0].detected_source_language"

    # Hinnoittelu
    pricing:
      base_morsels: 1
      per_unit:
        unit: "characters"
        morsels_per_1000: 2
    
    estimated_time_seconds: 3
    max_input_size_bytes: 51200

    # Esimerkkejä (AI:n ymmärrystä varten)
    examples:
      - input:
          text: "Hello, how are you?"
          target_lang: "FI"
        output:
          translated_text: "Hei, mitä kuuluu?"
          detected_source_lang: "EN"
      - input:
          text: "Tämä on testi"
          target_lang: "EN-US"
        output:
          translated_text: "This is a test"
          detected_source_lang: "FI"

  - id: "detect-language"
    display_name: "Detect Language"
    description: "Detect the language of given text"
    endpoint:
      method: POST
      url: "https://api-free.deepl.com/v2/translate"
      content_type: "application/json"
    input:
      text:
        type: string
        required: true
        description: "Text to analyze"
    request_mapping: |
      {
        "text": ["{input.text}"],
        "target_lang": "EN"
      }
    output:
      detected_language:
        type: string
        from: "translations[0].detected_source_language"
    pricing:
      base_morsels: 0
    estimated_time_seconds: 2
    tags: ["language-detection"]

# Healthcheck (valinnainen)
health:
  endpoint: "https://api-free.deepl.com/v2/usage"
  method: GET
  expected_status: 200
```

### 3.2 MSM → AIMEAT Action -muunnosprosessi

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  📄 MSM File │────▶│ 🤖 AI Parser │────▶│ POST /v1/actions │────▶│ ⚡ Live Action  │
│  (YAML/JSON) │     │  + Validator  │     │  (auto-publish)  │     │  in Catalogue  │
└──────────────┘     └──────────────┘     └──────────────────┘     └────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ 🔌 Webhook   │
                     │   Handler    │
                     │ (generated)  │
                     └──────────────┘
```

### 3.3 Miksi MSM Eikä Pelkkä OpenAPI?

| Aspekti | OpenAPI | MSM |
|---------|---------|-----|
| Input/Output skeema | ✅ Kyllä | ✅ Kyllä (yksinkertaisempi) |
| Hinnoittelu | ❌ Ei | ✅ Sisäänrakennettu |
| AIMEAT-kategoria & tagit | ❌ Ei | ✅ Sisäänrakennettu |
| Request/Response mapping | ❌ Ei | ✅ Template-pohjainen |
| Esimerkit AI:lle | 🟡 Epäsuorasti | ✅ Eksplisiittiset |
| Aika-arvio | ❌ Ei | ✅ `estimated_time_seconds` |
| Auth-konfiguraatio | ✅ SecuritySchemes | ✅ Yksinkertaisempi |
| Healthcheck | ❌ Ei | ✅ Sisäänrakennettu |
| Monimutkaisuus | Korkea (full spec) | Matala (yksi tiedosto) |
| AI-generoitavuus | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**MSM on OpenAPI:n "projektio"** — se ottaa tarvittavan datan ja lisää AIMEAT-spesifiset kentät. OpenAPI-spec voidaan muuntaa automaattisesti MSM:ksi.

---

## 4. Automaattiputket: Mistä Lähteestä Tahansa Actioniksi

### 4.1 OpenAPI → MSM → AIMEAT Action

```
OpenAPI spec (JSON/YAML)
    │
    ▼
msm-convert --from openapi --spec stripe-api.yaml --select "POST /charges"
    │
    ▼
Generates: stripe-create-charge.msm.yaml
    │
    ▼
AI enriches: pricing, tags, examples, description
    │
    ▼
msm-publish --manifest stripe-create-charge.msm.yaml
    │
    ▼
✅ Action live in catalogue
```

### 4.2 MCP Tool → MSM → AIMEAT Action

```
MCP Server (tools/list)
    │
    ▼
msm-convert --from mcp --server github-mcp --tool "get_issue"
    │
    ▼
Generates: github-get-issue.msm.yaml
    │
    ▼
msm-publish
```

### 4.3 A2A Agent Card → MSM → AIMEAT Action

```
/.well-known/agent.json
    │
    ▼
msm-convert --from a2a --url https://agent.example.com
    │
    ▼
Generates: agent-skills.msm.yaml (yksi per skill)
    │
    ▼
msm-publish --all
```

### 4.4 Luonnollinen Kieli → MSM → AIMEAT Action

Tämä on tehokkain vaihtoehto. Käyttäjä kuvaa palvelun luonnollisella kielellä, ja AI generoi MSM:n:

```
Käyttäjä: "Haluan actionin joka lähettää sähköpostia Resend-APIlla.
           API-avain headerissa. POST https://api.resend.com/emails.
           Input: to, subject, html_body. Output: id, from."

    │
    ▼  (AI generoi)

msm: "1.0"
service:
  name: "Resend Email"
  description: "Send transactional emails via Resend API"
  category: "utility"
  tags: ["email", "transactional", "resend"]
auth:
  type: "bearer"
  env_var: "RESEND_API_KEY"
actions:
  - id: "send-email"
    display_name: "Send Email"
    description: "Send a transactional email to a single recipient"
    endpoint:
      method: POST
      url: "https://api.resend.com/emails"
    input:
      to: { type: string, required: true, description: "Recipient email" }
      subject: { type: string, required: true, description: "Email subject line" }
      html_body: { type: string, required: true, description: "HTML email body" }
    request_mapping: |
      { "from": "noreply@yourdomain.com", "to": ["{input.to}"],
        "subject": "{input.subject}", "html": "{input.html_body}" }
    output:
      id: { type: string, from: "id" }
    pricing: { base_morsels: 1 }
    estimated_time_seconds: 2
```

### 4.5 URL/Dokumentaatio → MSM (Web Scraping + AI)

```
msm-generate --url "https://docs.stripe.com/api/charges/create"
    │
    ▼  (haetaan sivu, AI parsii)

Generates: stripe-create-charge.msm.yaml
```

---

## 5. Muunnosmatriisi: Mistä Formaatista Mihinkin

```
┌─────────────┐     ┌──────────┐     ┌─────────────────┐
│ OpenAPI 3.x  ├────▶│          │────▶│ AIMEAT Action    │
├─────────────┤     │          │     │ POST /v1/actions │
│ MCP Tool     ├────▶│   MSM    │────▶│                 │
├─────────────┤     │ Service  │     ├─────────────────┤
│ A2A Agent    ├────▶│ Manifest │────▶│ Webhook Handler │
├─────────────┤     │          │     │ (generated code) │
│ GraphQL SDL  ├────▶│          │     ├─────────────────┤
├─────────────┤     │          │────▶│ MCP Server       │
│ AsyncAPI     ├────▶│          │     │ (bidirectional)  │
├─────────────┤     │          │     ├─────────────────┤
│ Luonnollinen ├────▶│          │────▶│ A2A Agent Card   │
│ kieli        │     │          │     │ (bidirectional)  │
├─────────────┤     └──────────┘     └─────────────────┘
│ API docs URL ├────▶
└─────────────┘
```

---

## 6. Vertailu: Integraatioalustat

| Alusta | Konnektorit | Auth | AI-natiivi | Avoin lähdekoodi | Hinta |
|--------|-------------|------|-----------|------------------|-------|
| **Composio** | 850+ | ✅ Managed OAuth | ✅ MCP + SDK | ✅ OSS (27k★) | Freemium |
| **Nango** | 500+ | ✅ Unified API | 🟡 | ✅ OSS | Freemium |
| **Arcade** | ~25 (MCP) | ❌ BYOA | ✅ MCP-natiivi | ✅ OSS | Ilmainen |
| **Workato** | 1000+ | ✅ Enterprise | 🟡 | ❌ Suljettu | Kallis |
| **n8n** | 400+ | 🟡 | 🟡 | ✅ OSS (50k★) | Freemium |
| **AIMEAT MSM** | ∞ (generoitu) | ✅ Per-manifest | ✅ AI-generoitu | ✅ Avoin protokolla | Ilmainen |

**AIMEAT MSM:n etu:** Ei ole alusta vaan **formaatti**. Kuka tahansa voi kirjoittaa MSM:n, ja se julkaistaan suoraan federoituun verkkoon. Ei vendor lock-iniä, ei keskitettyä rekisteriä.

---

## 7. Käytännön Esimerkki: Marketplace-Palveluiden MSM:t

### 7.1 Stripe-maksuintegraatio

```yaml
msm: "1.0"
service:
  name: "Stripe Payments"
  description: "Accept payments via Stripe"
  category: "utility"
  tags: ["payment", "stripe", "credit-card", "marketplace"]
auth:
  type: "bearer"
  env_var: "STRIPE_SECRET_KEY"
actions:
  - id: "create-payment-intent"
    display_name: "Create Payment"
    description: "Create a Stripe payment intent for a transaction"
    endpoint:
      method: POST
      url: "https://api.stripe.com/v1/payment_intents"
      content_type: "application/x-www-form-urlencoded"
    input:
      amount_cents:
        type: integer
        required: true
        description: "Amount in cents (e.g., 1000 = 10.00€)"
      currency:
        type: string
        required: true
        description: "ISO 4217 currency code"
        enum: ["eur", "usd", "gbp", "sek", "nok", "dkk"]
      description:
        type: string
        required: false
    request_mapping: |
      amount={input.amount_cents}&currency={input.currency}&description={input.description}
    output:
      payment_id: { type: string, from: "id" }
      client_secret: { type: string, from: "client_secret" }
      status: { type: string, from: "status" }
    pricing: { base_morsels: 5 }
    estimated_time_seconds: 3
```

### 7.2 Posti SmartShip -pakettien lähetys

```yaml
msm: "1.0"
service:
  name: "Posti SmartShip"
  description: "Send packages within Finland and internationally via Posti"
  category: "utility"
  tags: ["shipping", "logistics", "posti", "finland", "package"]
auth:
  type: "api_key"
  header: "X-Api-Key"
  env_var: "POSTI_API_KEY"
actions:
  - id: "create-shipment"
    display_name: "Create Shipment"
    description: "Create a new shipment and get tracking code"
    endpoint:
      method: POST
      url: "https://api.posti.fi/shipment/v1/shipments"
    input:
      sender_name: { type: string, required: true }
      sender_address: { type: string, required: true }
      sender_postcode: { type: string, required: true }
      sender_city: { type: string, required: true }
      recipient_name: { type: string, required: true }
      recipient_address: { type: string, required: true }
      recipient_postcode: { type: string, required: true }
      recipient_city: { type: string, required: true }
      weight_kg: { type: number, required: true }
    output:
      tracking_code: { type: string, from: "shipments[0].trackingCode" }
      label_url: { type: string, from: "shipments[0].labelUrl" }
    pricing: { base_morsels: 3 }
    estimated_time_seconds: 5
```

### 7.3 Coinbase CDP — kryptosiirto

```yaml
msm: "1.0"
service:
  name: "Coinbase CDP Transfer"
  description: "Send cryptocurrency via Coinbase AgentKit"
  category: "utility"
  tags: ["crypto", "payment", "coinbase", "usdc", "transfer"]
auth:
  type: "api_key"
  env_var: "CDP_API_KEY"
actions:
  - id: "send-crypto"
    display_name: "Send Crypto"
    description: "Send cryptocurrency (USDC, ETH, BTC) to a wallet address"
    endpoint:
      method: POST
      url: "https://api.cdp.coinbase.com/v1/transfers"
    input:
      amount: { type: string, required: true, description: "Amount to send (e.g., '10.5')" }
      currency: { type: string, required: true, enum: ["USDC", "ETH", "BTC", "SOL"] }
      to_address: { type: string, required: true, description: "Recipient wallet address" }
      network: { type: string, required: false, description: "Network (e.g., base, ethereum)" }
    output:
      tx_hash: { type: string, from: "transaction_hash" }
      status: { type: string, from: "status" }
    pricing: { base_morsels: 10 }
    estimated_time_seconds: 30
    examples:
      - input: { amount: "50", currency: "USDC", to_address: "0xabc...def" }
        output: { tx_hash: "0x123...789", status: "completed" }
```

---

## 8. Toteutussuunnitelma

### Vaihe 1: MSM Spesifikaatio & Validaattori
- Määrittele MSM JSON Schema (validointiin)
- TypeScript-validaattorikirjasto `msm-validate`
- CLI: `msm validate my-service.msm.yaml`

### Vaihe 2: MSM → AIMEAT Action -generaattori
- CLI-työkalu: `msm publish --manifest service.msm.yaml --node localhost:40050`
- Generoi `POST /v1/actions` -kutsun automaattisesti
- Generoi webhook-handler-koodin (TypeScript/Python)

### Vaihe 3: Muuntimet
- `msm convert --from openapi --spec api.yaml` → MSM
- `msm convert --from mcp --server-url ...` → MSM
- `msm convert --from a2a --url ...` → MSM

### Vaihe 4: AI-generointi
- `msm generate --describe "..."` → MSM luonnollisesta kielestä
- `msm generate --url "https://docs.example.com/api"` → MSM sivulta
- AI täydentää puuttuvat kentät (hinta, tagit, esimerkit)

### Vaihe 5: Yhteisö-rekisteri
- `msm-registry` — GitHub-repo valmiita MSM-tiedostoja
- Community-kontribuutiot PR:inä
- Automaattinen validointi CI/CD:ssä
- Mahdollisesti myös AIMEAT boardille julkaistava kullekin MSM:lle

---

## 9. AI-Generoinnin Optimointi

### 9.1 Miksi MSM on AI:lle Helppo?

1. **Flat-rakenne:** Ei syviä sisäkkäisyyksiä (vrt. OpenAPI:n $ref-referenssit)
2. **Eksplisiittiset esimerkit:** AI näkee konkreettisen input→output-parin
3. **Yksinkertainen mapping:** `from: "response.path"` vs. monimutkainen transformaatio
4. **Rajoitetut vaihtoehdot:** Kategoriat, authtyypit, hinnoittelumallit ovat enumeraatioita
5. **Validoitava:** JSON Schema -pohjainen validointi kertoo heti virheen

### 9.2 AI-Prompt MSM:n Generointiin

```
You are an AIMEAT service manifest generator.

Given the following API documentation, generate a valid MSM (MEAT Service Manifest) YAML file.

Rules:
- msm version is always "1.0"
- category must be one of: language, translation, analysis, generation, coding, data, image, audio, video, search, utility, other
- input fields: use simple types (string, integer, number, boolean, array, object)
- output fields: include "from" with JSONPath to the API response field
- pricing: estimate based on API complexity (0 for simple lookups, 1-5 for moderate, 5+ for heavy compute)
- always include at least one example
- tags: 3-7 relevant keywords

API Documentation:
{paste API docs here}
```

### 9.3 Käyttäjäkokemus: "Kuvasta Actioniksi"

Loppukäyttäjän kokemus kännykällä:

```
1. 📸 Ota kuva tuotteesta
2. 🤖 "Analysoidaan... iPhone 15 Pro, 128GB, hyvä kunto"
3. 📝 "Arvioin hinnaksi 650-720€. Julkaistaanko?"
4. ✅ "Julkaise"
5. ⚡ Agentti:
   a. Luo MSM lennossa (kuva-analyysi-action + listaus-action)
   b. Tallentaa read-only muistiin (kuvat + kuvaus + hinta)
   c. Julkaisee boardille (tags: electronics, iphone, used)
6. 🔔 "Julkaistu! Vahtiagentti seuraa tarjouksia."
```

---

## 10. Yhteenveto & Suositus

### Suositeltu lähestymistapa: MSM + Muuntimet + AI-generointi

```
                    ┌──────────────────────────────────────┐
                    │    AIMEAT Service Manifest (MSM)       │
                    │     ─ Yksinkertainen YAML-formaatti   │
                    │     ─ AI-generoitava                  │
                    │     ─ Validoitava JSON Schemalla      │
                    └──────────┬──────────┬────────────────┘
                               │          │
              ┌────────────────┘          └────────────────┐
              ▼                                            ▼
    ┌──────────────────┐                        ┌──────────────────┐
    │ Automaattinen     │                        │ Yhteisörekisteri  │
    │ muunnos:          │                        │                  │
    │ ─ OpenAPI → MSM   │                        │ ─ GitHub-repo    │
    │ ─ MCP → MSM       │                        │ ─ 100+ valmiita  │
    │ ─ A2A → MSM       │                        │ ─ PR-kontribuutio│
    │ ─ NL → MSM (AI)   │                        │ ─ CI-validointi  │
    │ ─ URL → MSM (AI)  │                        │                  │
    └────────┬─────────┘                        └────────┬─────────┘
             │                                           │
             └──────────────┬────────────────────────────┘
                            ▼
                   ┌──────────────────┐
                   │ msm publish       │
                   │ → POST /v1/actions│
                   │ → webhook handler │
                   │ → live in minutes │
                   └──────────────────┘
```

### Prioriteettijärjestys

| # | Toimenpide | Vaikutus | Vaativuus |
|---|-----------|---------|-----------|
| 1 | **MSM-spesifikaation luonti** | Perusta kaikelle | Matala |
| 2 | **OpenAPI→MSM muunnin** | 90% olemassa olevista APIeista | Keskitaso |
| 3 | **NL→MSM AI-generointi** | Nopein UX, ei vaadi teknistä osaamista | Keskitaso |
| 4 | **MCP→MSM muunnin** | 2000+ MCP-serveriä heti käyttöön | Matala |
| 5 | **Yhteisörekisteri (GitHub)** | Verkostovaikutus, ekosysteemin kasvu | Matala |
| 6 | **A2A→MSM muunnin** | Googlen ekosysteemi | Keskitaso |
| 7 | **URL→MSM web scraper** | Nollakonfiguraatio | Korkea |
| 8 | **msm publish CLI** | End-to-end automaatio | Keskitaso |

### Loppupäätelmä

MSM-formaatti yhdistää OpenAPI:n validoitavuuden, MCP:n AI-natiiviuden, A2A:n löydettävyyden ja Composion integraatiolaajuuden — mutta tekee sen AIMEAT-natiivisti. Yksinkertainen YAML-tiedosto kuvaa kaiken mitä tarvitaan: mitä palvelu tekee, miten sitä kutsutaan, mitä se maksaa, ja miten vastaus tulkitaan.

Tavoite on tilanne jossa:
- **Ihminen sanoo:** "Haluan Stripe-maksuactionin" → AI generoi MSM:n → julkaistu 30 sekunnissa
- **Agentti löytää:** OpenAPI spec → muuntaa MSM:ksi → julkaisee itsensä palveluntarjoajaksi
- **Yhteisö jakaa:** GitHub-reposta valmis MSM → `msm publish` → käytössä minuutissa
- **Kuka tahansa:** pastettaa API-docsien URL → AI parsii → MSM → action → live
