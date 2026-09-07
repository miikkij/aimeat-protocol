# AIMEAT Semantic Ontology Specification

> Phase 0.7 / 0.7b — JSON-LD-compatible semantic annotations for federation interoperability
>
> 2026-09-08: a core ontology at `https://aimeat.io/ns/`, served by `GET /v1/ns`, and one check that
> every prefix an annotation names resolves. Sections 2.4, 3.0 and 6.2 carry the change; everything
> else is as it was, and no existing valid annotation is affected.

## 1. Overview

AIMEAT provides optional JSON-LD-compatible semantic annotations on records and schemas to enable:

- **Federation interoperability** — Nodes can understand each other's data types without prior coordination
- **Linked Data discovery** — External systems can consume AIMEAT data using standard ontology URIs
- **Schema enrichment** — Memory schemas carry semantic context that describes what the data represents, not just its shape

All semantic annotations are **optional**. A record or schema without semantic metadata remains fully functional. Annotations follow JSON-LD conventions (`@context`, `@type`) so that any JSON-LD processor can expand them into full IRIs.

**Optional, but not unchecked.** An annotation that names a prefix nobody declared expands to
nothing in any JSON-LD processor, which makes it decorative — and decorative metadata is worse than
none, because a consumer trusts it. Section 2.4 is the rule and section 3.0 is what resolves without
being declared.

## 2. Core Interfaces

### 2.1 SemanticAnnotation (Records)

Defined in `aimeat/src/storage/interface.ts` (lines 1-6). Attached to individual records to describe what the record **is**.

```typescript
// Phase 0.7b -- Semantic annotation for records (JSON-LD-compatible)
export interface SemanticAnnotation {
  '@context'?: Record<string, string>;
  '@type'?: string;
  [key: string]: unknown;
}
```

The `[key: string]: unknown` index signature allows ontology-specific properties (e.g., `schema:category`, `qudt:unit`, `saref:hasFunction`) to be included alongside the JSON-LD keywords.

**Zod validation schema** (from `aimeat/src/models/schemas.ts`, lines 5-8):

```typescript
export const SemanticAnnotationSchema = z.object({
  '@context': z.record(z.string(), z.string()).optional(),
  '@type': z.string().optional(),
}).passthrough();  // Allow ontology-specific fields
```

### 2.2 SemanticContext (Schemas)

Defined in `aimeat/src/storage/interface.ts` (lines 325-329). Attached to `SchemaRecord` to describe what the **schema target data** represents.

```typescript
export interface SemanticContext {
  '@context'?: Record<string, string>;
  '@type'?: string;
  properties?: Record<string, unknown>;
}
```

The `properties` field allows per-field semantic mappings within a schema, enabling fine-grained property-level annotations (e.g., mapping a schema's `temperature` field to `qudt:QuantityValue`).

### 2.3 Distinction Between the Two

| Aspect | `SemanticAnnotation` | `SemanticContext` |
|--------|---------------------|-------------------|
| Attached to | Individual records (agents, actions, boards, etc.) | `SchemaRecord` (memory key schemas) |
| Purpose | "This record **is** a schema:SoftwareApplication" | "Data stored under this key **represents** schema:Person" |
| Index signature | `[key: string]: unknown` (free-form properties) | `properties?: Record<string, unknown>` (structured) |
| Used at | `aimeat/src/storage/interface.ts` line 339 | `aimeat/src/storage/interface.ts` lines 325-329 |

### 2.4 The one rule: every prefix must resolve

`SemanticAnnotationSchema` refuses a prefixed name whose prefix is neither declared in the
annotation's own `@context` nor carried by the node's default context (§3.0). This applies to
`@type`, to property keys, and to both inside nested nodes — a `schema:address` holding a
`weird:PostalAddress` is refused as readily as a bad type at the top.

Three things are deliberately NOT checked, because this node cannot know them:

- **whether the vocabulary really has that term.** `schema:Persson` passes. We hold nobody else's
  vocabulary and will not pretend to.
- **a bare name.** `"@type": "LocalBusiness"` resolves against the document's default vocabulary,
  which is how schema.org is written every day and how the CSM examples are written here.
- **what a value contains.** Only KEYS and `@type` are names; a URL, a timestamp or a ratio in a
  value may contain as many colons as it likes.

An annotation declares its own prefix the ordinary way, and then anything is allowed:

```json
{
  "@context": { "ex": "https://example.org/ontology/" },
  "@type": "ex:CustomDeviceReading",
  "ex:sensorId": "sensor-042"
}
```

A context declared once is in force all the way down, so a nested node inherits it.

**Where it is enforced:** `POST /v1/actions` and `PUT /v1/actions/:id` (through
`ActionPublishSchema` / `ActionUpdateSchema`), `PUT /v1/memory/:key/schema` (as
`INVALID_SEMANTIC_CONTEXT`, refused before anything is written), and `POST /v1/csm` (through
`validateCsm`, whose message names both the prefix and `service.semantic`).

### 2.5 A schema's per-field mappings name real fields

`semantic_context.properties` maps a FIELD of the schema to what that field means. A key in there
that the schema does not have describes nothing while reading as complete, so `PUT
/v1/memory/:key/schema` refuses it and the message names both the offending field and the fields the
schema does have. A schema with no `properties` of its own (an array, a `$ref`, a bare scalar type)
has no fields to map, and the check stands down rather than refusing everything.

## 3. Supported Ontologies

### 3.0 The default context, and the AIMEAT core

Eight prefixes resolve without being declared. They are the vocabularies this node already speaks
somewhere, and `GET /v1/ns` serves the list:

| Prefix | Namespace | What it carries here |
|---|---|---|
| `aimeat` | `https://aimeat.io/ns/` | this protocol's own classes and relations |
| `schema` | `https://schema.org/` | people, places, offers, creative works, actions |
| `skos` | `http://www.w3.org/2004/02/skos/core#` | concepts, hierarchy, multilingual labels, deprecation |
| `dcterms` | `http://purl.org/dc/terms/` | dates, titles, replacement |
| `prov` | `http://www.w3.org/ns/prov#` | what something was derived from, generated by, attributed to |
| `rdfs` | `http://www.w3.org/2000/01/rdf-schema#` | labels, comments, subclassing |
| `qudt` | `http://qudt.org/schema/qudt/` | quantities and units |
| `saref` | `https://saref.etsi.org/core/` | devices and sensors |

**`https://aimeat.io/ns/` now resolves.** It had been cited in six catalogue responses, three wallet
responses, the directory's semantic block and the interest-profile spec while serving nothing.
`GET /v1/ns` returns the core as JSON-LD; `GET /v1/ns.md` returns the same for a reader. Both are
public, because a peer node deciding whether it understands our records has no account here.

The core is a **hub, not a catalogue**. A class appears only when no standard vocabulary already
says it, and each one names the [glossary](/v1/glossary) term that defines it, so there is one text
rather than a machine copy that drifts from the human one. Classes: the three principals
(`GHII`, `GAII`, `GEAI`), `Node`, `MemoryRecord`, `Organism`, `Workspace`, `Document`,
`KnowledgePackage`, `App`, `Extension`, `Cortex`, `Skill`, `Capability`, `Task`, `Workflow`,
`Schedule`, `Offering`, `Need`, `Morsel`, `Peer`.

Relations come in inverse pairs, which is what makes the graph walkable from either end:
`canPerform`/`performedBy`, `provides`/`providedBy`, `assignedTo`/`handles`, plus `confidence`,
`availability` and `seeking`. Anything a standard vocabulary already names keeps that name —
`skos:broader` and `skos:narrower` for concepts, `prov:wasDerivedFrom` for where a conclusion came
from, `schema:about` for subject matter. Re-minting those under `aimeat:` is the mistake the SWARMs
ontology (Li et al., *Sensors* 2017, 17(3):569) made and listed as future work; the hub-and-modules
shape is that paper's, the refusal to reuse anything is not.

**A domain vocabulary links in through the core.** An app's, a cortex's or an organism's own sanasto
declares its `@type` as a kind of a core class or a schema.org class, and travels to the rest of the
graph along the relations above. Nothing about that requires editing the core.

AIMEAT does not restrict which ontologies can be used. The `@context` field accepts any valid JSON-LD context mapping. The following ontologies are used in the reference implementation:

### 3.1 Schema.org

- **Prefix:** `schema`
- **URI:** `https://schema.org/`
- **Usage:** Primary ontology for describing people, organizations, actions, offers, locations, and ratings
- **Types used in codebase:**
  - `schema:Person` — GHII profiles, directory entries
  - `schema:Organization` — Organisms, federation peers
  - `schema:SoftwareApplication` — Agents
  - `schema:Action` / custom action types — Published actions
  - `schema:Offer` — Marketplace listings
  - `schema:Place` / `schema:PostalAddress` — Location data
  - `schema:Rating` — Organism reputation scores
  - `schema:RecommendAction` — Match suggestions
  - `schema:DiscussionForumPosting` — Board posts
  - `schema:ItemList` — Boards

### 3.2 QUDT (Quantities, Units, Dimensions, Types)

- **Prefix:** `qudt`
- **URI:** `http://qudt.org/schema/qudt/`
- **Usage:** For IoT sensor data, measurement values, and scientific quantities stored in memory
- **Example types:** `qudt:QuantityValue`, `qudt:Unit`

### 3.3 SAREF (Smart Applications REFerence)

- **Prefix:** `saref`
- **URI:** `https://saref.etsi.org/core/`
- **Usage:** For IoT device descriptions and sensor capabilities in action definitions
- **Example types:** `saref:Device`, `saref:Sensor`, `saref:hasFunction`

### 3.4 SKOS (Simple Knowledge Organization System)

- **Prefix:** `skos`
- **URI:** `http://www.w3.org/2004/02/skos/core#`
- **Usage:** For taxonomy and classification of interests, categories, and tags
- **Example types:** `skos:Concept`, `skos:ConceptScheme`, `skos:broader`, `skos:narrower`

## 4. CSM Semantic Integration

Community Service Manifests (CSMs) carry an optional `semantic` block in their `service` definition. Defined in `aimeat/src/services/csm-parser.ts` (lines 25-37):

```typescript
export interface CsmDefinition {
  // ...
  service: {
    name: string;
    type: CsmServiceType;
    description: string;
    version: string;
    author?: string;
    semantic?: {
      '@context'?: Record<string, string>;
      '@type'?: string;
      [key: string]: unknown;
    };
  };
  // ...
}
```

When a CSM YAML file includes `service.semantic`, the parser preserves it (line 83-85):

```typescript
semantic: service?.semantic && typeof service.semantic === 'object'
  ? service.semantic as CsmDefinition['service']['semantic']
  : undefined,
```

### CSM Semantic Example

```yaml
service:
  name: hobby-directory
  type: directory
  description: Local hobby and interest directory
  version: "1.0"
  semantic:
    "@context":
      schema: "https://schema.org/"
      skos: "http://www.w3.org/2004/02/skos/core#"
    "@type": "schema:DataCatalog"
    "schema:about":
      "@type": "skos:ConceptScheme"
```

The CSM semantic annotation describes the **service itself** (e.g., "this service is a DataCatalog about a ConceptScheme"), while the records within the service carry their own `SemanticAnnotation` describing individual entries.

## 5. Record-to-Ontology Mapping Table

All AIMEAT records that carry a `semantic?` field, mapped to their typical ontology types:

| Record Type | Interface Location | `semantic` Field Type | Default `@type` | Ontology Properties |
|---|---|---|---|---|
| `AgentRecord` | `interface.ts:28` | `SemanticAnnotation` | `schema:SoftwareApplication` | `schema:applicationCategory`, `schema:featureList` |
| `ActionRecord` | `interface.ts:58` | `SemanticAnnotation` | `schema:Action` | `schema:object`, `schema:result`, `schema:instrument` |
| `BoardRecord` | `interface.ts:95` | `SemanticAnnotation` | `schema:ItemList` | `schema:itemListElement`, `schema:numberOfItems` |
| `BoardPostRecord` | `interface.ts:110` | `SemanticAnnotation` | `schema:DiscussionForumPosting` | `schema:author`, `schema:datePublished`, `schema:articleBody` |
| `GHIIRecord` | `interface.ts:223` | `SemanticAnnotation` | `schema:Person` | `schema:knowsAbout`, `schema:homeLocation` |
| `PersonalNodeRecord` | `interface.ts:266` | `SemanticAnnotation` | `schema:WebSite` | `schema:provider`, `schema:hasPart` |
| `OrganismRecord` | `interface.ts:425` | `Record<string, unknown>` | `schema:Organization` | `schema:areaServed`, `schema:knowsAbout`, `schema:memberOf` |
| `ListingRecord` | `interface.ts:470` | `Record<string, unknown>` | `schema:Offer` | `schema:priceCurrency`, `schema:price`, `schema:availability`, `schema:seller`, `schema:category` |

### Schema-level Semantic Context

| Record Type | Interface Location | Field | Default `@type` |
|---|---|---|---|
| `SchemaRecord` | `interface.ts:339` | `semanticContext?: SemanticContext` | Varies by schema target (e.g., `schema:Person` for profile schemas) |

### Runtime-Generated Semantic Annotations

Some endpoints generate semantic annotations at response time even when the record has no stored `semantic` field:

| Endpoint | Generated `@type` | Source File |
|---|---|---|
| `GET /v1/organisms/:id` | `schema:Organization` | `routes/organisms.ts:208-226` |
| `GET /v1/marketplace/listings/:id` | `schema:Offer` | `routes/marketplace.ts:198-206` |
| `GET /v1/organisms/:id/reputation` | `schema:Rating` | `routes/organisms.ts:741-747` |
| `POST /v1/federation/genesis-peers` | `schema:Organization` | `routes/federation.ts:1014-1018` |
| `GET /v1/directory/search` | `schema:Person` | `services/directory.ts:60-88` |

## 6. Usage Guidelines

### 6.1 Annotations Are Optional

Every `semantic` field in AIMEAT is optional (`semantic?`). Nodes that do not support semantic annotations simply omit the field. Consuming nodes must handle `undefined` or `null` semantic gracefully.

### 6.2 Valid JSON-LD

All semantic annotations produce valid JSON-LD when expanded, and this is enforced rather than asked
for (§2.4). The `@context` map must use short prefix keys that resolve to full namespace URIs:

```json
{
  "@context": {
    "schema": "https://schema.org/",
    "qudt": "http://qudt.org/schema/qudt/"
  },
  "@type": "schema:Action",
  "schema:instrument": "qudt:Sensor"
}
```

### 6.3 Federation Discovery

During federation catalogue sync (`/v1/federation/sync/catalogue`), semantic annotations are preserved on synced action records (`routes/federation.ts:616`). This allows a node to understand remote actions based on their ontology type without needing custom integration code.

When querying the catalogue (`/v1/catalogue`, `/v1/catalogue/actions`, `/v1/catalogue/agents`, `/v1/catalogue/boards`), all semantic annotations are included in responses (`routes/catalogue.ts:38,66,88,105`), enabling clients to filter or classify entries by their semantic type.

### 6.4 Schema Semantic Context

When setting a memory schema via `PUT /v1/memory/:key/schema`, include `semantic_context` in the request body to attach semantic meaning to the schema:

```json
{
  "schema": { "type": "object", "properties": { "temperature": { "type": "number" } } },
  "apply_to": "prefix",
  "schema_mode": "strict",
  "semantic_context": {
    "@context": { "qudt": "http://qudt.org/schema/qudt/", "schema": "https://schema.org/" },
    "@type": "schema:PropertyValue",
    "properties": {
      "temperature": { "@type": "qudt:QuantityValue", "qudt:unit": "qudt:DEG_C" }
    }
  }
}
```

The schema listing endpoint (`GET /v1/schemas`) indicates whether a schema has semantic context via the `has_semantic` boolean field (`routes/schemas.ts:139`).

### 6.5 Extending with Custom Ontologies

AIMEAT does not restrict the ontologies that can be used. Any valid JSON-LD context can be provided. For domain-specific use cases:

```json
{
  "@context": {
    "schema": "https://schema.org/",
    "ex": "https://example.org/ontology/"
  },
  "@type": "ex:CustomDeviceReading",
  "ex:sensorId": "sensor-042",
  "schema:dateCreated": "2026-01-15T10:30:00Z"
}
```

The `passthrough()` on the Zod schema (`models/schemas.ts:8`) ensures that arbitrary ontology-specific keys are accepted during validation.

## 7. Implementation Reference

| File | Lines | Content |
|---|---|---|
| `aimeat/src/utils/onto-context.ts` | whole file | The default context, the core classes and relations, `annotationErrors()`, `semanticContextErrors()`, `expandTerm()` |
| `aimeat/src/routes/ns.ts` | whole file | `GET /v1/ns` and `/v1/ns.md` |
| `aimeat/test/unit/onto-core.test.ts` | whole file | Every core class has a glossary definition; every inverse pairs both ways |
| `aimeat/test/e2e-ontology.ts` | whole file | The namespace resolves; both refusal doors; both happy paths |
| `aimeat/src/storage/interface.ts` | 1-6 | `SemanticAnnotation` interface definition |
| `aimeat/src/storage/interface.ts` | 325-329 | `SemanticContext` interface definition |
| `aimeat/src/storage/interface.ts` | 331-340 | `SchemaRecord` with `semanticContext` field |
| `aimeat/src/storage/interface.ts` | 28, 58, 95, 110, 223, 266 | Records with `semantic?: SemanticAnnotation` |
| `aimeat/src/storage/interface.ts` | 425, 470 | Records with `semantic?: Record<string, unknown>` |
| `aimeat/src/models/schemas.ts` | 5-8 | `SemanticAnnotationSchema` Zod validation |
| `aimeat/src/models/schemas.ts` | 107, 120 | Semantic in `ActionPublishSchema` and `ActionUpdateSchema` |
| `aimeat/src/services/csm-parser.ts` | 33-37 | CSM `semantic` field in `CsmDefinition.service` |
| `aimeat/src/services/csm-parser.ts` | 83-85 | CSM semantic parsing logic |
| `aimeat/src/services/directory.ts` | 50-88 | `buildDirectorySemantic()` for directory entries |
| `aimeat/src/services/profile-schemas.ts` | 84-106 | Profile schema seeding (no semantic context yet) |
| `aimeat/src/routes/schemas.ts` | 56-58 | Schema `semantic_context` handling on PUT |
| `aimeat/src/routes/schemas.ts` | 90 | Schema `semantic_context` in GET response |
| `aimeat/src/routes/schemas.ts` | 139 | `has_semantic` flag in schema listing |
| `aimeat/src/routes/actions.ts` | 70, 80, 135, 164, 205 | Action semantic passthrough |
| `aimeat/src/routes/catalogue.ts` | 38, 66, 88, 105, 259 | Catalogue semantic in responses |
| `aimeat/src/routes/boards.ts` | 89, 231, 331 | Board/post semantic in responses |
| `aimeat/src/routes/organisms.ts` | 207-226, 240 | Runtime `schema:Organization` annotation |
| `aimeat/src/routes/organisms.ts` | 741-747 | Runtime `schema:Rating` annotation |
| `aimeat/src/routes/marketplace.ts` | 195-206 | Runtime `schema:Offer` annotation |
| `aimeat/src/routes/matches.ts` | 57-62 | Runtime `schema:RecommendAction` annotation |
| `aimeat/src/routes/federation.ts` | 616 | Federated action semantic sync |
| `aimeat/src/routes/federation.ts` | 1014-1018 | Genesis peer `schema:Organization` annotation |
| `aimeat/src/routes/ghii.ts` | 783 | GHII semantic in response |
| `aimeat/src/routes/agents.ts` | 170, 250 | Agent semantic in responses |
