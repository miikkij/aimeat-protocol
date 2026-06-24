/**
 * @file organism-template.ts
 * @description Use-case TEMPLATES (Secretary P5 / S-B): a packaged organism BLUEPRINT — pure DATA, not
 *   code. A template is a content-free organism bundle (skeleton: workspace structure/schemas/purpose,
 *   no objects/images) plus a top-level `template.json` carrying specialist directives + extension
 *   dependency refs + scope presets. Built on the organism export/import substrate (no per-service
 *   backend file): export reuses exportOrganism's `skeleton` + `templateJson`; instantiate reuses
 *   restoreOrganismFromFiles to create the empty organism + workspaces, then adds the specialists
 *   (S-A's ensureSpecialist) and CHECKS the extension deps — reporting unmet ones, never crashing.
 * @structure TEMPLATE_VERSION · TemplateJson · buildTemplateJson() · exportTemplate() · instantiateTemplate() ·
 *   buildConnectorPrompt() · publishTemplateCatalogEntry() · TEMPLATE_CATALOG_PREFIX
 * @usage const { buffer } = await exportTemplate(storage, config, { orgId, exporterGaii, exportedAt, template });
 *        const result = await instantiateTemplate(storage, config, { importerGaii, importerOwner, zip });
 * @version-history
 *   v1.2.0 — 2026-06-25 — Scope-consent: a template specialist may declare `requestedScopes` (extras beyond
 *     the conservative baseline). Instantiate NEVER grants extras silently — it provisions each specialist
 *     conservatively and REPORTS the requestable extras per specialist (scope + description), like the
 *     unmet-extension-deps list, so the owner can consent (POST /v1/specialists approved_scopes) afterward.
 *   v1.1.0 — 2026-06-24 — Secretary P5 (S-D): unmet extension deps now carry a `build_prompt` (paste-to-
 *     Claude-Code instructions that build + install the connector over the appdev MCP, satisfying the
 *     dep — self-heal), and templates can be PUBLISHED to a public catalog (template.catalog.*) so the
 *     `templates` DiscoverySource surfaces them via GET /v1/discover.
 *   v1.0.0 — 2026-06-24 — Initial: use-case template format + instantiate flow (Secretary P5 S-B)
 */
import type { Storage, DirectiveRule } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { exportOrganism } from './organism-export.js';
import { restoreOrganismFromFiles } from './organism-import.js';
import { unzipBuffer } from './workspace-import.js';
import { SPECIALIST_ROLES, requestedExtras, describeScopes } from '../mcp/catalog/scopes.js';
import { ensureSpecialist, writeSpecialistPolicy } from './specialist.js';

export const TEMPLATE_VERSION = '1.0';

/** A specialist the template provisions on instantiate. */
export interface TemplateSpecialist {
  name: string;
  role?: string;
  displayName?: string;
  description?: string;
  brain?: { purpose?: string; rules?: Array<{ id?: string; description: string }> };
  policy?: unknown;
  /** Extra scopes (beyond the role baseline) the specialist would LIKE — never granted silently; reported
   *  on instantiate for the owner to consent to. Bounded by the SCOPE_DESCRIPTIONS vocabulary. */
  requestedScopes?: string[];
}

/** An extension the template depends on (checked at instantiate; unmet ones are reported). */
export interface TemplateExtensionDep {
  name: string;
  version?: string;
  reason?: string;
}

/** The `template.json` payload carried inside a use-case template ZIP. */
export interface TemplateJson {
  aimeatTemplate: string;
  exportedAt: string;
  source?: { organismId: string; nodeId: string };
  title?: string;
  description?: string;
  specialists: TemplateSpecialist[];
  extensions: TemplateExtensionDep[];
  scopePresets?: Record<string, string[]>;
}

/** Allowed entry layout for a use-case template ZIP — the organism bundle layout plus template.json. */
const TEMPLATE_ALLOW = (n: string) =>
  n === 'organism.json' ||
  n === 'template.json' ||
  /^workspaces\/[A-Za-z0-9_-]+\/workspace\.json$/.test(n) ||
  /^workspaces\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9._-]+$/.test(n);

/** Build a normalized TemplateJson from caller-supplied template metadata. */
export function buildTemplateJson(
  config: AimeatConfig,
  opts: { orgId: string; exportedAt: string; title?: string; description?: string;
          specialists?: TemplateSpecialist[]; extensions?: TemplateExtensionDep[]; scopePresets?: Record<string, string[]> },
): TemplateJson {
  const specialists = (opts.specialists ?? []).filter(s => s && typeof s.name === 'string').map(s => ({
    name: String(s.name).trim().toLowerCase(),
    role: (s.role && (SPECIALIST_ROLES as readonly string[]).includes(s.role)) ? s.role : 'specialist',
    displayName: s.displayName,
    description: s.description,
    brain: s.brain,
    policy: s.policy,
    requestedScopes: Array.isArray(s.requestedScopes) ? s.requestedScopes.filter(x => typeof x === 'string') : undefined,
  }));
  const extensions = (opts.extensions ?? []).filter(e => e && typeof e.name === 'string').map(e => ({
    name: String(e.name).trim(),
    version: e.version,
    reason: e.reason,
  }));
  return {
    aimeatTemplate: TEMPLATE_VERSION,
    exportedAt: opts.exportedAt,
    source: { organismId: opts.orgId, nodeId: config.nodeId },
    title: opts.title,
    description: opts.description,
    specialists,
    extensions,
    scopePresets: opts.scopePresets,
  };
}

/** Export an organism as a use-case template (content-free skeleton + template.json). */
export async function exportTemplate(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; exporterGaii: string; exportedAt: string;
          template: { title?: string; description?: string; specialists?: TemplateSpecialist[]; extensions?: TemplateExtensionDep[]; scopePresets?: Record<string, string[]> } },
): Promise<{ buffer: Buffer; filename: string; workspaces: number }> {
  const templateJson = buildTemplateJson(config, { orgId: opts.orgId, exportedAt: opts.exportedAt, ...opts.template });
  return exportOrganism(storage, config, {
    orgId: opts.orgId, exporterGaii: opts.exporterGaii, exportedAt: opts.exportedAt,
    skeleton: true, templateJson: templateJson as unknown as Record<string, unknown>,
  });
}

export interface TemplateInstantiateResult {
  organism_id: string;
  name: string;
  workspaces: Array<{ from: string; ws: string }>;
  // `requested_scopes` = the extras this specialist would LIKE beyond its conservative baseline (each with a
  // plain-language description). They are NOT granted on instantiate — the owner consents afterward via
  // POST /v1/specialists { approved_scopes }. Empty when the role/template declares no extras.
  specialists: Array<{ name: string; gaii: string; role: string; created: boolean; scopes: string[]; requested_scopes: Array<{ scope: string; description: string }> }>;
  unmet_extensions: Array<{ name: string; version?: string; reason?: string; build_prompt: string }>;
  scope_presets: Record<string, string[]>;
}

/**
 * Generate a paste-to-Claude-Code (or any agent) BUILD PROMPT that builds + installs the missing
 * connector extension over the appdev MCP — the "missing dependency = self-describing, self-healed"
 * flow (Secretary P5 / S-D). The prompt encodes the AIMEAT extension contract: a `manifest.yaml`
 * (metadata + actions + per-instance `type: secret` config for a bring-your-own-key API key), a
 * sandboxed action (`export default async function (ctx, input)`, SSRF-guarded `ctx.fetch`, results
 * cached into `ext:` memory), and installation via the `aimeat_extension_install` MCP tool.
 */
export function buildConnectorPrompt(dep: TemplateExtensionDep, nodeId: string): string {
  const reason = dep.reason ? ` Its purpose: ${dep.reason}.` : '';
  return [
    `Build and install an AIMEAT extension named "${dep.name}" on this node (${nodeId}) — it is a`,
    `missing dependency of a use-case template I just instantiated.${reason}`,
    '',
    'Build it as a standard AIMEAT extension (a connector):',
    `1. A manifest (extension.yaml) with metadata.name "${dep.name}"${dep.version ? ` version ${dep.version}` : ''}, a short`,
    '   description + author, required_apis: [memory], and at least one action (method POST) whose script is',
    '   "actions/pull.js". Support multi-instance with a per-tenant SECRET API key:',
    '       instances:',
    '         supported: true',
    '         config_per_instance:',
    '           type: object',
    '           properties:',
    '             apiKey: { type: secret, label: "API key", description: "Secret API key (encrypted at rest)." }',
    '             baseUrl: { type: string, label: "Base URL" }',
    '           required: [apiKey]',
    '   (type: secret fields are encrypted at rest with the node key and decrypted only inside the sandbox —',
    '    NEVER hardcode a key, and use bring-your-own-key per instance for any paid third-party API.)',
    '2. The action script must be `export default async function (ctx, input) { ... }`. Read the secret via',
    '   `ctx.instance.config.apiKey` (already decrypted), fetch the upstream endpoint with `ctx.fetch(url, {...})`',
    '   (it enforces the SSRF guard — internal hosts are rejected), and cache the result with',
    '   `await ctx.memory.set("latest", {...})` so consumers can read it from `ext:' + dep.name + '` memory.',
    '3. Install it over the appdev MCP with the `aimeat_extension_install` tool (pass the manifest + the',
    '   scripts map, or omit the content to get a presigned upload URL and PUT a ZIP). Then activate it',
    `   (\`aimeat_extension_activate\`) and create an instance with the real API key. Re-running the template`,
    '   instantiate will then find the dependency satisfied.',
    '',
    'Mirror the reference connector at docs/extensions/rest-connector/ for the exact manifest + script shape.',
  ].join('\n');
}

/** Public-memory namespace prefix where published use-case templates are catalogued (for discovery). */
export const TEMPLATE_CATALOG_PREFIX = 'template.catalog.';

/** Max base64 ZIP size to embed in a catalog entry (templates are content-free skeletons → small). */
const MAX_CATALOG_ZIP_B64 = 400_000;

/**
 * Publish a use-case template into the public catalog so the `templates` DiscoverySource surfaces it via
 * GET /v1/discover (Secretary P5 / S-D). Stores a public memory record under the publisher's GHII; the
 * content-free skeleton ZIP is embedded (base64) when small enough so a discovered template is directly
 * instantiable. Returns the catalog key.
 */
export async function publishTemplateCatalogEntry(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    publisherGhii: string; orgId: string; publishedAt: string;
    title: string; description?: string; tags?: string[];
    specialists?: TemplateSpecialist[]; extensions?: TemplateExtensionDep[];
    zipBase64?: string;
  },
): Promise<{ key: string; slug: string }> {
  const slug = (opts.title || opts.orgId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'template';
  const key = `${TEMPLATE_CATALOG_PREFIX}${slug}`;
  const tags = Array.from(new Set(['template', ...(opts.tags ?? [])].map(t => String(t).trim().toLowerCase()).filter(Boolean)));
  const value: Record<string, unknown> = {
    id: slug,
    title: opts.title,
    description: opts.description ?? '',
    tags,
    specialists: (opts.specialists ?? []).map(s => ({ name: s.name, role: s.role ?? 'specialist' })),
    extensions: (opts.extensions ?? []).map(e => ({ name: e.name, reason: e.reason })),
    source_org: opts.orgId,
    published_by: opts.publisherGhii,
    published_at: opts.publishedAt,
  };
  if (opts.zipBase64 && opts.zipBase64.length <= MAX_CATALOG_ZIP_B64) value.zip_base64 = opts.zipBase64;

  const existing = await storage.getMemory(opts.publisherGhii, key);
  await storage.setMemory({
    key, ownerGaii: opts.publisherGhii, value, visibility: 'public', tags,
    ttlHours: null, version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? opts.publishedAt, updatedAt: opts.publishedAt,
  });
  return { key, slug };
}

/** Normalize template brain rules → stored DirectiveRule[]. */
function normalizeRules(raw: Array<{ id?: string; description: string }> | undefined): DirectiveRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r, idx) => {
      const description = typeof r?.description === 'string' ? r.description : '';
      if (!description.trim()) return null;
      return { id: r.id && typeof r.id === 'string' ? r.id : `rule-${idx + 1}`, description };
    })
    .filter((r): r is DirectiveRule => r !== null);
}

/**
 * Instantiate a use-case template ZIP: create the empty organism + workspaces from the skeleton, add the
 * specialists (each with its own brain + operating-model policy + scope profile), and CHECK the extension
 * dependencies — reporting any that are not installed, never crashing on an unmet dep.
 */
export async function instantiateTemplate(
  storage: Storage,
  config: AimeatConfig,
  opts: { importerGaii: string; importerOwner: string; zip: Buffer },
): Promise<TemplateInstantiateResult> {
  const { importerGaii, importerOwner, zip } = opts;
  const files = await unzipBuffer(zip, TEMPLATE_ALLOW);

  // 1) Create the organism + restore the (empty) workspaces from the skeleton.
  const org = await restoreOrganismFromFiles(storage, config, { importerGaii, importerOwner, files });

  // 2) Parse template.json (optional — a plain skeleton with no template.json still instantiates fine).
  let tpl: TemplateJson | null = null;
  const tplBuf = files.get('template.json');
  if (tplBuf) {
    try {
      const parsed = JSON.parse(tplBuf.toString('utf8')) as TemplateJson;
      if (parsed && parsed.aimeatTemplate === TEMPLATE_VERSION) tpl = parsed;
    } catch { /* a malformed template.json is ignored — the organism + workspaces still materialize */ }
  }

  const specialists: TemplateInstantiateResult['specialists'] = [];
  const unmet: TemplateInstantiateResult['unmet_extensions'] = [];

  if (tpl) {
    // 2a) Provision the specialists (idempotent; skip names that collide with a non-specialist agent).
    for (const s of (tpl.specialists ?? [])) {
      try {
        // Provision CONSERVATIVELY — a template never grants requested extras silently. The owner consents
        // to them afterward (POST /v1/specialists { approved_scopes }); we only REPORT what was requested.
        const { record, created, role } = await ensureSpecialist(storage, config, importerOwner, {
          name: s.name, role: s.role, displayName: s.displayName, description: s.description,
        });
        if (s.brain) {
          await storage.upsertAgentDirectives({
            agentGaii: record.gaii,
            purpose: typeof s.brain.purpose === 'string' ? s.brain.purpose : '',
            rules: normalizeRules(s.brain.rules),
            memoryAreas: [], resources: [], updatedAt: new Date().toISOString(),
          });
        }
        await writeSpecialistPolicy(storage, config, importerOwner, s.name, s.policy, role);
        const extras = requestedExtras(role, Array.isArray(s.requestedScopes) ? s.requestedScopes : []);
        specialists.push({
          name: record.name, gaii: record.gaii, role, created,
          scopes: record.defaultScopes ?? [],
          requested_scopes: describeScopes(extras),
        });
      } catch { /* a single bad specialist must not abort the whole instantiate */ }
    }

    // 2b) Check the extension dependencies — report unmet ones with a self-heal BUILD PROMPT (S-D).
    // An unmet dep is NOT a failure: the organism + workspaces + specialists still materialize.
    for (const dep of (tpl.extensions ?? [])) {
      const ext = await storage.getExtension(dep.name).catch(() => null);
      if (!ext) unmet.push({ name: dep.name, version: dep.version, reason: dep.reason, build_prompt: buildConnectorPrompt(dep, config.nodeId) });
    }
  }

  return {
    organism_id: org.organism_id,
    name: org.name,
    workspaces: org.workspaces,
    specialists,
    unmet_extensions: unmet,
    scope_presets: tpl?.scopePresets ?? {},
  };
}
