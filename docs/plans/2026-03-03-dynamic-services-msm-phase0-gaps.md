# Dynamic Services, MSM Implementation & Phase 0 Gap Closure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close critical Phase 0 documentation gaps (DMZ architecture, semantic ontology), implement MSM (Machine Service Manifest) storage and API endpoints, and reorganize the admin dashboard with tier-based nav groups and dynamic service/integration panels driven by registered CSMs and MSMs.

**Architecture:** Mirror the existing CSM pattern (YAML parser + storage + routes + admin panel) for MSM. Reorganize the admin dashboard sidebar into logical tier-based groups: Node, Identity, Data, Infrastructure, Services, Integrations, Federation. The Services section lists built-in services (Directory, Matching, Marketplace) plus dynamically registered CSMs. The Integrations section is fully dynamic from registered MSMs. Both sections use client-side rendering populated from admin API data.

**Tech Stack:** Express 5.2.1, TypeScript 5.9.3, ESM, yaml parser (already used by CSM), inline HTML/CSS/JS dashboard, existing i18n system

---

## Task 1: Create DMZ Architecture formal documentation

**Files:**
- Create: `docs/aimeat-dmz-architecture.md`

**Context:** Phase 0.6 requires a formal DMZ architecture document. The code implementation exists (consent layer + memory visibility model) but the formal specification does not. Reference: `docs/nextlevel/aimeat-dmz-concept.md` (informal concept), `aimeat/src/services/consent.ts` (implementation), `aimeat/src/routes/consent.ts` (API).

**Content structure:**

```markdown
# AIMEAT DMZ Architecture Specification

## 1. Overview
Three-zone data model: Private Zone → DMZ (controlled sharing) → Federation.

## 2. Zone Definitions

### 2.1 Private Zone
- Memory with `visibility: 'private'`
- Only the owning agent can read/write
- Never crosses zone boundaries without explicit consent

### 2.2 Owner Zone (DMZ)
- Memory with `visibility: 'owner'`
- All agents under the same owner can access
- Consent grants can extend access to specific external agents
- Consent audit trail tracks all cross-agent access

### 2.3 Public Zone
- Memory with `visibility: 'public'`
- Any authenticated agent can read
- No consent required for reads

### 2.4 Federation Zone
- Data marked for federation sync via consent scope: 'federation'
- CSM services with `visibility_default: 'federation'` auto-share
- Controlled by consent grants with `scope: 'federation'`

## 3. Consent-Controlled Boundary Crossing

### 3.1 Consent Grant Flow
POST /v1/consent → creates ConsentRecord:
- dataPattern: glob pattern (e.g., "profile.alice.*")
- recipient: GAII, '*', or 'organism.{id}'
- scope: 'private' | 'dmz' | 'federation'
- expires: ISO timestamp or null (permanent)

### 3.2 Access Check Flow
On every memory read:
1. Check MemoryRecord.visibility
2. If 'private' → only ownerGaii can read
3. If 'owner' → any agent under same owner
4. If 'public' → any authenticated agent
5. For cross-owner reads → findMatchingConsents()
6. Log ConsentAuditEntry for all access attempts

### 3.3 Audit Trail
GET /v1/consent/audit?days=30 returns:
- Every read attempt with consent lookup result
- allowed: boolean showing whether access was granted
- Full traceability for GDPR compliance

## 4. CSM Visibility Integration
CSM consent_requirements.visibility_default sets the default zone for all data stored under that service's schema key prefix (csm.{name}.*).

## 5. Federation Boundary
- Only 'federation'-scoped consents allow data to cross node boundaries
- Genesis peers only receive data from consents matching their node ID
- CsmRecord.federate controls whether service definitions (not data) are shared

## 6. Implementation Reference
- Consent service: aimeat/src/services/consent.ts
- Consent routes: aimeat/src/routes/consent.ts
- Memory visibility: aimeat/src/storage/interface.ts (MemoryRecord.visibility)
- Storage interface: findMatchingConsents(), addConsentAuditEntry()
```

**Verification:** Document exists and cross-references actual code paths. Review against `docs/nextlevel/aimeat-dmz-concept.md` for consistency.

---

## Task 2: Create Semantic Ontology mapping document

**Files:**
- Create: `docs/aimeat-semantic-ontology.md`

**Context:** Phase 0.7 has `SemanticAnnotation` interface in storage and `semanticContext` in SchemaRecord, but no formal ontology mapping. The CSM definitions have a `semantic` field in their service section. We need to document which ontologies AIMEAT maps to and how.

**Content structure:**

```markdown
# AIMEAT Semantic Ontology Specification

## 1. Overview
AIMEAT uses JSON-LD-compatible semantic annotations to enable machine-readable data interoperability across the federation.

## 2. Core Interfaces

### SemanticAnnotation (records)
Used on: AgentRecord, ActionRecord, BoardRecord, BoardPostRecord, GHIIRecord
```typescript
interface SemanticAnnotation {
  '@context'?: Record<string, string>;
  '@type'?: string;
  [key: string]: unknown;
}
```

### SemanticContext (schemas)
Used on: SchemaRecord
```typescript
interface SemanticContext {
  '@context'?: Record<string, string>;
  '@type'?: string;
  properties?: Record<string, unknown>;
}
```

## 3. Supported Ontologies

### 3.1 Schema.org (Primary)
Default context: `"schema": "https://schema.org/"`
- Person → GHII profiles, directory entries
- Product → marketplace listings
- Event → scheduled actions, board events
- Organization → organisms (groups/communities)
- Place → location objects
- CreativeWork → board posts, news articles

### 3.2 QUDT (Quantities, Units)
Context: `"qudt": "http://qudt.org/schema/qudt/"`
- Used for morsel economy values
- Unit conversions in marketplace pricing

### 3.3 SAREF (Smart Applications)
Context: `"saref": "https://saref.etsi.org/core/"`
- IoT device descriptions (MSM integrations like Nuki smart locks)
- Sensor data (weather services)

### 3.4 SKOS (Knowledge Organization)
Context: `"skos": "http://www.w3.org/2004/02/skos/core#"`
- Interest taxonomies (hobby directory)
- Category hierarchies (marketplace, CSM service types)

## 4. CSM Semantic Integration
CSM service definitions include optional semantic section:
```yaml
service:
  semantic:
    "@context":
      schema: "https://schema.org/"
    "@type": "Service"
```
This maps the entire CSM to a Schema.org Service, enabling federation-wide discovery.

## 5. Mapping Table: AIMEAT Records → Ontology Types

| AIMEAT Record | Schema.org Type | Example |
|--------------|----------------|---------|
| AgentRecord | schema:SoftwareApplication | AI agent profile |
| GHIIRecord | schema:Person | Human identity |
| ListingRecord | schema:Product / schema:Offer | Marketplace item |
| OrganismRecord | schema:Organization | Community group |
| BoardPostRecord | schema:CreativeWork | Forum/news post |
| ActionRecord | schema:Action | Published capability |
| MatchRecord | schema:InteractionCounter | Matching suggestion |

## 6. Usage Guidelines
- Semantic annotations are OPTIONAL — no data is rejected for missing annotations
- When present, `@context` + `@type` must be valid JSON-LD
- Federation peers use semantic types for cross-node data discovery
- CSM schema validation does NOT validate semantic content (separate concern)

## 7. Implementation Reference
- SemanticAnnotation type: aimeat/src/storage/interface.ts:1-6
- Schema semantic context: aimeat/src/storage/interface.ts:325-329
- Profile schemas: aimeat/src/services/profile-schemas.ts
- CSM semantic field: aimeat/src/services/csm-parser.ts:33-37
```

**Verification:** Document exists, types match actual code, ontology URIs are valid.

---

## Task 3: MSM parser service

**Files:**
- Create: `aimeat/src/services/msm-parser.ts`

**Context:** MSM (Machine Service Manifest) describes external API integrations. 10 example YAML files exist in `docs/msm-examples/`. Pattern mirrors `aimeat/src/services/csm-parser.ts`. The MSM YAML structure is defined in `docs/manuals/msm-manual.md`.

**Implementation:**

```typescript
import { parse as parseYaml } from 'yaml';

// ── MSM Types ──

export type MsmCategory = 'data' | 'utility' | 'image' | 'communication' | 'analytics';

const VALID_CATEGORIES: MsmCategory[] = ['data', 'utility', 'image', 'communication', 'analytics'];

export type MsmAuthType = 'bearer' | 'query_param' | 'oauth2' | 'api_key' | 'none';

export interface MsmFieldDef {
  type: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  from?: string;           // JSON path for output mapping
  items?: MsmFieldDef;     // for array types
  properties?: Record<string, MsmFieldDef>;  // for object types
}

export interface MsmAction {
  id: string;
  displayName: string;
  description: string;
  endpoint: {
    method: string;
    url: string;
    contentType?: string;
  };
  input: Record<string, MsmFieldDef>;
  output: Record<string, MsmFieldDef>;
  requestMapping?: string;
  pricing?: {
    baseMorsels: number;
    perUnit?: number;
    unit?: string;
  };
  estimatedTimeSeconds?: number;
  examples?: Array<{ input: Record<string, unknown>; output: Record<string, unknown> }>;
}

export interface MsmDefinition {
  version: string;
  service: {
    name: string;
    description: string;
    homepage?: string;
    category: MsmCategory;
    tags: string[];
  };
  auth: {
    type: MsmAuthType;
    envVar?: string;
    envVarSecret?: string;
    paramName?: string;
    header?: string;
    tokenUrl?: string;
  };
  actions: MsmAction[];
  health?: {
    endpoint: string;
    method: string;
    intervalSeconds: number;
    expectedStatus: number;
  };
}

// ── Parser ──

export function parseMsm(yamlContent: string): MsmDefinition {
  const raw = parseYaml(yamlContent) as Record<string, unknown>;

  const service = raw.service as Record<string, unknown> | undefined;
  const auth = raw.auth as Record<string, unknown> | undefined;
  const rawActions = raw.actions as Array<Record<string, unknown>> | undefined;
  const health = raw.health as Record<string, unknown> | undefined;

  return {
    version: String(raw.msm ?? '1.0'),
    service: {
      name: String(service?.name ?? ''),
      description: String(service?.description ?? ''),
      homepage: service?.homepage ? String(service.homepage) : undefined,
      category: String(service?.category ?? 'utility') as MsmCategory,
      tags: Array.isArray(service?.tags) ? (service.tags as string[]) : [],
    },
    auth: {
      type: String(auth?.type ?? 'none') as MsmAuthType,
      envVar: auth?.env_var ? String(auth.env_var) : undefined,
      envVarSecret: auth?.env_var_secret ? String(auth.env_var_secret) : undefined,
      paramName: auth?.param_name ? String(auth.param_name) : undefined,
      header: auth?.header ? String(auth.header) : undefined,
      tokenUrl: auth?.token_url ? String(auth.token_url) : undefined,
    },
    actions: (rawActions ?? []).map(parseAction),
    health: health ? {
      endpoint: String(health.endpoint ?? ''),
      method: String(health.method ?? 'GET'),
      intervalSeconds: Number(health.interval_seconds ?? 600),
      expectedStatus: Number(health.expected_status ?? 200),
    } : undefined,
  };
}

function parseAction(raw: Record<string, unknown>): MsmAction {
  const endpoint = raw.endpoint as Record<string, unknown> | undefined;
  const pricing = raw.pricing as Record<string, unknown> | undefined;
  const input = raw.input as Record<string, unknown> | undefined;
  const output = raw.output as Record<string, unknown> | undefined;

  return {
    id: String(raw.id ?? ''),
    displayName: String(raw.display_name ?? ''),
    description: String(raw.description ?? ''),
    endpoint: {
      method: String(endpoint?.method ?? 'GET'),
      url: String(endpoint?.url ?? ''),
      contentType: endpoint?.content_type ? String(endpoint.content_type) : undefined,
    },
    input: parseFieldMap(input ?? {}),
    output: parseFieldMap(output ?? {}),
    requestMapping: raw.request_mapping ? String(raw.request_mapping) : undefined,
    pricing: pricing ? {
      baseMorsels: Number(pricing.base_morsels ?? 0),
      perUnit: pricing.per_unit !== undefined ? Number(pricing.per_unit) : undefined,
      unit: pricing.unit ? String(pricing.unit) : undefined,
    } : undefined,
    estimatedTimeSeconds: raw.estimated_time_seconds !== undefined
      ? Number(raw.estimated_time_seconds) : undefined,
    examples: Array.isArray(raw.examples)
      ? (raw.examples as Array<Record<string, unknown>>).map(ex => ({
          input: (ex.input ?? {}) as Record<string, unknown>,
          output: (ex.output ?? {}) as Record<string, unknown>,
        }))
      : undefined,
  };
}

function parseFieldMap(raw: Record<string, unknown>): Record<string, MsmFieldDef> {
  const result: Record<string, MsmFieldDef> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val && typeof val === 'object') {
      result[key] = parseFieldDef(val as Record<string, unknown>);
    }
  }
  return result;
}

function parseFieldDef(raw: Record<string, unknown>): MsmFieldDef {
  const def: MsmFieldDef = {
    type: String(raw.type ?? 'string'),
  };
  if (raw.required !== undefined) def.required = raw.required === true;
  if (raw.description) def.description = String(raw.description);
  if (Array.isArray(raw.enum)) def.enum = raw.enum as string[];
  if (raw.from) def.from = String(raw.from);
  if (raw.items && typeof raw.items === 'object') {
    def.items = parseFieldDef(raw.items as Record<string, unknown>);
  }
  if (raw.properties && typeof raw.properties === 'object') {
    def.properties = parseFieldMap(raw.properties as Record<string, unknown>);
  }
  return def;
}

// ── Validator ──

export function validateMsm(def: MsmDefinition): string[] {
  const errors: string[] = [];

  if (!def.version) errors.push('msm version is required');
  if (!def.service.name) errors.push('service.name is required');
  if (!def.service.description) errors.push('service.description is required');
  if (!VALID_CATEGORIES.includes(def.service.category)) {
    errors.push(`service.category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (!def.actions || def.actions.length === 0) {
    errors.push('at least one action is required');
  }

  for (const action of def.actions) {
    if (!action.id) errors.push('action.id is required');
    if (!action.displayName) errors.push(`action "${action.id}": display_name is required`);
    if (!action.endpoint.url) errors.push(`action "${action.id}": endpoint.url is required`);
  }

  if (!['bearer', 'query_param', 'oauth2', 'api_key', 'none'].includes(def.auth.type)) {
    errors.push(`auth.type must be one of: bearer, query_param, oauth2, api_key, none`);
  }

  return errors;
}
```

**Verification:** `npx tsc --noEmit` passes. Import in a scratch test to verify all 10 MSM examples parse correctly:
```bash
npx tsx -e "
  import {readdirSync,readFileSync} from 'fs';
  import {parseMsm,validateMsm} from './src/services/msm-parser.js';
  const dir='docs/msm-examples';
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.yaml'))){
    const d=parseMsm(readFileSync(dir+'/'+f,'utf8'));
    const e=validateMsm(d);
    console.log(f,d.service.name,d.actions.length+'acts',e.length?'ERRORS:'+e.join(';'):'OK');
  }
"
```

---

## Task 4: MSM storage interface + in-memory implementation

**Files:**
- Modify: `aimeat/src/storage/interface.ts` — add `MsmRecord` interface and Storage methods
- Modify: `aimeat/src/storage/memory.ts` — implement MSM storage methods

**Add to interface.ts** (after CsmRecord, around line 323):

```typescript
// MSM — Machine Service Manifest (external API integrations)
export interface MsmRecord {
  name: string;                    // unique service name
  definition: Record<string, unknown>;  // Full MsmDefinition as JSON
  category: string;                // data | utility | image | communication | analytics
  authType: string;                // bearer | query_param | oauth2 | api_key | none
  actionsCount: number;            // number of actions defined
  registeredBy: string;            // owner name
  registeredAt: string;            // ISO timestamp
  updatedAt: string;               // ISO timestamp
  federate?: boolean;              // share across federation
}
```

**Add to Storage interface** (after CSM methods, around line 728):

```typescript
  // MSM — Machine Service Manifest
  createMsm(record: MsmRecord): Promise<MsmRecord>;
  getMsm(name: string): Promise<MsmRecord | null>;
  listMsms(opts?: { category?: string }): Promise<MsmRecord[]>;
  updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null>;
  deleteMsm(name: string): Promise<boolean>;
```

**Add to memory.ts** (mirror existing CSM implementation pattern — find CSM methods and replicate for MSM):

```typescript
private msms = new Map<string, MsmRecord>();

async createMsm(record: MsmRecord): Promise<MsmRecord> {
  this.msms.set(record.name, record);
  return record;
}

async getMsm(name: string): Promise<MsmRecord | null> {
  return this.msms.get(name) ?? null;
}

async listMsms(opts?: { category?: string }): Promise<MsmRecord[]> {
  let results = [...this.msms.values()];
  if (opts?.category) results = results.filter(m => m.category === opts.category);
  return results;
}

async updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
  const existing = this.msms.get(name);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  this.msms.set(name, updated);
  return updated;
}

async deleteMsm(name: string): Promise<boolean> {
  return this.msms.delete(name);
}
```

**Verification:** `npx tsc --noEmit` passes.

---

## Task 5: MSM routes

**Files:**
- Create: `aimeat/src/routes/msm.ts`
- Modify: `aimeat/src/server.ts` — import and mount msmRouter

**Context:** Mirror `aimeat/src/routes/csm.ts` pattern. MSM templates loaded from `docs/msm-examples/*.msm.yaml` at startup. Registration requires `owner` role.

**Implementation for `aimeat/src/routes/msm.ts`:**

```typescript
import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseMsm, validateMsm } from '../services/msm-parser.js';

interface MsmTemplateMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  yaml: string;
}

function loadMsmTemplates(): MsmTemplateMeta[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatesDir = join(__dirname, '..', '..', 'docs', 'msm-examples');
  const templates: MsmTemplateMeta[] = [];

  if (!existsSync(templatesDir)) return templates;

  const files = readdirSync(templatesDir).filter(f => f.endsWith('.msm.yaml'));
  for (const file of files) {
    try {
      const yaml = readFileSync(join(templatesDir, file), 'utf-8');
      const parsed = parseMsm(yaml);
      templates.push({
        type: file.replace('.msm.yaml', ''),
        name: parsed.service.name,
        description: parsed.service.description ?? '',
        category: parsed.service.category,
        yaml,
      });
    } catch {
      // Skip templates that fail to parse
    }
  }

  return templates;
}

const msmTemplates = loadMsmTemplates();

export function msmRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/msm — Register a new MSM integration
  router.post('/v1/msm', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerName = req.auth!.owner;
    let definition;
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('text/yaml') || contentType.includes('application/x-yaml')) {
      let yamlStr: string;
      if (typeof req.body === 'string') {
        yamlStr = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        yamlStr = req.body.toString('utf-8');
      } else {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'For YAML content, send raw text with Content-Type: text/yaml'));
        return;
      }
      try {
        definition = parseMsm(yamlStr);
      } catch (err: unknown) {
        res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
          `Failed to parse YAML: ${(err as Error).message}`));
        return;
      }
    } else {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Request body is required'));
        return;
      }
      if (typeof req.body.yaml === 'string') {
        try {
          definition = parseMsm(req.body.yaml as string);
        } catch (err: unknown) {
          res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
            `Failed to parse YAML: ${(err as Error).message}`));
          return;
        }
      } else {
        definition = req.body;
      }
    }

    const validationErrors = validateMsm(definition);
    if (validationErrors.length > 0) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `MSM validation failed: ${validationErrors.join('; ')}`));
      return;
    }

    const existing = await storage.getMsm(definition.service.name);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'MSM_NAME_TAKEN',
        `MSM integration "${definition.service.name}" is already registered`));
      return;
    }

    const now = new Date().toISOString();
    const record = await storage.createMsm({
      name: definition.service.name,
      definition: definition as unknown as Record<string, unknown>,
      category: definition.service.category,
      authType: definition.auth.type,
      actionsCount: definition.actions.length,
      registeredBy: ownerName,
      registeredAt: now,
      updatedAt: now,
    });

    res.status(201).json(success(config.nodeId, {
      msm: {
        name: record.name,
        category: record.category,
        auth_type: record.authType,
        actions_count: record.actionsCount,
        registered_by: record.registeredBy,
        registered_at: record.registeredAt,
        definition: record.definition,
      },
    }, [
      { description: 'List all MSM integrations', method: 'GET', url: '/v1/msm' },
      { description: 'View this MSM', method: 'GET', url: `/v1/msm/${encodeURIComponent(record.name)}` },
    ]));
  });

  // GET /v1/msm — List registered MSMs
  router.get('/v1/msm', async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const msms = await storage.listMsms({ category });

    res.json(success(config.nodeId, {
      integrations: msms.map(m => ({
        name: m.name,
        category: m.category,
        auth_type: m.authType,
        actions_count: m.actionsCount,
        registered_by: m.registeredBy,
        registered_at: m.registeredAt,
        updated_at: m.updatedAt,
      })),
      total: msms.length,
    }));
  });

  // GET /v1/msm/templates — List available MSM templates (public, Tier 0)
  router.get('/v1/msm/templates', (_req, res) => {
    res.json(success(config.nodeId, {
      templates: msmTemplates.map(t => ({
        type: t.type,
        name: t.name,
        description: t.description,
        category: t.category,
      })),
      total: msmTemplates.length,
    }, msmTemplates.map(t => ({
      description: `View ${t.type} template`,
      method: 'GET',
      url: `/v1/msm/templates/${t.type}`,
    }))));
  });

  // GET /v1/msm/templates/:type — Get template as YAML
  router.get('/v1/msm/templates/:type', (req, res) => {
    const type = req.params.type as string;
    const template = msmTemplates.find(t => t.type === type);
    if (!template) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `MSM template "${type}" not found. Use GET /v1/msm/templates to list available templates.`));
      return;
    }
    res.status(200).type('application/x-yaml').send(template.yaml);
  });

  // GET /v1/msm/:name — Get a single MSM
  router.get('/v1/msm/:name', async (req, res) => {
    const name = req.params.name as string;
    const msm = await storage.getMsm(name);
    if (!msm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM integration "${name}" not found`));
      return;
    }

    res.json(success(config.nodeId, {
      msm: {
        name: msm.name,
        category: msm.category,
        auth_type: msm.authType,
        actions_count: msm.actionsCount,
        registered_by: msm.registeredBy,
        registered_at: msm.registeredAt,
        updated_at: msm.updatedAt,
        definition: msm.definition,
      },
    }, [
      { description: 'Delete this MSM', method: 'DELETE', url: `/v1/msm/${encodeURIComponent(msm.name)}` },
    ]));
  });

  // DELETE /v1/msm/:name — Delete an MSM
  router.delete('/v1/msm/:name', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = req.params.name as string;
    const ownerName = req.auth!.owner;

    const msm = await storage.getMsm(name);
    if (!msm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM integration "${name}" not found`));
      return;
    }

    const isOperator = req.auth!.roles.includes('operator');
    if (msm.registeredBy !== ownerName && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only delete MSM integrations you registered'));
      return;
    }

    await storage.deleteMsm(name);

    res.json(success(config.nodeId, { deleted: true, name }, [
      { description: 'Register a new MSM integration', method: 'POST', url: '/v1/msm' },
      { description: 'List remaining MSMs', method: 'GET', url: '/v1/msm' },
    ]));
  });

  return router;
}
```

**Modify `server.ts`:** Add import and mount:
```typescript
import { msmRouter } from './routes/msm.js';
// ... in createServer():
app.use(msmRouter(config, storage));
```

**Verification:** `npx tsc --noEmit` passes. Then:
```bash
curl localhost:40050/v1/msm/templates  # Returns 10 templates
curl localhost:40050/v1/msm/templates/weather-pricing  # Returns YAML
```

---

## Task 6: MSM admin endpoint + i18n translations

**Files:**
- Modify: `aimeat/src/routes/admin-features.ts` — add `GET /v1/admin/msm` endpoint
- Modify: `aimeat/locales/en.json` — add MSM translation keys
- Modify: `aimeat/locales/fi.json` — add MSM translation keys
- Modify: `aimeat/src/routes/admin-dashboard.ts` — add MSM translations to `buildDashboardTranslations()`, add `renderMsm()` function

**Admin endpoint (in admin-features.ts):**

Add to the service dependencies type:
```typescript
// No new service dependency needed — MSM data comes from storage directly
```

Add route (after CSM templates section):

```typescript
    // ── MSM Integrations ────────────────────────────────────
    router.get('/v1/admin/msm', ...auth, handle(async (_req, res) => {
        const msms = await storage.listMsms();
        res.json(success(config.nodeId, {
            integrations: msms.map(m => ({
                name: m.name,
                category: m.category,
                auth_type: m.authType,
                actions_count: m.actionsCount,
                registered_by: m.registeredBy,
                registered_at: m.registeredAt,
                updated_at: m.updatedAt,
                federate: m.federate ?? false,
            })),
            total: msms.length,
        }));
    }));
```

**Translation keys (en.json under "dashboard"):**

```json
"msm": "Integrations",
"msmLabel": "Integrations",
"msmExplain": "External API integrations (MSM — Machine Service Manifest)",
"msmCategory": "Category",
"msmAuthType": "Auth",
"msmActions": "Actions",
"noMsmIntegrations": "No MSM integrations registered"
```

**Translation keys (fi.json under "dashboard"):**

```json
"msm": "Integraatiot",
"msmLabel": "Integraatiot",
"msmExplain": "Ulkoiset API-integraatiot (MSM — Machine Service Manifest)",
"msmCategory": "Kategoria",
"msmAuthType": "Todennus",
"msmActions": "Toiminnot",
"noMsmIntegrations": "Ei rekisteröityjä MSM-integraatioita"
```

**Dashboard changes (admin-dashboard.ts):**

Add to `buildDashboardTranslations()`:
```typescript
msmLabel: t('dashboard.msmLabel'),
msmExplain: t('dashboard.msmExplain'),
msmCategory: t('dashboard.msmCategory'),
msmAuthType: t('dashboard.msmAuthType'),
msmActions: t('dashboard.msmActions'),
noMsmIntegrations: t('dashboard.noMsmIntegrations'),
```

Add `renderMsm()` function (mirrors renderCsm pattern):
```javascript
function renderMsm(){
  var d=D.msmIntegrations;
  if(!d||!d.integrations||d.integrations.length===0)return emptyState(__t.noMsmIntegrations);
  return dataTable(
    [__t.name,__t.msmCategory,__t.msmAuthType,__t.msmActions,__t.author,__t.registered,__t.updated],
    d.integrations.map(function(m){return [
      {text:m.name,mono:true},
      m.category,
      m.auth_type,
      String(m.actions_count),
      m.registered_by,
      dt(m.registered_at),
      dt(m.updated_at)
    ]}),
    {card:true,scroll:true}
  );
}
```

Add to `loadAll()` features Promise.allSettled array: `api('/v1/admin/msm')`
Add to results handling: `D.msmIntegrations=features[N].status==='fulfilled'?features[N].value.data:null;`

Add to `render()` switch: `case 'msm': ...` (rename existing 'csm' case to 'csmServices' or adjust)
— Actually, need to handle this carefully. The existing 'csm' page shows CSM services. We'll add 'msm' as a new page.

Add to `nav()` titles and `pages` array.

**Verification:** `npx tsc --noEmit` passes. Open dashboard, MSM section shows "No MSM integrations registered" empty state.

---

## Task 7: Dashboard nav reorganization — tier-based groups with dynamic sections

**Files:**
- Modify: `aimeat/src/routes/admin-dashboard.ts` — replace flat nav with grouped nav, add CSS for groups, update `nav()` + `updateSidebarLabels()` + `render()` + `loadAll()` to handle dynamic CSM/MSM items
- Modify: `aimeat/locales/en.json` — add group header translations
- Modify: `aimeat/locales/fi.json` — add group header translations

**Context:** Currently 20+ flat nav items. Reorganize into 7 groups with headers:

**New sidebar structure:**

```
NODE MANAGEMENT
  Overview | Economy | Config | Maintenance | Hooks

IDENTITY
  Owners | Agents | GHII

DATA
  Actions | Boards | Chats | Work

INFRASTRUCTURE
  Email | Push

SERVICES (dynamic + built-in)
  Directory | Matching | Marketplace
  + [each registered CSM as nav item]
  CSM Management (manage registrations)

INTEGRATIONS (dynamic)
  + [each registered MSM as nav item]
  MSM Management (manage registrations)

FEDERATION
  Federation | Genesis
```

**CSS additions (inside `<style>` block):**

```css
.nav-group-label{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding:8px 16px 2px;margin-top:6px}
```

**New translation keys (en.json):**

```json
"navNode": "Node",
"navIdentity": "Identity",
"navData": "Data",
"navInfrastructure": "Infrastructure",
"navServices": "Services",
"navIntegrations": "Integrations",
"navFederation": "Federation",
"csmManagement": "CSM Management",
"msmManagement": "MSM Management"
```

**New translation keys (fi.json):**

```json
"navNode": "Solmu",
"navIdentity": "Identiteetti",
"navData": "Data",
"navInfrastructure": "Infrastruktuuri",
"navServices": "Palvelut",
"navIntegrations": "Integraatiot",
"navFederation": "Federaatio",
"csmManagement": "CSM-hallinta",
"msmManagement": "MSM-hallinta"
```

**Sidebar HTML replacement** (replace lines 216-237 in admin-dashboard.ts):

Replace the flat list of nav buttons with grouped structure using `<div class="nav-group-label">` headers between groups. Use `nav-sep` dividers between groups. The `id="dynamicServices"` and `id="dynamicIntegrations"` containers will be populated client-side by `loadAll()`.

**Client-side dynamic rendering:**

In `loadAll()`, after loading CSM and MSM data, populate the dynamic nav containers:

```javascript
// After D.csmTemplates and D.msmIntegrations are loaded:
function renderDynamicNav() {
  var svcContainer = document.getElementById('dynamicServices');
  if (svcContainer && D.csmTemplates && D.csmTemplates.templates) {
    var html = '';
    for (var i = 0; i < D.csmTemplates.templates.length; i++) {
      var csm = D.csmTemplates.templates[i];
      html += '<button class="nav-item" onclick="navCsmService(\'' + esc(csm.name) + '\')">'
        + '<span class="icon">&#x1F4E6;</span>'
        + '<span class="label">' + esc(csm.name) + '</span></button>';
    }
    svcContainer.innerHTML = html;
  }

  var intContainer = document.getElementById('dynamicIntegrations');
  if (intContainer && D.msmIntegrations && D.msmIntegrations.integrations) {
    var html2 = '';
    for (var j = 0; j < D.msmIntegrations.integrations.length; j++) {
      var msm = D.msmIntegrations.integrations[j];
      html2 += '<button class="nav-item" onclick="navMsmIntegration(\'' + esc(msm.name) + '\')">'
        + '<span class="icon">&#x1F50C;</span>'
        + '<span class="label">' + esc(msm.name) + '</span></button>';
    }
    intContainer.innerHTML = html2;
  }
}
```

Add `navCsmService(name)` and `navMsmIntegration(name)` functions that set `currentPage` to a dynamic value and render a generic detail panel by fetching the full CSM/MSM definition from `/v1/csm/{name}` or `/v1/msm/{name}`.

**Update `updateSidebarLabels()`:** Must handle the new group structure. Built-in nav items use data attributes instead of positional index mapping (current approach is fragile). Change each static nav button to include `data-page="overview"` etc., then update labels by selecting `[data-page]` elements:

```javascript
function updateSidebarLabels(){
  var map = {
    overview:__t.overview, economy:__t.economy, config:__t.config,
    maintenance:__t.maintenance, hooks:__t.extensionHooks,
    owners:__t.owners, agents:__t.agents, ghii:__t.ghiiLabel,
    actions:__t.actions, boards:__t.boards, chatInstances:__t.chatInstances, work:__t.work,
    email:__t.emailLabel, push:__t.pushLabel,
    directory:__t.directoryLabel, matching:__t.matchingLabel, marketplace:__t.marketplaceLabel,
    csmManage:__t.csmManagement, msmManage:__t.msmManagement,
    federation:__t.federation, genesis:__t.genesisLabel
  };
  for(var page in map){
    var btn=document.querySelector('[data-page="'+page+'"]');
    if(btn){var lbl=btn.querySelector('.label');if(lbl&&map[page])lbl.textContent=map[page];}
  }
  // Update group labels
  var grpMap={navNode:__t.navNode,navIdentity:__t.navIdentity,navData:__t.navData,
    navInfrastructure:__t.navInfrastructure,navServices:__t.navServices,
    navIntegrations:__t.navIntegrations,navFederation:__t.navFederation};
  for(var grp in grpMap){
    var el=document.getElementById(grp);
    if(el&&grpMap[grp])el.textContent=grpMap[grp];
  }
}
```

**Update `nav()` function:** Update pages array and titles to include new pages (csmManage, msmManage) and handle dynamic CSM/MSM detail pages.

**Verification:**
1. `npx tsc --noEmit` passes
2. Open `/v1/admin/ui` — sidebar shows grouped navigation with headers
3. Built-in services (Directory, Matching, Marketplace) appear under "Services"
4. "CSM Management" and "MSM Management" show registration lists
5. Language switching updates all group headers and labels
6. If CSMs are registered, they appear as additional items in Services
7. If MSMs are registered, they appear in Integrations section

---

## Task 8: E2E tests for MSM endpoints + Phase 0 coverage

**Files:**
- Modify: `aimeat/test/e2e-admin-features.ts` — add MSM endpoint tests
- Create: `aimeat/test/e2e-phase0.ts` — dedicated Phase 0 E2E tests

**MSM tests (add to e2e-admin-features.ts):**

```
MSM Templates (2):
- GET /v1/msm/templates — returns array with 10 templates
- GET /v1/msm/templates/weather-pricing — returns YAML content

MSM CRUD (5):
- POST /v1/msm — register MSM from YAML, verify 201 + name + category + actions_count
- GET /v1/msm — list returns the registered MSM
- GET /v1/msm/{name} — returns full definition with actions
- DELETE /v1/msm/{name} — 403 when non-registerer tries to delete
- DELETE /v1/msm/{name} — operator can delete, verify gone

MSM Admin (1):
- GET /v1/admin/msm — returns integrations list with correct fields
```

**Phase 0 E2E tests (e2e-phase0.ts — new file, ~20 tests):**

Follow existing `e2e-full.ts` pattern. Tests:

```
Schema Locking (4):
- PUT /v1/memory/:key/schema — set schema, verify stored
- GET /v1/memory/:key/schema — read schema back
- POST /v1/memory — write data that violates schema → 400
- DELETE /v1/memory/:key/schema — remove schema

CSM Registration (4):
- GET /v1/csm/templates — list available templates
- POST /v1/csm (YAML) — register hobby-directory template
- GET /v1/csm — list shows registered service
- DELETE /v1/csm/{name} — cleanup

Consent Layer (5):
- POST /v1/consent — create consent grant
- GET /v1/consent — list own consents
- GET /v1/consent/:id — get single consent
- DELETE /v1/consent/:id — revoke consent
- GET /v1/consent/audit — audit trail includes revocation

TOTP (3):
- POST /v1/ghii/totp/setup — returns QR + secret
- POST /v1/ghii/totp/verify — verify with correct code → activated
- DELETE /v1/ghii/totp — disable TOTP

Translations (2):
- GET /v1/admin/translations?lang=en — has navServices, msmLabel keys
- GET /v1/admin/translations?lang=fi — has navServices key with "Palvelut"
```

**Verification:** Start server on port 40251, run both test files:
```bash
npx tsx test/e2e-phase0.ts
npx tsx test/e2e-admin-features.ts
```
All tests pass.

---

## Execution Order

```
Task 1 (DMZ doc)                 ─── critical, independent
Task 2 (Semantic ontology doc)   ─── critical, independent
Task 3 (MSM parser)              ─── depends on nothing
Task 4 (MSM storage)             ─── depends on Task 3
Task 5 (MSM routes)              ─── depends on Task 4
Task 6 (MSM admin + dashboard)   ─── depends on Task 5
Task 7 (Dashboard nav reorg)     ─── depends on Task 6
Task 8 (E2E tests)               ─── depends on Tasks 5, 7
```

Tasks 1, 2, and 3 can be done in parallel.

---

## Verification

1. `npx tsc --noEmit` — passes after each task
2. `pnpm build` — builds cleanly
3. `docs/aimeat-dmz-architecture.md` exists with 6+ sections
4. `docs/aimeat-semantic-ontology.md` exists with mapping table
5. `curl localhost:40050/v1/msm/templates` — returns 10 templates
6. Register an MSM, verify CRUD cycle works
7. Open `/v1/admin/ui` — sidebar shows tier-based groups
8. Built-in services under "Services", CSMs appear dynamically
9. Empty "Integrations" section with MSM management link
10. Language switching updates all groups and dynamic items
11. `npx tsx test/e2e-phase0.ts` — all tests pass
12. `npx tsx test/e2e-admin-features.ts` — all tests pass (including MSM)
