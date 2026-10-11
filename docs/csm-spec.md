# CSM Specification -- Community Service Manifest

*AIMEAT Protocol -- CSM Format v1.0*

---

## Current parser limits

The [parser](../aimeat/src/services/csm-parser.ts) is the implementation authority.
A field limit can be written two ways, and both reach the compiled schema:
the short `min` and `max`, which the parser maps to the keyword the field's
type needs, or that JSON Schema keyword itself (`minLength`, `maxLength`,
`minimum`, `maximum`, `minItems`, `maxItems`). When a field states both, the
JSON Schema keyword wins. `default` and `description` are copied into the
compiled schema as written.

A nested property is required unless it says `required: false` or states a
`default`. An object field can instead list its required properties, as
JSON Schema does (`required: [amount]`), and that list then decides alone.

The parser reads only the keys this document lists. A key it does not read
(for example `pattern`, or a whole `economy` block) parses without an error
and has no effect.

The seven templates in `aimeat/docs/csm-examples` are the ones the node loads at boot.

## 1. Overview

A **Community Service Manifest** (CSM) is a declarative YAML document that defines a community service on an AIMEAT node. Each CSM describes the data schema, consent rules, moderation policy, and UI rendering hints for a single service instance. Nodes use the parsed CSM to generate JSON Schema for input validation (via Schema Locking), enforce consent and moderation at runtime, and provide layout guidance to rendering agents.

CSM governs **internal community data** (profiles, listings, posts, bids). It is separate from MSM (Machine Service Manifest), which governs external API integrations.

### Design Goals

- **Declarative.** No logic; describes *what* a service is, not *how* it runs.
- **AI-readable.** Field names, types, and constraints are explicit enough for an AI agent to generate forms, validate input, and build views.
- **Human-authorable.** Standard YAML, no custom syntax. Any text editor suffices.
- **Interoperable.** Nodes with matching `data_schema` definitions can federate their listings.

CSM files use the extension `.csm.yaml` by convention. The MIME type for API registration is `text/yaml` or `application/json`.

---

## 2. YAML Structure

| Key | Required | Type | Description |
|-----|----------|------|-------------|
| `csm` | yes | string | Format version. Currently `"1.0"`. |
| `service` | yes | object | Service identity and metadata. |
| `schema_mode` | no | string | `"open"` (default) or `"strict"`. |
| `data_schema` | yes | object | Field definitions for service data. |
| `consent_requirements` | no | object | Privacy and data governance rules. |
| `moderation` | no | object | Community safety configuration. |
| `ui_hints` | no | object | Rendering guidance for agents and portals. |

All YAML keys use **snake_case**. The parser converts to camelCase internally (e.g., `data_schema` becomes `dataSchema`).

---

## 3. `csm` -- Format Version

- **Type:** string | **Required:** yes | **Default:** `"1.0"`
- Must be a non-empty string. The only currently defined version is `"1.0"`.

---

## 4. `service` -- Service Block

| Field | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `name` | yes | string | -- | Human-readable service name. Any language. Must be non-empty. |
| `type` | yes | string | `"directory"` | Non-empty service type; Section 5 lists common examples. |
| `description` | yes | string | -- | One-line summary. Must be non-empty. |
| `version` | no | string | `"1.0"` | Version of this service definition (not the CSM format). |
| `author` | no | string | -- | GAII of the service creator. |
| `semantic` | no | object | -- | Semantic annotation block (Section 10). |

---

## 5. Service Types

The `service.type` field is a non-empty, free-form string. These are common examples:

| Type | Purpose |
|------|---------|
| `directory` | People, organizations, or things listed for discovery. |
| `marketplace` | Items for sale with prices and transactions. |
| `forum` | Threaded discussions, Q&A, opinion boards. |
| `dating` | Relationship-oriented profiles and matching. |
| `news` | Chronological content streams, announcements. |
| `opinion` | Polls, votes, sentiment collection. |
| `auction` | Time-limited bidding with reserve prices. |
| `media` | Video, audio, or image collections. |

---

## 6. `schema_mode` -- Schema Mode

- **Type:** string | **Required:** no | **Default:** `"open"`

| Value | Behavior |
|-------|----------|
| `open` | `additionalProperties` not set in JSON Schema (implicitly `true`). Custom fields accepted. |
| `strict` | `additionalProperties: false` in JSON Schema. Only defined fields accepted. |

Use `strict` for privacy-sensitive services (dating, compliance). Use `open` for organic extension (directories, marketplaces).

---

## 7. `data_schema` -- Data Schema and Field Type System

```yaml
data_schema:
  required:
    <field_name>: <CsmFieldDef>
  optional:
    <field_name>: <CsmFieldDef>
```

- **`required`** -- Mandatory fields. Included in the JSON Schema `required` array. Must contain at least one field.
- **`optional`** -- Accepted but not mandatory. In JSON Schema `properties` but not in `required`.

### 7.1 CsmFieldDef

| Property | Type | Applies To | Description |
|----------|------|------------|-------------|
| `type` | string | all | **Required.** One of: `string`, `number`, `integer`, `boolean`, `array`, `object`. |
| `min` | number | string, number, integer, array | Minimum. Maps to `minLength` / `minimum` / `minItems`. |
| `max` | number | string, number, integer, array | Maximum. Maps to `maxLength` / `maximum` / `maxItems`. |
| `minLength`, `maxLength` | number | string | Same as `min` / `max` on a string. Wins over them when both are given. |
| `minimum`, `maximum` | number | number, integer | Same as `min` / `max` on a number. Wins over them when both are given. |
| `minItems`, `maxItems` | number | array | Same as `min` / `max` on an array. Wins over them when both are given. |
| `default` | any | all | Copied into the compiled schema. A nested property with a default is optional. The node does not fill the value in on write. |
| `description` | string | all | Copied into the compiled schema. |
| `enum` | string[] | string | Allowed values. |
| `format` | string | string | Format hint: `"uri"`, `"date-time"`, `"email"`. Passed to JSON Schema. |
| `items` | string or CsmFieldDef | array | Element type. String shorthand (e.g., `"string"`) expands to `{ type: <value> }`. |
| `properties` | Record\<string, CsmFieldDef\> | object | Nested field definitions. |
| `required` | boolean | nested properties | `false` makes this property optional in its parent object. Default: required, unless the property states a `default`. |
| `required` | string[] | object | The names of this object's required properties. When present, it decides alone and the per-property flags are not read. Each name must be one of the object's properties. |

### 7.2 Type Examples

```yaml
# string with constraints
title: { type: string, min: 3, max: 200, format: uri }

# string with enum
category: { type: string, enum: ["a", "b", "c"] }

# number / integer with range
price: { type: number, min: 0, max: 10000 }

# boolean (no extra constraints)
anonymous: { type: boolean }

# array -- shorthand items
tags: { type: array, items: string, max: 10 }

# array -- nested object items
chapters:
  type: array
  items:
    type: object
    properties:
      title: { type: string }
      start_seconds: { type: number }

# object with optional nested properties
location:
  type: object
  properties:
    city: { type: string }
    area: { type: string, required: false }

# the same limits in JSON Schema names, and an object-level required list
summary: { type: string, minLength: 10, maxLength: 500 }
asking_price:
  type: object
  properties:
    amount: { type: number, minimum: 0 }
    currency: { type: string, default: "EUR" }
  required: [amount]
```

### 7.3 JSON Schema Generation

`csmToJsonSchema()` converts `data_schema` to standard JSON Schema:

1. Fields from `required` go into both `properties` and the `required` array.
2. Fields from `optional` go into `properties` only.
3. Each CsmFieldDef maps `min`/`max` to the appropriate JSON Schema keyword per type. A JSON Schema keyword written on the field (`minLength` and the rest) is used as it is, and wins over `min`/`max`.
4. `schema_mode: "strict"` adds `"additionalProperties": false`.
5. For `object` fields, a `required: [names]` list becomes the nested `required` array as it is. Without a list, the nested properties that neither say `required: false` nor state a `default` are collected into it.
6. `default` and `description` are copied into the field's schema.

---

## 8. `consent_requirements` -- Consent Requirements

| Field (YAML) | Type | Default | Description |
|--------------|------|---------|-------------|
| `visibility_default` | string | `"federation"` | `"private"` (local only), `"federation"` (federated nodes), or `"public"` (no auth). |
| `requires_consent` | boolean | `true` | Whether explicit user consent is needed before storing data. |
| `consent_purpose` | string | `""` | Human-readable label for why data is collected. |
| `data_retention` | string | `"until_revoked"` | Retention period: `"until_revoked"`, or time-bounded (e.g., `"30d"`, `"90d"`, `"365d"`). |

---

## 9. `moderation` -- Moderation

| Field (YAML) | Type | Default | Description |
|--------------|------|---------|-------------|
| `flags_enabled` | boolean | `true` | Whether community members can flag content. |
| `auto_hide_threshold` | number | `5` | Flags needed to auto-hide content. Lower = stricter. |
| `appeals_enabled` | boolean | `false` | Whether users can appeal moderation decisions. |

Recommended thresholds: **2** for dating/high-sensitivity, **3** for marketplaces/forums, **5** for directories/news.

---

## 10. `ui_hints` -- UI Hints

| Field (YAML) | Type | Description |
|--------------|------|-------------|
| `list_view` | string[] | Fields for browse/list view. Default: `[]`. |
| `detail_view` | string[] | Fields for detail page. Default: `[]`. |
| `search_fields` | string[] | Searchable/filterable fields. Default: `[]`. |
| `sort_options` | string[] | Sortable fields. Optional. |
| `card_image_field` | string | Field name for card thumbnail. Optional. |

Use dot notation for nested fields: `"location.city"`, `"price.amount"`.

---

## 11. Semantic Annotations

The optional `semantic` block inside `service` provides JSON-LD annotations:

```yaml
service:
  semantic:
    "@context":
      schema: "https://schema.org/"
    "@type": "LocalBusiness"
```

| Field | Type | Description |
|-------|------|-------------|
| `@context` | Record\<string, string\> | Namespace prefix mappings. |
| `@type` | string | Semantic type (e.g., `"LocalBusiness"`, `"Product"`). |

Additional keys are permitted and passed through. The parser accepts `semantic` only if it is a non-null object; otherwise it is set to `undefined`.

**Every prefix must resolve.** A prefixed name (`shop:Directory`) is refused unless `shop` is
declared in this block's own `@context` or is one the node carries by default: `aimeat`, `schema`,
`skos`, `dcterms`, `prov`, `rdfs`, `qudt`, `saref`. `GET /v1/ns` lists them, along with the classes
`aimeat:` names. A bare type (`"@type": "LocalBusiness"`, as above) is always accepted: it resolves
against the document's default vocabulary rather than a prefix.

This is checked because the block does not stay in the manifest. Registration copies it onto the
memory key's `semanticContext`, where a consumer reads it as the node's own statement about what the
data means, so a prefix that expands to nothing would be published under this node's name.

---

## 12. Validation Rules

`validateCsm()` returns an array of error strings. Empty array = valid CSM.

| Rule | Error Message |
|------|---------------|
| `csm` version non-empty | `"csm version is required"` |
| `service.name` non-empty | `"service.name is required"` |
| `service.type` non-empty | `"service.type is required"` |
| `service.description` non-empty | `"service.description is required"` |
| At least one required field | `"data_schema.required must have at least one field"` |
| Every field has a `type` | `"data_schema field \"<name>\" is missing type"` |
| An object's `required` list names only its own properties | `"data_schema field \"<path>\": required names \"<name>\", which is not one of its properties"` |
| `visibility_default` is valid | `"consent_requirements.visibility_default must be one of: private, dmz, local, federation, public"` |
| Every prefix in `service.semantic` resolves | `"service.semantic: \"@type\": \"shop:Directory\" uses the prefix \"shop:\", which no @context defines…"` |

**Not currently validated:** `data_retention` format, `auto_hide_threshold` range, `ui_hints` field names against `data_schema`. The semantic block's prefixes are checked (above); whether a vocabulary really has the term named is not, and cannot be — this node does not hold anyone else's vocabulary.

---

## 13. Complete Example

```yaml
csm: "1.0"

service:
  name: "Hobby Directory"
  type: "directory"
  description: "Find hobbies and like-minded people near you"
  version: "1.0"

schema_mode: "open"

data_schema:
  required:
    name:
      type: string
      min: 1
      max: 200
    category:
      type: string
      enum: ["nature", "sports", "art", "music", "technology", "food", "other"]
  optional:
    description:
      type: string
      max: 2000
    website:
      type: string
      format: uri

consent_requirements:
  visibility_default: "federation"
  requires_consent: true
  consent_purpose: "community-discovery"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["name", "category"]
  detail_view: ["name", "description", "category", "website"]
  search_fields: ["name", "category"]
```

---

*CSM Specification v1.0 -- AIMEAT Protocol*

*Overscale Solutions Oy, 2026*
