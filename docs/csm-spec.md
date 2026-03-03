# CSM Specification -- Community Service Manifest

*AIMEAT Protocol -- CSM Format v1.0*

---

## 1. Overview

A **Community Service Manifest** (CSM) is a declarative YAML document that defines a community service on an AIMEAT node. Each CSM describes the data schema, consent rules, moderation policy, and UI rendering hints for a single service instance. Nodes use the parsed CSM to generate JSON Schema for input validation (via Schema Locking), enforce consent and moderation at runtime, and provide layout guidance to rendering agents.

CSM governs **internal community data** (profiles, listings, posts, bids). It is separate from MSM (MEAT Service Manifest), which governs external API integrations.

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
| `type` | yes | string | `"directory"` | One of the eight valid service types (Section 5). |
| `description` | yes | string | -- | One-line summary. Must be non-empty. |
| `version` | no | string | `"1.0"` | Version of this service definition (not the CSM format). |
| `author` | no | string | -- | GAII of the service creator. |
| `semantic` | no | object | -- | Semantic annotation block (Section 10). |

---

## 5. Service Types

The `service.type` field must be one of exactly eight values:

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
| `enum` | string[] | string | Allowed values. |
| `format` | string | string | Format hint: `"uri"`, `"date-time"`, `"email"`. Passed to JSON Schema. |
| `items` | string or CsmFieldDef | array | Element type. String shorthand (e.g., `"string"`) expands to `{ type: <value> }`. |
| `properties` | Record\<string, CsmFieldDef\> | object | Nested field definitions. Each may include `required: boolean`. |
| `required` | boolean | nested properties | Whether this property is required in its parent object. Default: `true`. |

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
```

### 7.3 JSON Schema Generation

`csmToJsonSchema()` converts `data_schema` to standard JSON Schema:

1. Fields from `required` go into both `properties` and the `required` array.
2. Fields from `optional` go into `properties` only.
3. Each CsmFieldDef maps `min`/`max` to the appropriate JSON Schema keyword per type.
4. `schema_mode: "strict"` adds `"additionalProperties": false`.
5. For `object` fields, nested properties with `required !== false` are collected into a nested `required` array.

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

---

## 12. Validation Rules

`validateCsm()` returns an array of error strings. Empty array = valid CSM.

| Rule | Error Message |
|------|---------------|
| `csm` version non-empty | `"csm version is required"` |
| `service.name` non-empty | `"service.name is required"` |
| `service.type` non-empty | `"service.type is required"` |
| `service.type` is valid | `"service.type must be one of: directory, marketplace, forum, dating, news, opinion, auction, media"` |
| `service.description` non-empty | `"service.description is required"` |
| At least one required field | `"data_schema.required must have at least one field"` |
| Every field has a `type` | `"data_schema field \"<name>\" is missing type"` |
| `visibility_default` is valid | `"consent_requirements.visibility_default must be one of: private, federation, public"` |

**Not currently validated:** `data_retention` format, `auto_hide_threshold` range, `ui_hints` field names against `data_schema`, `semantic` content correctness.

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
