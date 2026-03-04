# Cortex-Core PoC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Cortex-Core declarative extension system with all 7 component types, fixture-driven E2E tests, and clean lifecycle management.

**Architecture:** New `/v1/cortex` routes (separate from existing `/v1/extensions`) backed by a `CortexExtensionRecord` in the Storage layer. YAML manifests are parsed by a dedicated service. Activation reuses existing storage methods (setSchema, setMemory, createAction, createBoard). Libs are stored as base64 strings (same pattern as existing extensions' scripts).

**Tech Stack:** TypeScript, Express 5, AJV for JSON Schema validation, `yaml` package for YAML parsing, existing AIMEAT auth/envelope middleware.

**Design doc:** `docs/plans/2026-03-05-cortex-core-poc-design.md`

---

## Task 1: Create Fixture Extension Files

**Files:**
- Create: `aimeat/test/fixtures/cortex/recipe-collection.yaml`
- Create: `aimeat/test/fixtures/cortex/recipe-ui.js`
- Create: `aimeat/test/fixtures/cortex/project-tracker.yaml`
- Create: `aimeat/test/fixtures/cortex/research-assistant.yaml`
- Create: `aimeat/test/fixtures/cortex/iot-dashboard.yaml`
- Create: `aimeat/test/fixtures/cortex/iot-sensor-ui.js`

These fixtures ARE the spec. Every fixture must work end-to-end when the implementation is done.

**Step 1: Create fixture directory and recipe-collection.yaml**

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: recipe-collection
  namespace: test
  description: "Schema and prompts for managing a personal recipe collection"
  author: test
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
        You are a recipe management assistant for {{node_url}}.
        The user's recipes are stored in AIMEAT memory under "recipes/{slug}".
        When the user asks to save a recipe, extract structured data and write it.
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

    - type: seed-data
      entries:
        - key: "recipes/example-pasta"
          value:
            title: "Simple Pasta Aglio e Olio"
            cuisine: italian
            ingredients:
              - { name: "spaghetti", amount: "400g" }
              - { name: "garlic", amount: "6 cloves" }
            instructions: "Cook pasta. Sauté garlic in oil. Toss together."
            prep_time_minutes: 20
            rating: 4

    - type: lib
      name: recipe-ui
      file: recipe-ui.js
      exports: [RecipeList, RecipeDetail, RecipeForm]
      api_surface: |
        RecipeList({ recipes, onSelect }) — renders recipe cards
        RecipeDetail({ recipe, onEdit }) — renders full recipe
        RecipeForm({ onSave }) — recipe input form
```

**Step 2: Create recipe-ui.js (minimal lib fixture)**

```javascript
// recipe-ui.js — Cortex lib fixture for testing
(function(AIMEAT) {
  function RecipeList({ recipes, onSelect }) {
    const container = document.createElement('div');
    container.className = 'recipe-list';
    recipes.forEach(r => {
      const card = document.createElement('div');
      card.textContent = r.title;
      card.onclick = () => onSelect(r);
      container.appendChild(card);
    });
    return container;
  }

  function RecipeDetail({ recipe, onEdit }) {
    const el = document.createElement('div');
    el.innerHTML = `<h2>${recipe.title}</h2><p>${recipe.instructions}</p>`;
    return el;
  }

  function RecipeForm({ onSave }) {
    const form = document.createElement('form');
    form.innerHTML = '<input name="title" placeholder="Recipe title">';
    form.onsubmit = (e) => { e.preventDefault(); onSave(Object.fromEntries(new FormData(form))); };
    return form;
  }

  AIMEAT.register('recipe-ui', { RecipeList, RecipeDetail, RecipeForm });
})(window.AIMEAT || (window.AIMEAT = {}));
```

**Step 3: Create project-tracker.yaml**

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: project-tracker
  namespace: test
  description: "Schema for task and milestone tracking"
  author: test
  tags: [productivity, projects]
  labels:
    domain: work
spec:
  version: "1.0.0"

  components:
    - type: schema
      name: task-schema
      key_pattern: "tasks/*"
      apply_to: prefix
      schema:
        type: object
        required: [title, status]
        properties:
          title: { type: string }
          status: { type: string, enum: [todo, in_progress, done] }
          assignee: { type: string }
          due_date: { type: string, format: date }

    - type: prompt
      name: project-assistant
      content: |
        You are a project management assistant.
        Tasks are stored under "tasks/{task-slug}".
        Help users create, update, and track their tasks.

    - type: action
      name: create-task
      description: "Create a new task"
      input_schema:
        type: object
        required: [title]
        properties:
          title: { type: string }
          assignee: { type: string }

    - type: seed-data
      entries:
        - key: "tasks/example-task"
          value:
            title: "Set up project"
            status: todo
```

**Step 4: Create research-assistant.yaml**

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: research-assistant
  namespace: test
  description: "Prompts and ontology for academic research"
  author: test
  tags: [research, academic]
  labels:
    domain: education
spec:
  version: "1.0.0"

  components:
    - type: prompt
      name: source-verifier
      content: |
        You verify academic sources. Check citations for accuracy,
        identify potential biases, and rate source reliability.

    - type: ontology
      name: research-domain
      description: "Concepts in academic research methodology"
      concepts:
        source:
          label: { en: "Source", fi: "Lähde" }
          properties: [title, authors, year, doi, reliability_score]
        citation:
          label: { en: "Citation", fi: "Viittaus" }
          broader: source
          properties: [format, page_range]
        methodology:
          label: { en: "Methodology", fi: "Metodologia" }
          values: [quantitative, qualitative, mixed_methods, meta_analysis]
        finding:
          label: { en: "Finding", fi: "Löydös" }
          related_to: source
          properties: [summary, confidence_level]
```

**Step 5: Create iot-dashboard.yaml and iot-sensor-ui.js**

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: iot-dashboard
  namespace: test
  description: "Schema and UI for IoT sensor data"
  author: test
  tags: [iot, sensors, dashboard]
  labels:
    domain: technology
spec:
  version: "1.0.0"

  components:
    - type: schema
      name: sensor-reading-schema
      key_pattern: "sensors/*"
      apply_to: prefix
      schema:
        type: object
        required: [sensor_id, value, timestamp]
        properties:
          sensor_id: { type: string }
          value: { type: number }
          unit: { type: string }
          timestamp: { type: string }

    - type: lib
      name: sensor-ui
      file: iot-sensor-ui.js
      exports: [SensorGauge, SensorHistory]
      api_surface: |
        SensorGauge({ value, unit, min, max }) — circular gauge display
        SensorHistory({ readings }) — time-series chart
```

```javascript
// iot-sensor-ui.js — Cortex lib fixture for testing
(function(AIMEAT) {
  function SensorGauge({ value, unit, min, max }) {
    const el = document.createElement('div');
    el.className = 'sensor-gauge';
    el.textContent = `${value} ${unit}`;
    return el;
  }

  function SensorHistory({ readings }) {
    const el = document.createElement('div');
    el.className = 'sensor-history';
    el.textContent = `${readings.length} readings`;
    return el;
  }

  AIMEAT.register('sensor-ui', { SensorGauge, SensorHistory });
})(window.AIMEAT || (window.AIMEAT = {}));
```

**Step 6: Commit fixtures**

```bash
git add aimeat/test/fixtures/cortex/
git commit -m "test: add Cortex-Core fixture extensions for PoC"
```

---

## Task 2: Add Storage Types to interface.ts

**Files:**
- Modify: `aimeat/src/storage/interface.ts` (add types after line ~620, add methods before line ~949)

**Step 1: Add CortexExtensionRecord and component type interfaces**

Add after the existing `EscrowHoldRecord` interface (around line 635), before the `Storage` interface:

```typescript
/* ─── Cortex-Core (declarative extensions) ──────────────────── */

export interface CortexExtensionRecord {
  name: string;              // full scoped: "@jouni/recipe-collection"
  namespace: string;         // "jouni"
  shortName: string;         // "recipe-collection"
  apiVersion: string;        // "cortex.aimeat.org/v1"
  version: string;           // SemVer
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
  manifest: string;          // original YAML
  components: CortexComponent[];
  activationArtifacts: CortexActivationArtifacts;
}

export interface CortexActivationArtifacts {
  schemaKeys: string[];
  promptKeys: string[];
  actionIds: string[];
  boardIds: string[];
  seedDataKeys: string[];
  ontologyKeys: string[];
  libFiles: string[];
}

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
}
```

**Step 2: Add CRUD methods to Storage interface**

Add before the closing brace of the `Storage` interface:

```typescript
  /* ─── Cortex-Core ──────────────────────────────────────────── */
  createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord>;
  getCortexExtension(name: string): Promise<CortexExtensionRecord | null>;
  listCortexExtensions(): Promise<CortexExtensionRecord[]>;
  updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null>;
  deleteCortexExtension(name: string): Promise<boolean>;

  setCortexLibFile(extName: string, libName: string, content: string): Promise<void>;
  getCortexLibFile(extName: string, libName: string): Promise<string | null>;
  deleteCortexLibFile(extName: string, libName: string): Promise<boolean>;
```

**Step 3: Run type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: FAIL — memory.ts does not implement the new methods yet.

**Step 4: Commit**

```bash
git add src/storage/interface.ts
git commit -m "feat(cortex): add CortexExtensionRecord types to storage interface"
```

---

## Task 3: Implement Storage in memory.ts

**Files:**
- Modify: `aimeat/src/storage/memory.ts` (add Maps + implement CRUD methods)

**Step 1: Add Map declarations**

Find the existing Map declarations (around line 18–31) and add:

```typescript
  private cortexExtensions = new Map<string, CortexExtensionRecord>();
  private cortexLibFiles = new Map<string, string>();   // key: `${extName}::${libName}`
```

**Step 2: Add import for new types**

Add to the import from `./interface.js`:

```typescript
CortexExtensionRecord,
```

**Step 3: Implement CRUD methods**

Add at the end of the class, before the closing brace:

```typescript
  /* ─── Cortex-Core ──────────────────────────────────────────── */

  async createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
    if (this.cortexExtensions.has(record.name)) {
      throw new Error(`Cortex extension already exists: ${record.name}`);
    }
    this.cortexExtensions.set(record.name, { ...record });
    return { ...record };
  }

  async getCortexExtension(name: string): Promise<CortexExtensionRecord | null> {
    const ext = this.cortexExtensions.get(name);
    return ext ? { ...ext } : null;
  }

  async listCortexExtensions(): Promise<CortexExtensionRecord[]> {
    return [...this.cortexExtensions.values()].map(e => ({ ...e }));
  }

  async updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
    const ext = this.cortexExtensions.get(name);
    if (!ext) return null;
    const updated = { ...ext, ...updates };
    this.cortexExtensions.set(name, updated);
    return { ...updated };
  }

  async deleteCortexExtension(name: string): Promise<boolean> {
    return this.cortexExtensions.delete(name);
  }

  async setCortexLibFile(extName: string, libName: string, content: string): Promise<void> {
    this.cortexLibFiles.set(`${extName}::${libName}`, content);
  }

  async getCortexLibFile(extName: string, libName: string): Promise<string | null> {
    return this.cortexLibFiles.get(`${extName}::${libName}`) ?? null;
  }

  async deleteCortexLibFile(extName: string, libName: string): Promise<boolean> {
    return this.cortexLibFiles.delete(`${extName}::${libName}`);
  }
```

**Step 4: Run type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS (or only unrelated errors)

**Step 5: Commit**

```bash
git add src/storage/memory.ts
git commit -m "feat(cortex): implement CortexExtension storage in InMemoryStorage"
```

---

## Task 4: Create Cortex Manifest Parser Service

**Files:**
- Create: `aimeat/src/services/cortex-manifest.ts`

**Step 1: Create the manifest parser**

This service handles:
1. YAML parsing
2. Structural validation (apiVersion, kind, metadata, spec, components)
3. JSON Schema meta-validation (embedded schemas are valid JSON Schemas)
4. Namespace ownership check
5. Lib static safety checks (warnings, not blocking)
6. Conversion from YAML to CortexExtensionRecord

```typescript
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  CortexExtensionRecord,
  CortexComponent,
  CortexSchemaComponent,
  CortexPromptComponent,
  CortexActionComponent,
  CortexBoardTemplateComponent,
  CortexOntologyComponent,
  CortexSeedDataComponent,
  CortexLibComponent,
} from '../storage/interface.js';

const ALLOWED_COMPONENT_TYPES = ['schema', 'prompt', 'action', 'board-template', 'ontology', 'seed-data', 'lib'];

export interface ParseResult {
  ok: boolean;
  extension?: CortexExtensionRecord;
  errors?: string[];
  warnings?: string[];
}

/** Parse and validate a cortex.yaml manifest string. */
export function parseCortexManifest(
  yamlString: string,
  installedBy: string,
  libs?: Record<string, string>,  // filename → base64 content
): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Parse YAML
  let doc: any;
  try {
    doc = parseYaml(yamlString);
  } catch (err: any) {
    return { ok: false, errors: [`YAML parse error: ${err.message}`] };
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Manifest must be a YAML object'] };
  }

  // 2. Validate top-level structure
  if (doc.apiVersion !== 'cortex.aimeat.org/v1') {
    errors.push(`Invalid or missing apiVersion (expected "cortex.aimeat.org/v1", got "${doc.apiVersion}")`);
  }
  if (doc.kind !== 'Extension') {
    errors.push(`Invalid or missing kind (expected "Extension", got "${doc.kind}")`);
  }

  const meta = doc.metadata;
  if (!meta || typeof meta !== 'object') {
    errors.push('Missing metadata section');
    return { ok: false, errors };
  }

  if (!meta.name || typeof meta.name !== 'string') errors.push('metadata.name is required');
  if (!meta.namespace || typeof meta.namespace !== 'string') errors.push('metadata.namespace is required');

  const spec = doc.spec;
  if (!spec || typeof spec !== 'object') {
    errors.push('Missing spec section');
    return { ok: false, errors };
  }

  if (!spec.version || typeof spec.version !== 'string') errors.push('spec.version is required');
  if (!Array.isArray(spec.components) || spec.components.length === 0) {
    errors.push('spec.components must be a non-empty array');
  }

  if (errors.length > 0) return { ok: false, errors };

  // 3. Validate components
  const components: CortexComponent[] = [];
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  for (let i = 0; i < spec.components.length; i++) {
    const comp = spec.components[i];
    const prefix = `components[${i}]`;

    if (!comp.type || !ALLOWED_COMPONENT_TYPES.includes(comp.type)) {
      errors.push(`${prefix}: unknown component type "${comp.type}"`);
      continue;
    }

    switch (comp.type) {
      case 'schema': {
        if (!comp.name) errors.push(`${prefix}: schema component requires name`);
        if (!comp.key_pattern) errors.push(`${prefix}: schema component requires key_pattern`);
        if (!comp.schema || typeof comp.schema !== 'object') {
          errors.push(`${prefix}: schema component requires a schema object`);
        } else {
          // Validate the schema is a valid JSON Schema
          try {
            ajv.compile(comp.schema);
          } catch (err: any) {
            errors.push(`${prefix}: invalid JSON Schema: ${err.message}`);
          }
        }
        components.push({
          type: 'schema',
          name: comp.name,
          key_pattern: comp.key_pattern,
          apply_to: comp.apply_to || 'prefix',
          schema: comp.schema,
        } as CortexSchemaComponent);
        break;
      }

      case 'prompt': {
        if (!comp.name) errors.push(`${prefix}: prompt component requires name`);
        if (!comp.content || typeof comp.content !== 'string') {
          errors.push(`${prefix}: prompt component requires content string`);
        }
        components.push({
          type: 'prompt',
          name: comp.name,
          content: comp.content,
          variables: comp.variables,
        } as CortexPromptComponent);
        break;
      }

      case 'action': {
        if (!comp.name) errors.push(`${prefix}: action component requires name`);
        if (!comp.description) errors.push(`${prefix}: action component requires description`);
        if (!comp.input_schema || typeof comp.input_schema !== 'object') {
          errors.push(`${prefix}: action component requires input_schema`);
        }
        components.push({
          type: 'action',
          name: comp.name,
          description: comp.description,
          input_schema: comp.input_schema,
        } as CortexActionComponent);
        break;
      }

      case 'board-template': {
        if (!comp.name) errors.push(`${prefix}: board-template requires name`);
        if (!comp.title) errors.push(`${prefix}: board-template requires title`);
        components.push({
          type: 'board-template',
          name: comp.name,
          title: comp.title,
          description: comp.description ?? '',
          visibility: comp.visibility ?? 'public',
          seed_posts: comp.seed_posts,
        } as CortexBoardTemplateComponent);
        break;
      }

      case 'ontology': {
        if (!comp.name) errors.push(`${prefix}: ontology component requires name`);
        if (!comp.concepts || typeof comp.concepts !== 'object') {
          errors.push(`${prefix}: ontology component requires concepts`);
        }
        components.push({
          type: 'ontology',
          name: comp.name,
          description: comp.description ?? '',
          concepts: comp.concepts,
        } as CortexOntologyComponent);
        break;
      }

      case 'seed-data': {
        if (!Array.isArray(comp.entries) || comp.entries.length === 0) {
          errors.push(`${prefix}: seed-data requires non-empty entries array`);
        }
        components.push({
          type: 'seed-data',
          entries: comp.entries ?? [],
        } as CortexSeedDataComponent);
        break;
      }

      case 'lib': {
        if (!comp.name) errors.push(`${prefix}: lib component requires name`);
        if (!comp.file) errors.push(`${prefix}: lib component requires file`);
        if (!comp.exports || !Array.isArray(comp.exports)) {
          errors.push(`${prefix}: lib component requires exports array`);
        }

        // Check if lib file was provided
        const libContent = libs?.[comp.file];
        if (!libContent) {
          errors.push(`${prefix}: lib file "${comp.file}" not provided in upload`);
        } else {
          // Static safety checks (warnings, not blocking)
          const libCode = Buffer.from(libContent, 'base64').toString('utf-8');
          if (/\beval\s*\(/.test(libCode)) warnings.push(`${prefix}: lib uses eval() — review carefully`);
          if (/\bnew\s+Function\s*\(/.test(libCode)) warnings.push(`${prefix}: lib uses new Function() — review carefully`);
          if (/document\.cookie/.test(libCode)) warnings.push(`${prefix}: lib accesses document.cookie`);
          // External fetch check: fetch to non-relative URLs
          const fetchMatches = libCode.match(/fetch\s*\(\s*['"`]https?:\/\//g);
          if (fetchMatches) warnings.push(`${prefix}: lib makes external fetch calls — verify destinations`);
        }

        components.push({
          type: 'lib',
          name: comp.name,
          filename: comp.file,
          exports: comp.exports ?? [],
          api_surface: comp.api_surface ?? '',
        } as CortexLibComponent);
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings: warnings.length > 0 ? warnings : undefined };

  // 4. Build record
  const name = `@${meta.namespace}/${meta.name}`;
  const now = new Date().toISOString();

  const extension: CortexExtensionRecord = {
    name,
    namespace: meta.namespace,
    shortName: meta.name,
    apiVersion: doc.apiVersion,
    version: spec.version,
    description: meta.description ?? '',
    author: meta.author ?? meta.namespace,
    license: meta.license,
    tags: meta.tags ?? [],
    labels: meta.labels ?? {},
    aimeatCompat: spec.aimeat,
    status: 'inactive',
    installedAt: now,
    installedBy,
    manifest: yamlString,
    components,
    activationArtifacts: {
      schemaKeys: [],
      promptKeys: [],
      actionIds: [],
      boardIds: [],
      seedDataKeys: [],
      ontologyKeys: [],
      libFiles: [],
    },
  };

  return { ok: true, extension, warnings: warnings.length > 0 ? warnings : undefined };
}

/** Check that manifest namespace matches the authenticated owner name. */
export function validateNamespaceOwnership(namespace: string, ownerName: string): boolean {
  return namespace === ownerName;
}
```

**Step 2: Run type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/services/cortex-manifest.ts
git commit -m "feat(cortex): add manifest parser with validation and lib safety checks"
```

---

## Task 5: Create Cortex Router — Lifecycle Endpoints

**Files:**
- Create: `aimeat/src/routes/cortex.ts`

This is the largest task. The router handles install, list, get, delete, activate, deactivate, and component-specific read endpoints.

**Step 1: Create the router with install, list, get, delete**

```typescript
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type {
  CortexSchemaComponent,
  CortexPromptComponent,
  CortexActionComponent,
  CortexBoardTemplateComponent,
  CortexOntologyComponent,
  CortexSeedDataComponent,
  CortexLibComponent,
} from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseCortexManifest, validateNamespaceOwnership } from '../services/cortex-manifest.js';
import { validateMemoryWrite } from '../services/schema-validator.js';

export function cortexRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── List all installed extensions ─────────────────────────
  router.get('/v1/cortex', requireAuth(), async (req, res) => {
    const extensions = await storage.listCortexExtensions();
    res.json(success(config.nodeId, {
      extensions: extensions.map(e => ({
        name: e.name,
        version: e.version,
        description: e.description,
        status: e.status,
        author: e.author,
        tags: e.tags,
        installedAt: e.installedAt,
        componentTypes: e.components.map(c => c.type),
      })),
    }));
  });

  // ── Install extension ─────────────────────────────────────
  router.post('/v1/cortex', requireAuth(), requireRole('owner'), async (req, res) => {
    const { manifest, libs } = req.body as {
      manifest?: string;
      libs?: Record<string, string>;
    };

    if (!manifest || typeof manifest !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'manifest (YAML string) is required'));
      return;
    }

    // Parse & validate
    const result = parseCortexManifest(manifest, req.auth!.sub, libs);
    if (!result.ok || !result.extension) {
      res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST', 'Manifest validation failed', 400, {
        errors: result.errors,
        warnings: result.warnings,
      }));
      return;
    }

    const ext = result.extension;

    // Namespace ownership: namespace must match owner name
    // Allow 'test' namespace for any owner (for testing), otherwise must match
    if (ext.namespace !== 'test' && !validateNamespaceOwnership(ext.namespace, req.auth!.owner)) {
      res.status(403).json(error(config.nodeId, 'NAMESPACE_MISMATCH',
        `Cannot publish to namespace "${ext.namespace}" — you are "${req.auth!.owner}"`));
      return;
    }

    // Check for duplicate
    const existing = await storage.getCortexExtension(ext.name);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS',
        `Extension ${ext.name} is already installed`));
      return;
    }

    // Store lib files (base64 content)
    if (libs) {
      for (const comp of ext.components) {
        if (comp.type === 'lib') {
          const libContent = libs[comp.filename];
          if (libContent) {
            await storage.setCortexLibFile(ext.name, comp.name, libContent);
          }
        }
      }
    }

    // Save extension record
    const saved = await storage.createCortexExtension(ext);

    res.status(201).json(success(config.nodeId, {
      name: saved.name,
      version: saved.version,
      status: saved.status,
      components: saved.components.map(c => `${c.type}:${c.type === 'seed-data' ? 'entries' : c.name}`),
      warnings: result.warnings,
    }, [
      { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(saved.name)}/activate` },
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(saved.name)}` },
    ]));
  });

  // ── Get extension details ─────────────────────────────────
  router.get('/v1/cortex/:name', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }
    res.json(success(config.nodeId, ext));
  });

  // ── Uninstall extension ───────────────────────────────────
  router.delete('/v1/cortex/:name', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    // If active, deactivate first
    if (ext.status === 'active') {
      await deactivateExtension(ext, storage, config);
    }

    // Remove seed-data entries (only on uninstall, not deactivate)
    for (const key of ext.activationArtifacts.seedDataKeys) {
      await storage.deleteMemory(ext.installedBy, key);
    }

    // Remove lib files
    for (const comp of ext.components) {
      if (comp.type === 'lib') {
        await storage.deleteCortexLibFile(ext.name, comp.name);
      }
    }

    await storage.deleteCortexExtension(name);
    res.json(success(config.nodeId, { deleted: name }));
  });

  // ── Activate extension ────────────────────────────────────
  router.post('/v1/cortex/:name/activate', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    // Idempotent: already active = no-op
    if (ext.status === 'active') {
      res.json(success(config.nodeId, { name, status: 'active', message: 'Already active' }));
      return;
    }

    try {
      await activateExtension(ext, storage, config);
    } catch (err: any) {
      res.status(409).json(error(config.nodeId, 'ACTIVATION_FAILED', err.message));
      return;
    }

    await storage.updateCortexExtension(name, {
      status: 'active',
      activatedAt: new Date().toISOString(),
      activationArtifacts: ext.activationArtifacts,
    });

    res.json(success(config.nodeId, { name, status: 'active' }));
  });

  // ── Deactivate extension ──────────────────────────────────
  router.post('/v1/cortex/:name/deactivate', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    // Idempotent: already inactive = no-op
    if (ext.status === 'inactive') {
      res.json(success(config.nodeId, { name, status: 'inactive', message: 'Already inactive' }));
      return;
    }

    await deactivateExtension(ext, storage, config);

    await storage.updateCortexExtension(name, {
      status: 'inactive',
      activationArtifacts: {
        schemaKeys: [],
        promptKeys: [],
        actionIds: [],
        boardIds: [],
        seedDataKeys: ext.activationArtifacts.seedDataKeys, // preserve seed-data keys for uninstall
        ontologyKeys: [],
        libFiles: [],
      },
    });

    res.json(success(config.nodeId, { name, status: 'inactive' }));
  });

  // ── Get prompts for extension ─────────────────────────────
  router.get('/v1/cortex/:name/prompts', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    const prompts = ext.components
      .filter((c): c is CortexPromptComponent => c.type === 'prompt')
      .map(p => ({ name: p.name, variables: p.variables }));

    res.json(success(config.nodeId, { prompts }));
  });

  // ── Get specific prompt ───────────────────────────────────
  router.get('/v1/cortex/:name/prompts/:promptName', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const promptName = req.params.promptName as string;
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    const prompt = ext.components.find(
      (c): c is CortexPromptComponent => c.type === 'prompt' && c.name === promptName,
    );
    if (!prompt) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt ${promptName} not found`));
      return;
    }

    // Variable substitution
    let content = prompt.content;
    content = content.replace(/\{\{node_url\}\}/g, config.publicUrl || `http://localhost:${config.port}`);
    content = content.replace(/\{\{owner_name\}\}/g, req.auth!.owner);
    content = content.replace(/\{\{gaii\}\}/g, req.auth!.sub);

    res.json(success(config.nodeId, { name: prompt.name, content, variables: prompt.variables }));
  });

  // ── Get ontology for extension ────────────────────────────
  router.get('/v1/cortex/:name/ontology', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension ${name} not found`));
      return;
    }

    const ontologies = ext.components
      .filter((c): c is CortexOntologyComponent => c.type === 'ontology');

    if (ontologies.length === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No ontology components in this extension'));
      return;
    }

    res.json(success(config.nodeId, { ontologies }));
  });

  // ── Serve lib file (public, cacheable) ────────────────────
  router.get('/v1/cortex/:name/libs/:libName.js', async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const libName = req.params.libName as string;

    const ext = await storage.getCortexExtension(name);
    if (!ext || ext.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Extension not found or not active'));
      return;
    }

    const content = await storage.getCortexLibFile(name, libName);
    if (!content) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Lib ${libName} not found`));
      return;
    }

    const jsContent = Buffer.from(content, 'base64').toString('utf-8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(jsContent);
  });

  return router;
}

/* ─── Activation / Deactivation helpers ────────────────────── */

async function activateExtension(
  ext: import('../storage/interface.js').CortexExtensionRecord,
  storage: Storage,
  config: AimeatConfig,
): Promise<void> {
  const artifacts = ext.activationArtifacts;

  for (const comp of ext.components) {
    switch (comp.type) {
      case 'schema': {
        // Check for conflicts: another extension already locks this key pattern
        const existing = await storage.getSchema(comp.key_pattern);
        if (existing && existing.lockedBy !== ext.name) {
          throw new Error(`Schema conflict: key_pattern "${comp.key_pattern}" is already locked by ${existing.lockedBy}`);
        }
        await storage.setSchema({
          keyPattern: comp.key_pattern,
          applyTo: comp.apply_to,
          schemaJson: comp.schema,
          schemaMode: 'strict',
          lockedBy: ext.name,
          setAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        artifacts.schemaKeys.push(comp.key_pattern);
        break;
      }

      case 'ontology': {
        const key = `__cortex__/${ext.name}/ontology/${comp.name}`;
        await storage.setMemory({
          ownerGaii: ext.installedBy,
          key,
          value: comp.concepts,
          visibility: 'public',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          flagCount: 0,
        });
        artifacts.ontologyKeys.push(key);
        break;
      }

      case 'prompt': {
        const key = `__cortex__/${ext.name}/prompts/${comp.name}`;
        await storage.setMemory({
          ownerGaii: ext.installedBy,
          key,
          value: { content: comp.content, variables: comp.variables },
          visibility: 'public',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          flagCount: 0,
        });
        artifacts.promptKeys.push(key);
        break;
      }

      case 'action': {
        const actionId = `cortex:${ext.name}:${comp.name}`;
        const now = new Date().toISOString();
        await storage.createAction({
          id: actionId,
          providerGaii: ext.installedBy,
          displayName: comp.name,
          description: comp.description,
          inputSchema: comp.input_schema,
          outputSchema: {},
          pricing: { baseMorsels: 0 },
          tags: [`cortex:${ext.shortName}`],
          createdAt: now,
          updatedAt: now,
        });
        artifacts.actionIds.push(actionId);
        break;
      }

      case 'board-template': {
        const boardId = `cortex-${ext.shortName}-${comp.name}`;
        const now = new Date().toISOString();
        await storage.createBoard({
          id: boardId,
          name: comp.title,
          description: comp.description,
          visibility: comp.visibility as 'public' | 'private' | 'shared',
          ownerGaii: ext.installedBy,
          allowedGaiis: [],
          createdAt: now,
        });

        // Add seed posts
        if (comp.seed_posts) {
          for (const post of comp.seed_posts) {
            await storage.createBoardPost({
              id: uuid(),
              boardId,
              authorGaii: ext.installedBy,
              title: post.title,
              body: post.body,
              createdAt: now,
              updatedAt: now,
              reactions: {},
            });
          }
        }
        artifacts.boardIds.push(boardId);
        break;
      }

      case 'seed-data': {
        for (const entry of comp.entries) {
          await storage.setMemory({
            ownerGaii: ext.installedBy,
            key: entry.key,
            value: entry.value,
            visibility: 'public',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            flagCount: 0,
          });
          artifacts.seedDataKeys.push(entry.key);
        }
        break;
      }

      case 'lib': {
        artifacts.libFiles.push(comp.name);
        break;
      }
    }
  }
}

async function deactivateExtension(
  ext: import('../storage/interface.js').CortexExtensionRecord,
  storage: Storage,
  _config: AimeatConfig,
): Promise<void> {
  const artifacts = ext.activationArtifacts;

  // Remove schemas
  for (const key of artifacts.schemaKeys) {
    await storage.deleteSchema(key);
  }

  // Remove prompts
  for (const key of artifacts.promptKeys) {
    await storage.deleteMemory(ext.installedBy, key);
  }

  // Remove ontologies
  for (const key of artifacts.ontologyKeys) {
    await storage.deleteMemory(ext.installedBy, key);
  }

  // Remove actions
  for (const id of artifacts.actionIds) {
    await storage.deleteAction(ext.installedBy, id);
  }

  // Remove boards (and their posts)
  for (const id of artifacts.boardIds) {
    await storage.deleteBoard(id);
  }

  // Note: seed-data is NOT removed on deactivation (user may have modified it)
  // Note: lib files are NOT removed on deactivation (they stay on disk for cache)
}
```

**Step 2: Run type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: May have errors if storage method signatures don't match exactly. Fix any type mismatches based on the actual interface.ts signatures. Common issues:
- `setMemory` might need different field names (check `MemoryRecord` in interface.ts)
- `createAction` might need additional required fields
- `createBoard` signature
- `deleteMemory`, `deleteSchema`, `deleteAction`, `deleteBoard` parameter signatures

Fix any type errors before proceeding.

**Step 3: Commit**

```bash
git add src/routes/cortex.ts
git commit -m "feat(cortex): add cortex router with full lifecycle and component endpoints"
```

---

## Task 6: Wire Up Router and Config

**Files:**
- Modify: `aimeat/src/server.ts` (import + mount)
- Modify: `aimeat/src/config.ts` (add cortex config fields)

**Step 1: Add config fields to AimeatConfig**

In `src/config.ts`, add to the `AimeatConfig` interface (near the existing extension fields around line 201):

```typescript
  cortexEnabled: boolean;
  cortexMaxInstalled: number;
  cortexMaxLibSizeKb: number;
```

In the `loadConfig()` function, add defaults:

```typescript
    cortexEnabled: env.AIMEAT_CORTEX_ENABLED !== 'false',
    cortexMaxInstalled: parseInt(env.AIMEAT_CORTEX_MAX_INSTALLED || '50', 10),
    cortexMaxLibSizeKb: parseInt(env.AIMEAT_CORTEX_MAX_LIB_SIZE_KB || '512', 10),
```

**Step 2: Import and mount cortex router in server.ts**

Add import near other router imports:

```typescript
import { cortexRouter } from './routes/cortex.js';
```

Add mounting near the existing extensions mounting (around line 500):

```typescript
  if (config.cortexEnabled) {
    app.use(cortexRouter(config, storage));
  }
```

**Step 3: Run type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/config.ts src/server.ts
git commit -m "feat(cortex): wire up cortex router and config"
```

---

## Task 7: Fix Type Errors and Alignment

**Files:**
- Modify: `aimeat/src/routes/cortex.ts` (fix any type mismatches)
- Modify: `aimeat/src/services/cortex-manifest.ts` (fix any type mismatches)

**Step 1: Run type check and fix**

```bash
cd aimeat && npx tsc --noEmit 2>&1
```

Read the error output carefully. Common fixes needed:
- Storage method signatures may differ (check exact parameter types in interface.ts)
- `MemoryRecord` may have different required fields than what `setMemory` expects
- `ActionRecord` may require `category` or other fields
- `BoardPostRecord` may have different fields than expected
- Express 5 params casting (`req.params.name as string`)

Fix each error, re-run `npx tsc --noEmit` until clean.

**Step 2: Build**

```bash
cd aimeat && pnpm build
```

Expected: Clean build

**Step 3: Commit**

```bash
git add -A
git commit -m "fix(cortex): resolve type errors and align with storage interface"
```

---

## Task 8: Write E2E Test File

**Files:**
- Create: `aimeat/test/cortex-e2e.ts`

**Step 1: Create the E2E test**

```typescript
/**
 * Cortex-Core E2E Tests
 *
 * Run: npx tsx test/cortex-e2e.ts
 * Requires: Server running on port 40251 (or E2E_BASE env var)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function rawFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${path}`, opts);
}

// ── Auth setup ──────────────────────────────────────────────

let ownerToken = '';
let ownerName = '';

async function setupAuth() {
  // Register an owner
  const privKey = ed.utils.randomPrivateKey();
  const pubKey = Buffer.from(await ed.getPublicKeyAsync(privKey)).toString('hex');
  const name = `cortex-test-${Date.now()}`;

  const reg = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name, public_key: pubKey }),
  });

  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`Owner registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  }

  ownerName = name;

  // Get auth token
  const ts = new Date().toISOString();
  const msg = `${name}${NODE_ID}${ts}`;
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), privKey)).toString('hex');

  const auth = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: name, node_id: NODE_ID, timestamp: ts, signature: sig }),
  });

  if (!auth.body?.data?.token) {
    throw new Error(`Auth token failed: ${JSON.stringify(auth.body)}`);
  }

  ownerToken = auth.body.data.token;
}

function authHeaders() {
  return { Authorization: `Bearer ${ownerToken}` };
}

// ── Fixture loading ─────────────────────────────────────────

function loadFixture(filename: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', 'cortex', filename), 'utf-8');
}

function toBase64(content: string): string {
  return Buffer.from(content).toString('base64');
}

// ── Tests ───────────────────────────────────────────────────

async function run() {
  console.log('\n🔧 Setting up auth...');
  await setupAuth();
  console.log(`   Owner: ${ownerName}, Token: ${ownerToken.slice(0, 20)}...`);

  // ── Phase 1: Manifest Parsing & Validation ──────────────

  console.log('\n📋 Phase 1: Manifest Parsing & Validation');

  await test('Valid manifest installs successfully', async () => {
    const manifest = loadFixture('recipe-collection.yaml');
    const libContent = toBase64(loadFixture('recipe-ui.js'));
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        manifest,
        libs: { 'recipe-ui.js': libContent },
      }),
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.name === '@test/recipe-collection', `Wrong name: ${r.body.data.name}`);
    assert(r.body.data.status === 'inactive', `Expected inactive, got ${r.body.data.status}`);
  });

  await test('Invalid YAML returns parse error', async () => {
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest: '{ invalid yaml: [' }),
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test('Missing required fields rejected', async () => {
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest: 'apiVersion: cortex.aimeat.org/v1\nkind: Extension\n' }),
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test('Unknown component type rejected', async () => {
    const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: bad-ext
  namespace: test
spec:
  version: "1.0.0"
  components:
    - type: executable
      name: bad
      code: "rm -rf /"
`;
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest }),
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test('Duplicate extension name returns 409', async () => {
    const manifest = loadFixture('recipe-collection.yaml');
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest }),
    });
    assert(r.status === 409, `Expected 409, got ${r.status}`);
  });

  await test('Invalid JSON Schema in schema component rejected', async () => {
    const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: bad-schema
  namespace: test
spec:
  version: "1.0.0"
  components:
    - type: schema
      name: broken
      key_pattern: "broken/*"
      schema:
        type: invalid_type_value
        required: not_an_array
`;
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest }),
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ── Phase 2: Full Lifecycle ─────────────────────────────

  console.log('\n🔄 Phase 2: Full Lifecycle');

  await test('List shows installed extension', async () => {
    const r = await json('/v1/cortex', { headers: authHeaders() });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.extensions.length >= 1, 'Expected at least 1 extension');
    const ext = r.body.data.extensions.find((e: any) => e.name === '@test/recipe-collection');
    assert(ext, 'recipe-collection not in list');
    assert(ext.status === 'inactive', `Expected inactive, got ${ext.status}`);
  });

  await test('Activate extension', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/activate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.status === 'active', `Expected active, got ${r.body.data.status}`);
  });

  await test('Activate already-active is idempotent', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/activate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.status === 'active', 'Should still be active');
  });

  await test('Deactivate extension', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/deactivate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.status === 'inactive', `Expected inactive, got ${r.body.data.status}`);
  });

  await test('Deactivate already-inactive is idempotent', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/deactivate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // Re-activate for subsequent tests
  await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/activate`, {
    method: 'POST',
    headers: authHeaders(),
  });

  // ── Phase 3: Schema Component ───────────────────────────

  console.log('\n📐 Phase 3: Schema Component');

  await test('Conforming memory write succeeds', async () => {
    const r = await json('/v1/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        key: 'recipes/test-salad',
        value: {
          title: 'Greek Salad',
          ingredients: [{ name: 'tomato', amount: '2' }],
          instructions: 'Chop and mix.',
        },
      }),
    });
    assert(r.status === 200 || r.status === 201, `Expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('Violating memory write returns 400', async () => {
    const r = await json('/v1/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        key: 'recipes/bad-recipe',
        value: {
          // Missing required: title, ingredients, instructions
          cuisine: 'italian',
        },
      }),
    });
    assert(r.status === 400, `Expected 400 for schema violation, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('Seed data was written on activation', async () => {
    const r = await json('/v1/memory/recipes/example-pasta', { headers: authHeaders() });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.value.title === 'Simple Pasta Aglio e Olio', 'Wrong seed data');
  });

  // Deactivate and test schema removal
  await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/deactivate`, {
    method: 'POST',
    headers: authHeaders(),
  });

  await test('After deactivation, violating write succeeds (schema removed)', async () => {
    const r = await json('/v1/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        key: 'recipes/no-schema',
        value: { just: 'anything' },
      }),
    });
    assert(r.status === 200 || r.status === 201, `Expected success, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('Existing data survives deactivation', async () => {
    const r = await json('/v1/memory/recipes/test-salad', { headers: authHeaders() });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.value.title === 'Greek Salad', 'Data should survive deactivation');
  });

  // Re-activate for remaining tests
  await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/activate`, {
    method: 'POST',
    headers: authHeaders(),
  });

  // ── Phase 4: Prompt Component ───────────────────────────

  console.log('\n💬 Phase 4: Prompt Component');

  await test('List prompts endpoint works', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/prompts`, {
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.prompts.length === 1, `Expected 1 prompt, got ${r.body.data.prompts.length}`);
    assert(r.body.data.prompts[0].name === 'recipe-assistant', 'Wrong prompt name');
  });

  await test('Get specific prompt with variable substitution', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/prompts/recipe-assistant`, {
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.content.includes('recipe management assistant'), 'Missing prompt content');
    // Variable substitution should have replaced {{node_url}}
    assert(!r.body.data.content.includes('{{node_url}}'), 'Variable {{node_url}} was not substituted');
  });

  await test('Get non-existent prompt returns 404', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/prompts/nonexistent`, {
      headers: authHeaders(),
    });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── Phase 5: Action Component ───────────────────────────

  console.log('\n⚡ Phase 5: Action Component');

  await test('Active action appears in catalogue', async () => {
    const r = await json('/v1/actions', { headers: authHeaders() });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const actions = r.body.data.actions ?? r.body.data;
    const cortexAction = Array.isArray(actions)
      ? actions.find((a: any) => a.id?.includes('add-recipe'))
      : null;
    assert(cortexAction, 'add-recipe action not found in catalogue');
  });

  // ── Phase 6: Board Template Component ───────────────────

  console.log('\n📌 Phase 6: Board Template Component');

  await test('Activation created board', async () => {
    const r = await json('/v1/boards', { headers: authHeaders() });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const boards = r.body.data.boards ?? r.body.data;
    const cortexBoard = Array.isArray(boards)
      ? boards.find((b: any) => b.name === 'Recipe Sharing' || b.id?.includes('recipe'))
      : null;
    assert(cortexBoard, 'Recipe Sharing board not found');
  });

  // ── Phase 7: Ontology Component ─────────────────────────

  console.log('\n🧬 Phase 7: Ontology Component');

  await test('Get ontology returns concepts', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/ontology`, {
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.body.data.ontologies.length === 1, 'Expected 1 ontology');
    const ont = r.body.data.ontologies[0];
    assert(ont.concepts.recipe, 'Missing recipe concept');
    assert(ont.concepts.recipe.label.en === 'Recipe', 'Wrong label');
    assert(ont.concepts.recipe.label.fi === 'Resepti', 'Wrong Finnish label');
  });

  await test('Extension without ontology returns 404', async () => {
    // Install project-tracker (no ontology)
    const manifest = loadFixture('project-tracker.yaml');
    await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest }),
    });
    await json(`/v1/cortex/${encodeURIComponent('@test/project-tracker')}/activate`, {
      method: 'POST',
      headers: authHeaders(),
    });

    const r = await json(`/v1/cortex/${encodeURIComponent('@test/project-tracker')}/ontology`, {
      headers: authHeaders(),
    });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── Phase 8: Lib Component ──────────────────────────────

  console.log('\n📦 Phase 8: Lib Component');

  await test('Lib file is served with correct Content-Type', async () => {
    const res = await rawFetch(`${BASE}/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/libs/recipe-ui.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('javascript'), `Expected javascript content-type, got ${ct}`);
    const body = await res.text();
    assert(body.includes('RecipeList'), 'Lib content missing RecipeList');
  });

  await test('Lib has cache headers', async () => {
    const res = await rawFetch(`${BASE}/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/libs/recipe-ui.js`);
    const cache = res.headers.get('cache-control') ?? '';
    assert(cache.includes('public'), `Expected public cache, got ${cache}`);
  });

  await test('Non-existent lib returns 404', async () => {
    const res = await rawFetch(`${BASE}/v1/cortex/${encodeURIComponent('@test/recipe-collection')}/libs/nonexistent.js`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // ── Phase 9: Multi-Extension Coexistence ────────────────

  console.log('\n🔗 Phase 9: Multi-Extension Coexistence');

  await test('Install research-assistant (prompt + ontology only)', async () => {
    const manifest = loadFixture('research-assistant.yaml');
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ manifest }),
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
  });

  await test('Install iot-dashboard (schema + lib)', async () => {
    const manifest = loadFixture('iot-dashboard.yaml');
    const libContent = toBase64(loadFixture('iot-sensor-ui.js'));
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        manifest,
        libs: { 'iot-sensor-ui.js': libContent },
      }),
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
  });

  await test('List shows all installed extensions', async () => {
    const r = await json('/v1/cortex', { headers: authHeaders() });
    assert(r.body.data.extensions.length >= 4, `Expected >= 4 extensions, got ${r.body.data.extensions.length}`);
  });

  // ── Phase 10: Uninstall & Cleanup ───────────────────────

  console.log('\n🗑️ Phase 10: Uninstall & Cleanup');

  await test('Uninstall removes extension', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/research-assistant')}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);

    const check = await json(`/v1/cortex/${encodeURIComponent('@test/research-assistant')}`, {
      headers: authHeaders(),
    });
    assert(check.status === 404, 'Extension should be gone after uninstall');
  });

  await test('Uninstall active extension deactivates first', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/recipe-collection')}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test('Seed data removed after uninstall', async () => {
    const r = await json('/v1/memory/recipes/example-pasta', { headers: authHeaders() });
    assert(r.status === 404, `Expected 404 (seed data removed), got ${r.status}`);
  });

  await test('Re-install after uninstall works', async () => {
    const manifest = loadFixture('recipe-collection.yaml');
    const libContent = toBase64(loadFixture('recipe-ui.js'));
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        manifest,
        libs: { 'recipe-ui.js': libContent },
      }),
    });
    assert(r.status === 201, `Expected 201, got ${r.status}`);
  });

  await test('Activate non-existent extension returns 404', async () => {
    const r = await json(`/v1/cortex/${encodeURIComponent('@test/nonexistent')}/activate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // ── Cleanup ─────────────────────────────────────────────

  console.log('\n🧹 Cleanup');

  for (const name of ['@test/recipe-collection', '@test/project-tracker', '@test/iot-dashboard']) {
    await json(`/v1/cortex/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  }

  // ── Summary ─────────────────────────────────────────────

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Cortex-Core E2E: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add test/cortex-e2e.ts
git commit -m "test(cortex): add E2E test suite with fixture-driven tests"
```

---

## Task 9: Run E2E Tests and Fix Issues

**Step 1: Start the dev server**

```bash
cd aimeat && E2E_PORT=40251 pnpm dev
```

(or whatever command starts the server on port 40251)

**Step 2: Run the cortex E2E tests**

```bash
cd aimeat && npx tsx test/cortex-e2e.ts
```

**Step 3: Fix failures**

Common issues to expect:
- Storage method signature mismatches (parameter names/types differ from what cortex.ts passes)
- Memory write endpoint may use different body format than what tests send
- Actions list endpoint may return data in different shape
- Boards list endpoint may return data in different shape
- URL encoding issues with `@` in extension names
- Schema validation may not trigger on memory writes if the key pattern matching doesn't work with the cortex-created schema locks

For each failure:
1. Read the error message
2. Check the actual storage/route implementation
3. Fix the cortex router or manifest parser to match
4. Re-run tests

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(cortex): resolve E2E test failures"
```

Repeat Step 2-4 until all tests pass.

---

## Task 10: Final Verification and Commit

**Step 1: Type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS

**Step 2: Build**

```bash
cd aimeat && pnpm build
```

Expected: Clean build

**Step 3: Run full E2E suite (existing + cortex)**

```bash
cd aimeat && npx tsx test/cortex-e2e.ts
```

Expected: All tests pass

**Step 4: Run existing E2E tests to ensure no regressions**

```bash
cd aimeat && npx tsx test/e2e-full.ts
```

Expected: All existing tests still pass

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(cortex): Cortex-Core PoC complete — all E2E tests passing"
```

---

## Summary

| Task | What | Files | Estimated Steps |
|------|------|-------|----------------|
| 1 | Create fixture extensions | 6 new fixture files | 6 |
| 2 | Storage types | interface.ts | 4 |
| 3 | Storage implementation | memory.ts | 5 |
| 4 | Manifest parser service | cortex-manifest.ts (new) | 3 |
| 5 | Cortex router | cortex.ts (new) | 3 |
| 6 | Wire up router + config | server.ts, config.ts | 4 |
| 7 | Fix type errors | cortex.ts, cortex-manifest.ts | 3 |
| 8 | E2E test file | cortex-e2e.ts (new) | 2 |
| 9 | Run tests + fix issues | Various | 4+ |
| 10 | Final verification | — | 5 |

**Total: 10 tasks, ~39+ steps**
