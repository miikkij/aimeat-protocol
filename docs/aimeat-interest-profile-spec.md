# AIMEAT Interest Profile Specification

**Version:** 1.0
**Status:** Active
**Phase:** 0.4 (Foundation)
**Date:** 2026-03-03

---

## 1. Overview

The AIMEAT Interest Profile is a standardized set of memory fields that describe human users on an AIMEAT node. Each field is stored as a regular memory entry under a well-known key pattern and validated by the Schema Locking system (Phase 0.1).

**Purpose:**

- Enable AI-assisted matching between users who share interests, location, or goals.
- Provide a consistent data structure for directory listings and discovery endpoints.
- Guarantee interoperability across AIMEAT nodes in a federation so that profiles created on one node can be understood by any other node.

**Design principles:**

- No new API endpoints. Profiles are read and written through the existing Memory API (`POST /v1/memory`, `GET /v1/memory/:key`, `GET /v1/memory?prefix=`).
- Schema enforcement via the Schema Locking system ensures all nodes validate profile data identically.
- Consent Layer (Phase 0.3) controls who can see which profile fields.

---

## 2. Memory Key Pattern

All profile fields follow the key pattern:

```
profile.{owner}.{field}
```

| Segment   | Description |
|-----------|-------------|
| `profile` | Fixed prefix identifying this as a profile entry. |
| `{owner}` | The owner name (e.g. `alice`), not the full GAII or GHII. The owner name is shorter and more readable in keys. The memory entry is already bound to the agent's GAII via the `ownerGaii` field. |
| `{field}` | One of the 6 standardized field names defined below. |

**Examples:**

```
profile.alice.interests
profile.alice.location
profile.bob.bio
profile.bob.availability
```

Note: `display_name` and `avatar` are NOT stored as profile fields. They already exist in the `GHIIRecord` (`displayName`, `avatar`) and duplicating them would create synchronization problems.

---

## 3. Field Definitions

The profile standard defines exactly 6 fields. Each field has a JSON Schema that is enforced by the Schema Locking system.

### 3.1 `interests`

An array of free-text strings describing hobbies, skills, topics, or areas of interest.

| Property    | Value |
|-------------|-------|
| Type        | `array` of `string` |
| Min items   | 1 |
| Max items   | 50 |
| Item min length | 1 character |
| Item max length | 100 characters |

**JSON Schema:**

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "minLength": 1,
    "maxLength": 100
  },
  "minItems": 1,
  "maxItems": 50
}
```

**Example value:**

```json
["birdwatching", "retro gaming", "cooking", "TypeScript"]
```

### 3.2 `location`

An object describing the user's geographical location. Only `city` is required; all other properties are optional.

| Property  | Type     | Required | Constraints |
|-----------|----------|----------|-------------|
| `city`    | `string` | Yes      | 1-100 characters |
| `country` | `string` | No       | 2-3 characters (ISO 3166-1 alpha-2 or alpha-3) |
| `area`    | `string` | No       | Max 100 characters (neighborhood, district, region) |
| `geo`     | `array`  | No       | Exactly 2 numbers: `[latitude, longitude]` |

Additional properties are allowed (`additionalProperties: true`) to support future extensions.

**JSON Schema:**

```json
{
  "type": "object",
  "required": ["city"],
  "properties": {
    "country": { "type": "string", "minLength": 2, "maxLength": 3 },
    "city": { "type": "string", "minLength": 1, "maxLength": 100 },
    "area": { "type": "string", "maxLength": 100 },
    "geo": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 2,
      "maxItems": 2,
      "description": "[latitude, longitude]"
    }
  },
  "additionalProperties": true
}
```

**Example value:**

```json
{
  "city": "Helsinki",
  "country": "FI",
  "area": "Kallio",
  "geo": [60.1842, 24.9496]
}
```

### 3.3 `bio`

A free-text self-description.

| Property    | Value |
|-------------|-------|
| Type        | `string` |
| Min length  | 1 character |
| Max length  | 500 characters |

**JSON Schema:**

```json
{
  "type": "string",
  "minLength": 1,
  "maxLength": 500
}
```

**Example value:**

```json
"Nature enthusiast and tech hobbyist. I build things with TypeScript and go birdwatching on weekends."
```

### 3.4 `seeking`

An array of strings describing what the user is looking for -- collaborators, hobby partners, project ideas, etc. This field may be empty (0 items).

| Property    | Value |
|-------------|-------|
| Type        | `array` of `string` |
| Min items   | 0 (implicit) |
| Max items   | 20 |
| Item max length | 200 characters |

**JSON Schema:**

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "maxLength": 200
  },
  "maxItems": 20
}
```

**Example value:**

```json
["like-minded hobbyists", "project collaborators", "someone to practice Finnish with"]
```

### 3.5 `availability`

A string enum indicating when the user is available for contact or activities.

| Property    | Value |
|-------------|-------|
| Type        | `string` (enum) |
| Allowed values | `anytime`, `evenings`, `weekends`, `evenings-weekends`, `by-appointment`, `not-available` |

**JSON Schema:**

```json
{
  "type": "string",
  "enum": [
    "anytime",
    "evenings",
    "weekends",
    "evenings-weekends",
    "by-appointment",
    "not-available"
  ],
  "description": "When the person is available for contact/activities"
}
```

**Enum semantics:**

| Value               | Meaning |
|---------------------|---------|
| `anytime`           | Generally available, no strong time restrictions. |
| `evenings`          | Prefers evenings only. |
| `weekends`          | Prefers weekends only. |
| `evenings-weekends` | Available evenings and weekends. |
| `by-appointment`    | Available but prefers to arrange meetings in advance. |
| `not-available`     | Not currently available for contact. |

### 3.6 `languages`

An array of language codes the user speaks or understands, using ISO 639-1 codes with an optional ISO 3166-1 region suffix.

| Property    | Value |
|-------------|-------|
| Type        | `array` of `string` |
| Min items   | 1 |
| Max items   | 20 |
| Item min length | 2 characters |
| Item max length | 5 characters |
| Item pattern | `^[a-z]{2,3}(-[A-Z]{2})?$` |

**JSON Schema:**

```json
{
  "type": "array",
  "items": {
    "type": "string",
    "minLength": 2,
    "maxLength": 5,
    "pattern": "^[a-z]{2,3}(-[A-Z]{2})?$",
    "description": "ISO 639-1 language code, optionally with region (e.g. fi, en, sv, en-US)"
  },
  "minItems": 1,
  "maxItems": 20
}
```

**Example value:**

```json
["fi", "en", "sv", "en-US"]
```

---

## 4. Schema Enforcement

Profile schemas are enforced through the Schema Locking system (Phase 0.1). At server startup, the `seedProfileSchemas()` function in `src/services/profile-schemas.ts` registers one schema per profile field.

### 4.1 Seeding Process

1. The function iterates over the 6 standard field definitions.
2. For each field, it constructs a key pattern `profile.*.{field}` (e.g. `profile.*.interests`).
3. It checks whether a schema already exists for that pattern via `storage.getSchema(keyPattern, 'prefix')`.
4. If no schema exists, it creates one with:
   - `applyTo: 'prefix'` -- the schema applies to any memory key matching the prefix pattern.
   - `schemaMode: 'open'` -- allows additional properties (relevant for `location`).
   - `lockedBy: 'system@{nodeId}'` -- indicates the schema was set by the system at startup.
5. If a schema already exists (e.g. an operator has customized it), the seed is skipped. This makes the function idempotent.

### 4.2 Startup Integration

In `src/server.ts`, the seed function is called after storage is initialized:

```typescript
seedProfileSchemas(storage, `system@${config.nodeId}`)
  .then(count => { if (count > 0) logger.info(`Seeded ${count} profile schemas`); })
  .catch(err => logger.error('Failed to seed profile schemas', { error: err }));
```

### 4.3 Validation Behavior

When an agent writes a memory entry with a key like `profile.alice.interests`, the memory route handler finds the applicable schema (`profile.*.interests`) and validates the value against it. If validation fails, the server responds with `422 SCHEMA_VALIDATION_FAILED`.

**Examples of rejected writes:**

| Key | Value | Rejection Reason |
|-----|-------|------------------|
| `profile.alice.interests` | `"just a string"` | Expected `array`, got `string` |
| `profile.alice.location` | `{ "area": "Kallio" }` | Missing required property `city` |
| `profile.alice.bio` | *(501-character string)* | Exceeds `maxLength: 500` |
| `profile.alice.availability` | `"mornings"` | Not in the allowed enum values |
| `profile.alice.languages` | `["english"]` | Does not match pattern `^[a-z]{2,3}(-[A-Z]{2})?$` |

### 4.4 Operator Customization

An operator may replace or extend the default schemas after startup via the Schema Locking API (`PUT /v1/schemas`). Because `seedProfileSchemas()` checks for existing schemas before writing, operator customizations survive server restarts.

---

## 5. Consent Model

Profile data visibility is controlled by the Consent Layer (Phase 0.3). By default, memory entries are private. To make profile fields visible to others, the data owner must grant explicit consent.

### 5.1 Full Profile Consent

To share an entire profile with all users across the federation:

```json
{
  "data_pattern": "profile.alice.*",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation",
  "expires": null
}
```

| Field          | Description |
|----------------|-------------|
| `data_pattern` | Glob pattern matching all of alice's profile fields. |
| `recipient`    | `"*"` means any authenticated agent or user. |
| `purpose`      | Free-form label. `"discovery"` indicates the data is shared for matching and directory use. |
| `scope`        | `"federation"` makes the data available to federated peer nodes. Other options: `"dmz"` (accessible from outside the node boundary but not federated) or `"private"` (local node only). |
| `expires`      | `null` for indefinite consent. Set an ISO 8601 timestamp for time-limited sharing. |

### 5.2 Granular Consent

Users may share only specific profile fields. For example, sharing only interests and languages while keeping bio and location private:

```json
{
  "data_pattern": "profile.alice.interests",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation"
}
```

```json
{
  "data_pattern": "profile.alice.languages",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation"
}
```

With this setup, other users can discover alice based on shared interests and language compatibility, but her bio, location, seeking, and availability remain hidden.

### 5.3 Recipient Wildcards and Specificity

The `recipient` field supports several forms:

| Recipient Value | Meaning |
|-----------------|---------|
| `"*"` | Any authenticated identity. |
| `"agent-name#owner@node-id"` | A specific agent (GAII). |
| `"organism.{id}"` | All members of a specific organism (community group). |

### 5.4 Scope Options

| Scope        | Visibility |
|--------------|------------|
| `private`    | Only accessible within the local node. |
| `dmz`        | Accessible from outside the node boundary (e.g. via public portal) but not replicated to federation peers. |
| `federation` | Replicated and searchable across all federated peer nodes. |

### 5.5 Consent Without Profile Data

If consent exists but the corresponding profile memory entry has not been written, reads simply return no data. Consent alone does not create data.

---

## 6. Example: Creating and Sharing a Profile

This section shows a complete workflow for writing a profile and making it discoverable.

### 6.1 Write Profile Fields

All writes use the standard Memory API. The agent must be authenticated as an agent belonging to the owner.

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.interests",
  "value": ["birdwatching", "TypeScript", "retro gaming"],
  "visibility": "public"
}
```

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.location",
  "value": {
    "city": "Helsinki",
    "country": "FI",
    "area": "Kallio",
    "geo": [60.1842, 24.9496]
  },
  "visibility": "public"
}
```

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.bio",
  "value": "Nature enthusiast and tech hobbyist.",
  "visibility": "public"
}
```

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.languages",
  "value": ["fi", "en", "sv"],
  "visibility": "public"
}
```

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.availability",
  "value": "evenings-weekends",
  "visibility": "public"
}
```

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.seeking",
  "value": ["like-minded hobbyists", "TypeScript project collaborators"],
  "visibility": "public"
}
```

### 6.2 Grant Consent for Discovery

Share the full profile across the federation:

```http
POST /v1/consent
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "data_pattern": "profile.alice.*",
  "recipient": "*",
  "purpose": "discovery",
  "scope": "federation"
}
```

### 6.3 Read a Profile

Any authenticated agent (with matching consent) can read individual fields:

```http
GET /v1/memory/profile.alice.interests
Authorization: Bearer <other-agent-jwt>
```

Or retrieve all profile fields at once using prefix listing:

```http
GET /v1/memory?prefix=profile.alice
Authorization: Bearer <other-agent-jwt>
```

### 6.4 Update a Profile Field

Overwrite an existing field by posting to the same key:

```http
POST /v1/memory
Authorization: Bearer <agent-jwt>
Content-Type: application/json

{
  "key": "profile.alice.interests",
  "value": ["birdwatching", "TypeScript", "retro gaming", "photography"],
  "visibility": "public"
}
```

The memory version is incremented automatically.

---

## 7. Summary of Standardized Fields

| Field          | Key Pattern              | Type       | Required Items / Length | Notes |
|----------------|--------------------------|------------|------------------------|-------|
| `interests`    | `profile.*.interests`    | `string[]` | 1-50 items, 1-100 chars each | Hobbies, skills, topics |
| `location`     | `profile.*.location`     | `object`   | `city` required, others optional | Supports geo coordinates |
| `bio`          | `profile.*.bio`          | `string`   | 1-500 chars | Self-description |
| `seeking`      | `profile.*.seeking`      | `string[]` | 0-20 items, max 200 chars each | What the user is looking for |
| `availability` | `profile.*.availability` | `string`   | Enum of 6 values | Contact availability |
| `languages`    | `profile.*.languages`    | `string[]` | 1-20 items, ISO 639-1 pattern | Spoken/understood languages |

---

## 8. Semantic Ontology Mapping

Profile data aligns with [Schema.org](https://schema.org/) ontologies to enable interoperability with linked data systems and external semantic tools. This section defines recommended mappings for each profile field.

### 8.1 Top-level type

An AIMEAT interest profile maps to `schema:Person`. When the Directory Service (Phase 1.4) builds semantic annotations for profile search results, it uses:

```json
{
  "@context": {
    "schema": "https://schema.org/"
  },
  "@type": "schema:Person"
}
```

### 8.2 Field-to-property mapping

| Profile Field  | Schema.org Property | Notes |
|----------------|---------------------|-------|
| `interests`    | `schema:knowsAbout` | Array of topic strings. Alternatively `schema:interestName` from the `InteractionCounter` type, but `knowsAbout` is more direct. |
| `location`     | `schema:address` → `schema:PostalAddress` | Sub-fields: `city` → `schema:addressLocality`, `country` → `schema:addressCountry`, `area` → `schema:addressRegion`. |
| `location.geo` | `schema:geo` → `schema:GeoCoordinates` | `geo[0]` → `schema:latitude`, `geo[1]` → `schema:longitude`. |
| `bio`          | `schema:description` | Free-text description of the person. |
| `seeking`      | `schema:seeks` | Array of strings. The `schema:seeks` property expects a `Demand` object, but for simplicity AIMEAT uses plain strings. |
| `availability` | `schema:availability` | Enum string. Not a direct Schema.org match — custom extension under the `aimeat` namespace. |
| `languages`    | `schema:knowsLanguage` | ISO 639-1 codes map to Schema.org `Language` type identifiers. |

### 8.3 Composite semantic annotation

When the Directory Service returns a profile in search results, it constructs a full semantic annotation combining the above mappings:

```json
{
  "@context": {
    "schema": "https://schema.org/",
    "aimeat": "https://aimeat.io/ns/"
  },
  "@type": "schema:Person",
  "schema:knowsAbout": ["birdwatching", "TypeScript"],
  "schema:address": {
    "@type": "schema:PostalAddress",
    "schema:addressLocality": "Helsinki",
    "schema:addressCountry": "FI"
  },
  "schema:geo": {
    "@type": "schema:GeoCoordinates",
    "schema:latitude": 60.1842,
    "schema:longitude": 24.9496
  },
  "schema:description": "Nature enthusiast and tech hobbyist.",
  "schema:knowsLanguage": ["fi", "en", "sv"]
}
```

This annotation is generated automatically by the `buildSemanticAnnotation()` function in `src/services/directory.ts` and included in the `semantic` field of directory search results.

### 8.4 Extension properties

The `aimeat` namespace (`https://aimeat.io/ns/`) is used for properties that have no direct Schema.org equivalent:

| Custom Property             | Profile Field    | Description |
|-----------------------------|------------------|-------------|
| `aimeat:availability`       | `availability`   | Contact availability enum. |
| `aimeat:seeking`            | `seeking`        | Free-text array of goals/desires. |

Consumers that do not understand the `aimeat` namespace can safely ignore these properties.

---

*AIMEAT -- AI Memory Exchange and Action Transfer*

Overscale Solutions Oy, 2026
