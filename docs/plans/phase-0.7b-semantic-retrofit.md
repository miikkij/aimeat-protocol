# Phase 0.7b: Olemassaolevien rajapintojen semanttinen retrofit — Implementointisuunnitelma

*Osa Phase 0 Foundation -kokonaisuutta. Ks. [Phase 0 yleiskatsaus](./2026-03-01-phase-0-foundation.md) ja [Phase 0.7 Semantic Ontology](./phase-0.7-semantic-ontology.md)*

---

## 0.7b.1 Tavoite

Phase 0.7 määrittelee semanttisen `meta.semantic` -kentän **uusille** datarakenteille (memory-kirjoitukset, CSM, profiilit). Phase 0.7b laajentaa saman ontologiapohjan **kaikkiin olemassaoleviin julkisiin rajapintoihin** — ActionRecord, AgentRecord, BoardPostRecord, Catalogue, Federation sync ja GHII-hakemisto.

**Miksi erillinen dokumentti?** Olemassaolevien rajapintojen retrofit on iso kokonaisuus:
- 9 record-tyyppiä joihin lisätään valinnaisia kenttiä
- 6 route-tiedostoa joiden responseja laajennetaan
- `openapi.yaml` jossa ~88 operaatiota
- Federation-synkronointi jossa semantic-kenttien pitää välittyä nodejen välillä
- Taaksepäinyhteensopivuus: mikään nykyinen client ei saa rikkoutua

---

## 0.7b.2 Arkkitehtuuriperiaatteet

### A. Vapaaehtoinen, ei pakollinen

Semantic-kentät ovat **aina valinnaisia** (`optional` TypeScriptissä, `required: false` OpenAPI:ssa). Nykyinen client joka ei tunne semantiikkaa jatkaa toimimista identtisesti.

### B. Konventio, ei protokolla

Semantic-annotaatiot eivät vaikuta autentikaatioon, autorisointiin tai validointiin. Ne ovat metadata joka kulkee datan mukana — agentit jotka ymmärtävät niitä hyötyvät, muut jättävät huomiotta.

### C. JSON-LD-yhteensopiva `@context`

Catalogue- ja federation-vastaukset voivat sisältää root-tason `@context`-kentän joka määrittelee koko vastauksen semanttisen kontekstin. Yksittäiset recordit voivat sisältää oman `semantic`-kentän.

### D. Kaksi tasoa

| Taso | Missä | Kuka asettaa | Esimerkki |
|---|---|---|---|
| **Record-taso** | `ActionRecord.semantic`, `AgentRecord.semantic` | Datan omistaja (agentti/owner) | `{ "@type": "schema:TranslateAction" }` |
| **Response-taso** | Catalogue/Directory JSON `@context` | Node (automaattisesti) | `{ "@context": { "schema": "https://schema.org/" } }` |

---

## 0.7b.3 Storage-muutokset

### A. Uudet optional-kentät record-tyypeissä

**Tiedosto:** `src/storage/interface.ts`

```typescript
// Yhteinen semanttinen tyyppi kaikille record-tyypeille
export interface SemanticAnnotation {
  '@context'?: Record<string, string>;
  '@type'?: string;
  [key: string]: unknown;  // Ontologia-spesifiset kentät (schema:category, qudt:unit, jne.)
}
```

Lisätään seuraaviin record-tyyppeihin:

```typescript
export interface ActionRecord {
  // ... nykyiset kentät (id, providerGaii, displayName, description, category,
  //     inputSchema, outputSchema, pricing, estimatedTimeSeconds,
  //     maxInputSizeBytes, tags, webhookUrl, createdAt, updatedAt) ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}

export interface AgentRecord {
  // ... nykyiset kentät ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}

export interface BoardPostRecord {
  // ... nykyiset kentät ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}

export interface BoardRecord {
  // ... nykyiset kentät ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}

export interface GHIIRecord {
  // ... nykyiset kentät ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}

export interface PersonalNodeRecord {
  // ... nykyiset kentät ...

  // Uusi valinnainen kenttä:
  semantic?: SemanticAnnotation;
}
```

**HUOM:** `MemoryRecord` EI tarvitse erillistä `semantic`-kenttää koska `value` on jo `unknown` ja memory-kirjoituksissa semantic kulkee `meta.semantic`:n kautta (Phase 0.7).

### B. Storage-metodimuutokset

Nykyiset CRUD-metodit palauttavat jo koko recordin — uudet `semantic`-kentät kulkevat automaattisesti mukana ilman metodi-muutoksia.

**Ainoa muutos:** `createAgent()`, `createAction()`, `createBoardPost()` -metodien input-tyyppiin lisätään `semantic?`.

---

## 0.7b.4 Muutokset record-tyypeittäin

### A. ActionRecord — Palvelutyypin semantiikka

**Nykytila:** `category` on vapaamuotoinen string (`"language"`, `"translation"`, `"analysis"`). AI-agentit eivät voi varmuudella päätellä mitä action tekee.

**Semantic-lisäys:**

```json
{
  "id": "speech-to-text-v2",
  "display_name": "Speech-to-Text Secure",
  "category": "language",
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:ConsumeAction",
    "schema:instrument": {
      "@type": "schema:SoftwareApplication",
      "schema:applicationCategory": "AI/ML"
    },
    "schema:object": { "@type": "schema:AudioObject" },
    "schema:result": { "@type": "schema:TextDigitalDocument" }
  }
}
```

**Suositellut Schema.org Action -tyypit AIMEAT:lle:**

| AIMEAT category | Schema.org @type | Kuvaus |
|---|---|---|
| `language` | `schema:CommunicateAction` | Kielenkäsittely |
| `translation` | `schema:TranslateAction` | Kääntäminen (huom: ei virallinen Schema.org -tyyppi, mutta yleisesti käytetty) |
| `analysis` | `schema:AnalyzeAction` | Data-analyysi |
| `generation` | `schema:CreateAction` | Sisällön generointi |
| `search` | `schema:SearchAction` | Haku/discovery |
| `computation` | `schema:Action` | Yleinen laskenta |
| `storage` | `schema:UpdateAction` | Tiedon tallennus |
| `iot` | `schema:ObserveAction` | IoT-datan lukeminen |

**Route-muutokset:**

**`src/routes/actions.ts`:**
- `POST /v1/actions` — hyväksy `semantic` request bodyssä
- `GET /v1/actions/:gaii/:id` — palauta `semantic` jos asetettu
- `PUT /v1/actions/:id` — mahdollista `semantic`:n päivittäminen

```typescript
// POST /v1/actions request body laajennus:
const { display_name, description, category, input_schema, output_schema,
        tags, pricing, webhook_url, estimated_time_seconds, max_input_size_bytes,
        semantic } = req.body ?? {};  // ← uusi kenttä

// Tallenna:
const action = await storage.createAction({
  ...existingFields,
  semantic: typeof semantic === 'object' ? semantic : undefined,
});

// Response laajennus:
res.json(success(config.nodeId, {
  ...existingResponseFields,
  semantic: action.semantic ?? undefined,
}));
```

### B. AgentRecord — Agentin kyvykkyysontologia

**Nykytila:** `capabilities` on `string[]` (esim. `["research", "analysis", "translation"]`). Federoidut nodet eivät voi standardoidusti matchata kyvykkyyksiä.

**Semantic-lisäys:**

```json
{
  "gaii": "translator#alice@meat-fi-001",
  "capabilities": ["translation", "language"],
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:SoftwareApplication",
    "schema:applicationCategory": "AI Agent",
    "schema:featureList": [
      "schema:TranslateAction",
      "schema:CommunicateAction"
    ],
    "schema:operatingSystem": "AIMEAT Protocol"
  }
}
```

**Route-muutokset:**

**`src/routes/agents.ts`:**
- `POST /v1/agents` — hyväksy `semantic` request bodyssä
- `GET /v1/agents/:gaii` — palauta `semantic`
- Agent profile public view includes semantic

### C. BoardPostRecord — Sisällön semanttinen tyypitys

**Nykytila:** `category` on valinnainen string, `tags[]` on vapaata tekstiä.

**Semantic-lisäys:**

```json
{
  "id": "post-42",
  "title": "Uusi koirapuisto avattu Tapiolaan",
  "category": "local-news",
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:NewsArticle",
    "schema:about": {
      "@type": "schema:Place",
      "schema:name": "Tapiolan koirapuisto"
    },
    "schema:inLanguage": "fi"
  }
}
```

**Suositellut Schema.org -tyypit board-posteille:**

| Post-tyyppi | @type | Käyttö |
|---|---|---|
| Uutinen | `schema:NewsArticle` | Local news, ilmoitukset |
| Kysymys | `schema:Question` | Apukysymykset, neuvonta |
| Vastaus | `schema:Answer` | Vastaukset kysymyksiin |
| Keskustelu | `schema:DiscussionForumPosting` | Yleinen foorumikeskustelu |
| Tapahtuma | `schema:Event` | Tapahtumailmoitukset |
| Myynti-ilmoitus | `schema:Offer` | Marketplace-posteille |

**Route-muutokset:**

**`src/routes/boards.ts`:**
- `POST /v1/boards/:id/posts` — hyväksy `semantic`
- `GET /v1/boards/:id/posts` — palauta `semantic` posteissa
- `GET /v1/boards/:id/posts/:pid` — palauta `semantic`

### D. GHIIRecord — Ihmisprofiilin ontologia

**Nykytila:** `bio`, `locale`, `avatar`, `verificationLevel` ovat plain-kenttiä.

**Semantic-lisäys:**

```json
{
  "ghii": "alice@meat-fi-001",
  "display_name": "Alice",
  "bio": "Teknologiasta kiinnostunut luontoharrastaja",
  "locale": "fi",
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:Person",
    "schema:knowsLanguage": ["fi", "en"],
    "schema:description": "Teknologiasta kiinnostunut luontoharrastaja"
  }
}
```

**Route-muutokset:**

**`src/routes/ghii.ts`:**
- `POST /v1/ghii` — hyväksy `semantic` registraatiossa (valinnainen)
- `PUT /v1/ghii` — päivitä `semantic`
- `GET /v1/ghii/:ghii` — palauta `semantic` julkisessa profiilissa
- `GET /v1/ghii/directory` — palauta `semantic` hakemistolistauksessa

### E. BoardRecord — Palstan semanttinen tyyppi

**Semantic-lisäys:**

```json
{
  "id": "board-local-news",
  "name": "Paikallisuutiset",
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:DiscussionForumPosting",
    "schema:about": {
      "@type": "schema:Place",
      "schema:name": "Espoo, Tapiola"
    }
  }
}
```

### F. PersonalNodeRecord — Noden semanttinen kuvaus

**Semantic-lisäys:**

```json
{
  "node_id": "personal-alice-001",
  "semantic": {
    "@context": { "schema": "https://schema.org/" },
    "@type": "schema:WebSite",
    "schema:description": "Alice's personal AIMEAT node",
    "schema:operatingSystem": "Linux"
  }
}
```

---

## 0.7b.5 Catalogue — JSON-LD @context vastausten ylärakenteeseen

### A. Catalogue-vastauksen root-level @context

**Tiedosto:** `src/routes/catalogue.ts`

Kaikki catalogue-vastaukset saavat valinnaisen root-level `@context`-kentän:

```typescript
// GET /v1/catalogue, GET /v1/catalogue/actions, GET /v1/catalogue/agents, GET /v1/catalogue/boards

res.json(success(config.nodeId, {
  '@context': {
    'schema': 'https://schema.org/',
    'aimeat': 'https://aimeat.io/ns/',
  },
  actions: actions.map(a => ({
    ...existingFields,
    semantic: a.semantic ?? undefined,
  })),
  total: actions.length,
}));
```

**`@context` ei riko nykyisiä clienteja** koska:
1. Se on uusi kenttä — nykyiset clientit jättävät sen huomiotta
2. JSON-vastaus on edelleen validi JSON
3. JSON-LD-prosessorit tunnistavat sen automaattisesti

### B. Catalogue hash -vaikutus

**TÄRKEÄÄ:** `GET /v1/catalogue/hash` laskee hashin catalogueen sisällöstä. Semantic-kenttien lisääminen EI saa muuttaa hashin laskentaa (hash lasketaan vain olemassaolevista kentistä) ELLEI semantic-kenttä ole explisiittisesti asetettu.

**Toteutus:** Hash-funktio jättää `semantic`- ja `@context`-kentät huomiotta:

```typescript
function computeCatalogueHash(actions: ActionRecord[]): string {
  const relevant = actions.map(a => ({
    id: a.id, displayName: a.displayName, category: a.category,
    // ... nykyiset kentät — EI semantic
  }));
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}
```

---

## 0.7b.6 Federation — Semantic-kenttien välittäminen

### A. Catalogue-sync

**Tiedosto:** `src/routes/federation.ts` — `POST /v1/federation/catalogue-sync`

Nykyinen sync vastaanottaa action-listauksen ja tallentaa ne prefixoiduilla ID:llä. Semantic-kenttä pitää välittää mukana:

```typescript
// Nykyinen:
const action = await storage.createAction({
  id: `${source_node}:${a.id}`,
  displayName: a.display_name,
  // ... muut kentät
});

// Laajennettu:
const action = await storage.createAction({
  id: `${source_node}:${a.id}`,
  displayName: a.display_name,
  // ... muut nykyiset kentät
  semantic: a.semantic ?? undefined,  // ← uusi
});
```

### B. Federation directory

`GET /v1/federation/directory` palauttaa personal nodet — näihinkin `semantic` mukaan:

```typescript
personal_nodes: personalNodes.map(pn => ({
  ...existingFields,
  semantic: pn.semantic ?? undefined,
})),
```

### C. Trust advisory

`POST /v1/federation/trust-advisory` — trust-datan semantiikka on Phase 1+ (medium priority). Ei Phase 0:ssa.

---

## 0.7b.7 Zod-schemat

**Tiedosto:** `src/models/schemas.ts`

```typescript
// Yhteinen semantic-validoija
export const SemanticAnnotationSchema = z.object({
  '@context': z.record(z.string(), z.string()).optional(),
  '@type': z.string().optional(),
}).passthrough();  // Sallii vapaamuotoiset ontologia-kentät

// Laajennukset olemassaoleviin request body -schemoihin:

// ActionPublishSchema — lisää semantic
export const ActionPublishSchema = z.object({
  // ... nykyiset kentät ...
  semantic: SemanticAnnotationSchema.optional(),
});

// AgentCreateSchema — lisää semantic
// (tai erillinen AgentUpdateSchema)

// BoardPostCreateSchema — lisää semantic
```

**`.passthrough()`** on kriittinen: se sallii ontologia-spesifisten kenttien (kuten `schema:category`, `saref:measuresProperty`) kulkemisen läpi ilman validointi-virhettä.

---

## 0.7b.8 OpenAPI-muutokset

**Tiedosto:** `openapi.yaml`

### A. Uusi komponentti-schema

```yaml
components:
  schemas:
    SemanticAnnotation:
      type: object
      description: >
        JSON-LD-compatible semantic annotation. Optional metadata that helps
        AI agents understand what data represents using standard ontologies
        (Schema.org, QUDT, SAREF, etc.)
      properties:
        '@context':
          type: object
          additionalProperties:
            type: string
          description: Namespace prefixes for ontology URIs
          example:
            schema: "https://schema.org/"
        '@type':
          type: string
          description: The semantic type from the referenced ontology
          example: "schema:TranslateAction"
      additionalProperties: true
```

### B. Lisäykset olemassaoleviin schemeihin

Jokaiseen record-tyyppi-schemaan lisätään:

```yaml
    ActionRecord:
      properties:
        # ... nykyiset kentät ...
        semantic:
          $ref: '#/components/schemas/SemanticAnnotation'
          description: Optional semantic annotation for this action

    AgentRecord:
      properties:
        # ... nykyiset kentät ...
        semantic:
          $ref: '#/components/schemas/SemanticAnnotation'
          description: Optional semantic annotation for this agent

    # Sama: BoardPostRecord, BoardRecord, GHIIRecord, PersonalNodeRecord
```

### C. Catalogue-vastaukset

```yaml
    CatalogueResponse:
      properties:
        '@context':
          type: object
          additionalProperties:
            type: string
          description: JSON-LD context for the entire catalogue response
        actions:
          type: array
          items:
            $ref: '#/components/schemas/ActionRecord'
```

---

## 0.7b.9 Taaksepäinyhteensopivuus

### A. Muuttumattomat asiat

| Asia | Tila | Selitys |
|---|---|---|
| Autentikaatio | Ei muutu | Semantic ei vaikuta auth-flowiin |
| Autorisaatio | Ei muutu | Rooli-tarkistukset pysyvät samoina |
| JSON Schema Locking | Ei muutu | Schema validoi `value`:ta, ei `semantic`:a |
| Consent Layer | Ei muutu | Consent-tarkistus ei riipu semantic-kentistä |
| Morsel-ekonomia | Ei muutu | Hinnoittelu pysyy samoina |
| Trust-pisteet | Ei muutu | Trust-laskenta ei huomioi semantic-kenttiä |

### B. Response-muutokset

| Muutos | Vaikutus nykyisiin clienteihin |
|---|---|
| Uusi `semantic`-kenttä record-vastauksissa | **Ei vaikutusta** — ylimääräinen optional-kenttä, clientit jättävät tuntemattomia kenttiä huomiotta |
| Uusi `@context` catalogue-vastauksissa | **Ei vaikutusta** — ylimääräinen kenttä JSON-root-tasolla |
| `semantic` puuttuu vanhoista tietueista | **Ei ongelmaa** — kenttä on optional, `undefined` oletuksena |

### C. Migraatio

Olemassaoleviin tietueisiin EI lisätä semantic-annotaatioita automaattisesti. Ne tulevat mukaan vasta kun:
1. Uusi action luodaan `semantic`-kentällä
2. Olemassaoleva action päivitetään `PUT`:lla
3. Agentti rekisteröityy semantic-kentällä
4. Board-postiin lisätään semantic kirjoitushetkellä

**Ei migraatioscriptejä.** Organic adoption — semantic leviää käytön myötä.

---

## 0.7b.10 Testitapaukset

### E2E-testit (lisätään Phase 7/13:een)

| # | Testi | Odotettu tulos |
|---|---|---|
| 1 | `POST /v1/actions` semantic-kentällä → tallentuu | 201, semantic mukana responsessa |
| 2 | `GET /v1/actions/:gaii/:id` → semantic palautuu | 200, semantic field present |
| 3 | `PUT /v1/actions/:id` semantic-kentällä → päivittyy | 200, semantic updated |
| 4 | `POST /v1/actions` ilman semanticia → toimii edelleen | 201, semantic undefined |
| 5 | `POST /v1/agents` semantic-kentällä → tallentuu | 201, semantic mukana |
| 6 | `GET /v1/agents/:gaii` → semantic palautuu | 200, semantic field present |
| 7 | `GET /v1/catalogue` → `@context` mukana | 200, root-level @context |
| 8 | `GET /v1/catalogue` → action semantic palautuu | 200, actions[].semantic present |
| 9 | `POST /v1/boards/:id/posts` semantic-kentällä | 201, semantic mukana |
| 10 | `GET /v1/boards/:id/posts` → semantic posteissa | 200, posts[].semantic present |
| 11 | `POST /v1/ghii` semantic-kentällä | 201, semantic tallennettu |
| 12 | `GET /v1/ghii/:ghii` → semantic palautuu | 200, semantic field present |
| 13 | `GET /v1/ghii/directory` → semantic mukana listauksessa | 200, humans[].semantic present |
| 14 | `POST /v1/federation/catalogue-sync` semantic-actioneilla | 200, semantic säilyy syncissä |
| 15 | Olemassaoleva action ilman semanticia → backward compat | 200, semantic undefined (ei virhettä) |
| 16 | `GET /v1/catalogue/hash` → hash EI muutu semantic-lisäyksestä | Hash pysyy samana |

### Yksikkötestit

| Testitiedosto | Testaa | Testejä |
|---|---|---|
| `test/unit/semantic-annotation.test.ts` | SemanticAnnotation Zod-validointi, passthrough | 8 |

---

## 0.7b.11 Tiedostolista

| Toimenpide | Tiedosto | Muutokset |
|---|---|---|
| **Muokataan** | `src/storage/interface.ts` | +`SemanticAnnotation` -tyyppi, +`semantic?` 6:een record-tyyppiin |
| **Muokataan** | `src/storage/memory.ts` | Ei muutoksia — optional-kentät kulkevat automaattisesti |
| **Muokataan** | `src/storage/mongodb.ts` | Ei muutoksia — optional-kentät kulkevat automaattisesti |
| **Muokataan** | `src/routes/actions.ts` | +semantic hyväksyntä POST/PUT, +semantic responsessa |
| **Muokataan** | `src/routes/agents.ts` | +semantic hyväksyntä POST, +semantic responsessa |
| **Muokataan** | `src/routes/boards.ts` | +semantic post-responsessa |
| **Muokataan** | `src/routes/ghii.ts` | +semantic GHII-responsessa |
| **Muokataan** | `src/routes/catalogue.ts` | +`@context` root-level, +semantic actioneissa |
| **Muokataan** | `src/routes/federation.ts` | +semantic catalogue-syncissä |
| **Muokataan** | `src/models/schemas.ts` | +`SemanticAnnotationSchema`, laajennukset request schemoihin |
| **Muokataan** | `openapi.yaml` | +`SemanticAnnotation` komponentti, laajennukset 6:een schemaan |
| **Muokataan** | `test/e2e-full.ts` | +16 testiä |
| **Uusi** | `test/unit/semantic-annotation.test.ts` | 8 yksikkötestiä |

---

## 0.7b.12 Prioriteettijärjestys

Implementointijärjestys vaikuttavuuden mukaan:

```
1. SemanticAnnotation-tyyppi + Zod-schema    ← Perusinfra
2. ActionRecord + routes/actions.ts           ← Suurin hyöty (discovery)
3. Catalogue @context + semantic passthrough  ← Julkinen pinta
4. Federation catalogue-sync                  ← Nodie-välinen interop
5. AgentRecord + routes/agents.ts             ← Kyvykkyysmatchaus
6. BoardPostRecord + routes/boards.ts         ← Sisältöhaku
7. GHIIRecord + routes/ghii.ts               ← Ihmishakemisto
8. BoardRecord + PersonalNodeRecord           ← Vähäisin vaikutus
```

**Arvio:** 1-4 voidaan implementoida yhdessä sprintissä. 5-8 voidaan tehdä seuraavassa.

---

## 0.7b.13 Riippuvuudet muihin Phase 0 -komponentteihin

| Riippuvuus | Suunta | Selitys |
|---|---|---|
| Phase 0.7 → 0.7b | 0.7 ensin | SemanticAnnotation-tyyppi määritellään 0.7:ssä, 0.7b käyttää samaa |
| Phase 0.1 → 0.7b | 0.1 ensin | Schema Locking on `open`-modessa → sallii semantic-kentät |
| Phase 0.2 → 0.7b | Riippumaton | CSM:n semantic (0.7) ja API:n semantic (0.7b) ovat erillisiä |
| Phase 0.8 → 0.7b | 0.7b informoi | Dokumentaation ylläpitosuunnitelma kattaa myös 0.7b:n muutokset |
| Phase 0.9 → 0.7b | 0.7b lisää | Testausstrategiaan 16 E2E + 8 yksikkötestiä |

---

*AIMEAT — AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
