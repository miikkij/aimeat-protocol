# Cortex-Core PoC Design — Declarative Extension & Plugin System

**Date:** 2026-03-05
**Status:** Approved
**Approach:** Fixture-Driven Development
**Companion docs:** REQ-005-cortex-core-extension-system.md, REQ-005-companion-growth-ecosystem.md

---

## 1. Purpose

Cortex-Core enables users to package schemas, prompts, ontologies, actions, board templates, seed data, and client-side libraries into installable extensions. When an app is built in AI Chat, the AI references installed extensions instead of generating everything from scratch — keeping the context window small and apps more powerful.

This is separate from the existing V8-sandbox extension system (`/v1/extensions`), which handles server-side executable code. Cortex-Core is declarative-only on the server; client-side JS libs are served statically, never executed server-side.

---

## 2. Manifest Format (`cortex.yaml`)

Backstage-style structure with `apiVersion/kind/metadata/spec`:

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: recipe-collection
  namespace: jouni
  description: "Schema and prompts for managing a personal recipe collection"
  author: jouni
  license: MIT
  tags: [cooking, recipes, lifestyle]
  labels:
    domain: lifestyle
spec:
  version: "1.0.0"
  aimeat: ">=1.5"

  components:
    - type: schema
      name: recipe-schema
      key_pattern: "recipes/*"
      apply_to: prefix
      schema:
        type: object
        required: [title, ingredients, instructions]
        properties:
          title: { type: string, maxLength: 200 }
          cuisine: { type: string }
          ingredients:
            type: array
            items:
              type: object
              properties:
                name: { type: string }
                amount: { type: string }
          instructions: { type: string }
          prep_time_minutes: { type: integer }
          rating: { type: integer, minimum: 1, maximum: 5 }

    - type: prompt
      name: recipe-assistant
      content: |
        You are a recipe management assistant. The user's recipes are stored
        in AIMEAT memory under the key pattern "recipes/{recipe-slug}".
        When the user asks to save a recipe, extract the structured data
        and write it to memory.
      variables:
        - "{{node_url}}"
        - "{{owner_name}}"

    - type: action
      name: add-recipe
      description: "Add a new recipe to the collection"
      input_schema:
        type: object
        required: [title, ingredients, instructions]
        properties:
          title: { type: string }
          ingredients: { type: array, items: { type: string } }
          instructions: { type: string }

    - type: board-template
      name: recipe-sharing
      title: "Recipe Sharing"
      description: "Share and discuss recipes with the community"
      visibility: public
      seed_posts:
        - title: "Welcome to Recipe Sharing!"
          body: "Share your favorite recipes here."

    - type: ontology
      name: cooking-domain
      description: "Core concepts in cooking and recipe management"
      concepts:
        recipe:
          label: { en: "Recipe", fi: "Resepti" }
          properties: [title, ingredients, instructions, cuisine, prep_time]
        ingredient:
          label: { en: "Ingredient", fi: "Ainesosa" }
          broader: recipe
          properties: [name, amount, unit]
        cuisine:
          label: { en: "Cuisine", fi: "Keittiö" }
          values: [italian, french, japanese, finnish, thai]
        technique:
          label: { en: "Technique", fi: "Tekniikka" }
          related_to: recipe
          values: [baking, grilling, sauteing, steaming]

    - type: seed-data
      entries:
        - key: "recipes/example-pasta"
          value:
            title: "Simple Pasta Aglio e Olio"
            cuisine: italian
            ingredients:
              - { name: "spaghetti", amount: "400g" }
              - { name: "garlic", amount: "6 cloves" }
              - { name: "olive oil", amount: "100ml" }
            instructions: "Cook pasta. Sauté garlic in oil. Toss together."
            prep_time_minutes: 20
            rating: 4

    - type: lib
      name: aimeat-recipe-ui
      file: recipe-ui.js
      exports: [RecipeList, RecipeDetail, RecipeForm]
      api_surface: |
        RecipeList({ recipes, onSelect }) — renders recipe cards
        RecipeDetail({ recipe, onEdit }) — renders full recipe
        RecipeForm({ onSave }) — recipe input form
```

**Key decisions:**
- `namespace` + `name` = `@jouni/recipe-collection` (npm-style scoping)
- `apiVersion` enables future format evolution
- Ontology uses SKOS-lite YAML (concepts with labels, hierarchies) — no RDF
- Libs are client-side JS served statically, never executed server-side
- `api_surface` is the compact reference AI Chat uses in its context window

---

## 3. Data Model

### CortexExtensionRecord

```typescript
export interface CortexExtensionRecord {
  name: string;              // "@jouni/recipe-collection"
  namespace: string;         // "jouni"
  shortName: string;         // "recipe-collection"

  apiVersion: string;        // "cortex.aimeat.org/v1"
  version: string;           // SemVer "1.0.0"
  description: string;
  author: string;
  license?: string;
  tags: string[];
  labels: Record<string, string>;
  aimeatCompat?: string;     // ">=1.5"

  status: 'inactive' | 'active';
  installedAt: string;
  activatedAt?: string;
  installedBy: string;       // GAII/GHII of installer

  manifest: string;          // original YAML string

  components: CortexComponent[];

  activationArtifacts: {
    schemaKeys: string[];
    promptKeys: string[];
    actionIds: string[];
    boardIds: string[];
    seedDataKeys: string[];
    ontologyKeys: string[];
    libFiles: string[];
  };
}
```

### Component Types

```typescript
export type CortexComponent =
  | CortexSchemaComponent
  | CortexPromptComponent
  | CortexActionComponent
  | CortexBoardTemplateComponent
  | CortexOntologyComponent
  | CortexSeedDataComponent
  | CortexLibComponent;

export interface CortexSchemaComponent {
  type: 'schema';
  name: string;
  key_pattern: string;
  apply_to: 'prefix' | 'exact';
  schema: Record<string, unknown>;
}

export interface CortexPromptComponent {
  type: 'prompt';
  name: string;
  content: string;
  variables?: string[];
}

export interface CortexActionComponent {
  type: 'action';
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CortexBoardTemplateComponent {
  type: 'board-template';
  name: string;
  title: string;
  description: string;
  visibility: 'public' | 'private' | 'shared';
  seed_posts?: Array<{ title: string; body: string }>;
}

export interface CortexOntologyComponent {
  type: 'ontology';
  name: string;
  description: string;
  concepts: Record<string, {
    label: Record<string, string>;
    properties?: string[];
    broader?: string;
    related_to?: string;
    values?: string[];
  }>;
}

export interface CortexSeedDataComponent {
  type: 'seed-data';
  entries: Array<{ key: string; value: unknown }>;
}

export interface CortexLibComponent {
  type: 'lib';
  name: string;
  filename: string;
  exports: string[];
  api_surface: string;
  fileSize: number;
  reviewedInChat: boolean;
}
```

### Storage Interface Additions

```typescript
createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord>;
getCortexExtension(name: string): Promise<CortexExtensionRecord | null>;
listCortexExtensions(): Promise<CortexExtensionRecord[]>;
updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null>;
deleteCortexExtension(name: string): Promise<boolean>;

setCortexLibFile(extName: string, libName: string, content: Buffer): Promise<void>;
getCortexLibFile(extName: string, libName: string): Promise<Buffer | null>;
deleteCortexLibFile(extName: string, libName: string): Promise<boolean>;
```

---

## 4. API Endpoints

All routes under `/v1/cortex` via `cortexRouter(config, storage)`.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /v1/cortex` | any authed | List all installed extensions |
| `POST /v1/cortex` | owner/operator | Install (multipart: manifest + lib files) |
| `GET /v1/cortex/:name` | any authed | Get extension details |
| `DELETE /v1/cortex/:name` | owner/operator | Uninstall |
| `POST /v1/cortex/:name/activate` | owner/operator | Activate |
| `POST /v1/cortex/:name/deactivate` | owner/operator | Deactivate |
| `GET /v1/cortex/:name/prompts` | any authed | List prompts |
| `GET /v1/cortex/:name/prompts/:pname` | any authed | Get prompt content |
| `GET /v1/cortex/:name/ontology` | any authed | Get ontology data |
| `GET /v1/cortex/:name/libs/:libName.js` | public | Serve JS lib file |

### Install (multipart)

```
POST /v1/cortex
Content-Type: multipart/form-data

manifest: (YAML string)
lib:recipe-ui.js: (file upload)
```

### Activation Side Effects (in order)

1. **schema** → `storage.setSchema(key_pattern, jsonSchema, applyTo)`
2. **ontology** → `storage.setMemory("__cortex__/{ext}/ontology/{name}", concepts)`
3. **prompt** → `storage.setMemory("__cortex__/{ext}/prompts/{name}", content)`
4. **action** → `storage.createAction({ id, description, input_schema })`
5. **board-template** → `storage.createBoard()` + seed posts
6. **seed-data** → `storage.setMemory(key, value)` — validated against schema components
7. **lib** → `storage.setCortexLibFile(ext, name, content)` — served statically

### Deactivation (reverse order)

- Libs: removed from serving
- Seed-data: **kept** (user may have modified it)
- Board/actions/prompts/ontology/schemas: **removed**

All tracked via `activationArtifacts`.

### Idempotency

- Activate already-active: no-op
- Deactivate already-inactive: no-op
- Install already-installed: 409 Conflict

---

## 5. Security & Validation

### At Install Time

1. YAML parse — reject malformed YAML
2. Meta-schema validation — validate manifest structure against Cortex meta-schema
3. JSON Schema validation — schema components' embedded schemas validated against draft-07 meta-schema
4. Namespace ownership — `namespace` must match authenticated owner's name
5. Lib static checks (warnings, not blocking):
   - `eval(` or `new Function(`
   - `document.cookie` access
   - External `fetch()` / `XMLHttpRequest` to non-AIMEAT domains
6. Size limits — max manifest size, max lib file size, max total extension size

### At Activation Time

- No conflicting schema locks (another extension already locks the same key_pattern)
- No duplicate action IDs in catalogue

### Auth

- Install/activate/deactivate/uninstall: `requireRole('owner')` or `requireRole('operator')`
- Read endpoints: `requireAuth()` (any authenticated user)
- Lib serving: public (no auth, cacheable)

---

## 6. Fixture Files & Testing Strategy

### Fixture Extensions

| Fixture | Components | Purpose |
|---------|-----------|---------|
| `@test/recipe-collection` | All 7 types | Full lifecycle, all components |
| `@test/project-tracker` | schema, prompt, action, seed-data | Lifecycle without board/ontology/lib |
| `@test/research-assistant` | prompt, ontology | Knowledge-only extension |
| `@test/iot-dashboard` | schema, lib | Schema + lib without other components |

### E2E Test Phases

```
Phase 1: Manifest Parsing & Validation (6 tests)
  - Valid manifest installs
  - Invalid YAML rejected
  - Missing required fields rejected
  - Unknown component types rejected
  - Invalid JSON Schema rejected
  - Namespace mismatch rejected

Phase 2: Full Lifecycle (6 tests)
  - Install → inactive
  - List shows extension
  - Activate → active
  - Deactivate → inactive (artifacts removed, data kept)
  - Uninstall → fully removed
  - Re-install works

Phase 3: Schema Component (5 tests)
  - Active schema creates lock
  - Conforming write succeeds
  - Violating write returns 400
  - After deactivation, violating write succeeds
  - Existing data survives deactivation

Phase 4: Prompt Component (5 tests)
  - Prompt stored at __cortex__/{ext}/prompts/{name}
  - List prompts endpoint works
  - Get specific prompt works
  - Variable substitution works
  - Deactivation removes prompts

Phase 5: Action Component (2 tests)
  - Active action appears in catalogue
  - Deactivation removes from catalogue

Phase 6: Board Template Component (3 tests)
  - Activation creates board
  - Seed posts created
  - Deactivation removes board

Phase 7: Ontology Component (3 tests)
  - Ontology stored correctly
  - GET ontology returns concepts
  - Multi-language labels preserved

Phase 8: Seed Data Component (4 tests)
  - Entries written on activation
  - Entries validated against schema
  - Entries preserved on deactivation
  - Entries removed on uninstall

Phase 9: Lib Component (5 tests)
  - Multipart upload stores lib
  - GET serves JS with correct Content-Type
  - Cache headers set
  - Static safety warnings returned
  - Deactivation removes lib

Phase 10: Edge Cases & Conflicts (5 tests)
  - Duplicate name → 409
  - Activate non-existent → 404
  - Conflicting schema key_pattern → 409
  - Duplicate action ID → 409
  - Multiple extensions coexist

Total: ~44 tests
```

---

## 7. Research Insights Applied

| Decision | Inspired By |
|----------|-------------|
| Backstage-style `apiVersion/kind/metadata/spec` | Backstage, Kubernetes |
| `@owner/name` scoped naming | npm, shadcn/ui |
| `activationArtifacts` for clean lifecycle | WordPress, Shopware plugin lifecycle |
| SKOS-lite YAML ontologies (no RDF) | SKOS simplified |
| Lib static checks as warnings, not gates | REQ-005 companion doc philosophy |
| Fixture-driven testing | Helm chart testing patterns |
| Separate from V8 extensions system | Chrome MV3 declarative vs imperative split |
| `api_surface` for AI context management | REQ-005 companion thin-shell pattern |

---

## 8. Files to Create/Modify

### New Files
- `src/storage/interface.ts` — add CortexExtensionRecord + component types
- `src/storage/memory.ts` — implement CortexExtension + CortexLibFile maps
- `src/routes/cortex.ts` — all /v1/cortex endpoints
- `src/services/cortex-manifest.ts` — YAML parsing, meta-schema validation, lib static checks
- `test/cortex-e2e.ts` — fixture-driven E2E tests
- `test/fixtures/cortex/` — 4 fixture extension directories

### Modified Files
- `src/server.ts` — register cortexRouter
- `src/config.ts` — add cortex config options (max extensions, max lib size)

---

*Design approved: 2026-03-05*
*Authors: Jouni Miikki (direction), Claude Opus 4.6 (design & research)*
