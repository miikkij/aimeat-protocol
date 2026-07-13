/**
 * @file cortex-manifest.ts
 * @description Parses and validates Cortex extension manifests (YAML): apiVersion/kind/metadata/spec,
 *   per-component validation (schema, prompt, action, board-template, ontology, seed-data, lib),
 *   static safety warnings for lib code, and namespace ownership checks.
 * @structure parseCortexManifest() entry point; validate*Component() per type; validateNamespaceOwnership().
 * @usage import { parseCortexManifest, validateNamespaceOwnership } from '../services/cortex-manifest.js';
 * @version-history
 *   v1.1.0 — 2026-07-13 — lib components without exports / api_surface now produce discovery warnings
 *     (the capability aggregator publishes exactly those fields; empty ones make the cortex
 *     undiscoverable via GET /v1/capabilities).
 *   v1.0.0 — 2026-05-02 — extracted manifest parsing for the cortex layer.
 */
import { parse as parseYaml } from 'yaml';
import { createRequire } from 'node:module';
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
  CortexActivationArtifacts,
} from '../storage/interface.js';

// CJS-ESM interop: ajv and ajv-formats are CJS packages
const require = createRequire(import.meta.url);
 
const ajvPkg = require('ajv');
const formatsPkg = require('ajv-formats');
 
const AjvClass = ajvPkg.default ?? ajvPkg;
const addFormats = formatsPkg.default ?? formatsPkg;
 
const ajv = new AjvClass({ allErrors: true, verbose: true }) as { compile: (schema: object) => unknown };
addFormats(ajv);

export interface ParseResult {
  ok: boolean;
  extension?: CortexExtensionRecord;
  errors?: string[];
  warnings?: string[];
}

const REQUIRED_API_VERSION = 'cortex.aimeat.org/v1';
const REQUIRED_KIND = 'Extension';

// Patterns that are suspicious in lib code — produce warnings, not errors
const UNSAFE_PATTERNS = [
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/, label: 'new Function()' },
  { pattern: /\bdocument\.cookie\b/, label: 'document.cookie' },
  { pattern: /\bfetch\s*\(\s*['"`]https?:/, label: 'external fetch()' },
];

/**
 * Parse and validate a Cortex extension manifest from YAML string.
 */
export function parseCortexManifest(
  yamlString: string,
  installedBy: string,
  libs?: Record<string, string>,
): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Parse YAML
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(yamlString) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, errors: [`YAML parse error: ${(err as Error).message}`] };
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Manifest must be a YAML object'] };
  }

  // Validate apiVersion and kind
  if (doc.apiVersion !== REQUIRED_API_VERSION) {
    errors.push(`apiVersion must be "${REQUIRED_API_VERSION}", got "${String(doc.apiVersion ?? '')}"`);
  }
  if (doc.kind !== REQUIRED_KIND) {
    errors.push(`kind must be "${REQUIRED_KIND}", got "${String(doc.kind ?? '')}"`);
  }

  // Validate metadata
  const metadata = doc.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object') {
    errors.push('metadata is required and must be an object');
    return { ok: false, errors, warnings };
  }

  const name = metadata.name as string | undefined;
  const namespace = metadata.namespace as string | undefined;
  if (!name || typeof name !== 'string') {
    errors.push('metadata.name is required and must be a string');
  }
  if (!namespace || typeof namespace !== 'string') {
    errors.push('metadata.namespace is required and must be a string');
  }

  // Extract optional metadata fields
  const shortName = (metadata.shortName as string) ?? (name ?? '').split('/').pop() ?? '';
  const labels = (metadata.labels as Record<string, string>) ?? {};
  const tags = Array.isArray(metadata.tags) ? metadata.tags as string[] : [];
  const visibility = (metadata.visibility as string) === 'public' ? 'public' as const : 'private' as const;

  // Validate spec
  const spec = doc.spec as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== 'object') {
    errors.push('spec is required and must be an object');
    return { ok: false, errors, warnings };
  }

  const version = spec.version as string | undefined;
  if (!version || typeof version !== 'string') {
    errors.push('spec.version is required and must be a string');
  }

  const description = (metadata.description as string) ?? (spec.description as string) ?? '';
  const author = (metadata.author as string) ?? (spec.author as string) ?? '';
  const license = spec.license as string | undefined;
  const aimeatCompat = spec.aimeatCompat as string | undefined;

  const rawComponents = spec.components;
  if (!Array.isArray(rawComponents)) {
    errors.push('spec.components is required and must be an array');
    return { ok: false, errors, warnings };
  }

  // Early bail if critical errors
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // Validate each component
  const components: CortexComponent[] = [];
  for (let i = 0; i < rawComponents.length; i++) {
    const raw = rawComponents[i] as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
      errors.push(`components[${i}]: must be an object`);
      continue;
    }

    const type = raw.type as string;
    if (!type) {
      errors.push(`components[${i}]: type is required`);
      continue;
    }

    switch (type) {
      case 'schema':
        validateSchemaComponent(raw, i, components, errors, warnings);
        break;
      case 'prompt':
        validatePromptComponent(raw, i, components, errors);
        break;
      case 'action':
        validateActionComponent(raw, i, components, errors, warnings);
        break;
      case 'board-template':
        validateBoardTemplateComponent(raw, i, components, errors);
        break;
      case 'ontology':
        validateOntologyComponent(raw, i, components, errors);
        break;
      case 'seed-data':
        validateSeedDataComponent(raw, i, components, errors);
        break;
      case 'lib':
        validateLibComponent(raw, i, components, errors, warnings, libs);
        break;
      default:
        warnings.push(`components[${i}]: unknown type "${type}", skipping`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const now = new Date().toISOString();
  const emptyArtifacts: CortexActivationArtifacts = {
    schemaKeys: [],
    promptKeys: [],
    actionIds: [],
    boardIds: [],
    seedDataKeys: [],
    ontologyKeys: [],
    libFiles: [],
  };

  const extension: CortexExtensionRecord = {
    name: name!,
    namespace: namespace!,
    shortName,
    apiVersion: doc.apiVersion as string,
    version: version!,
    description,
    author,
    license,
    tags,
    labels,
    aimeatCompat,
    status: 'inactive',
    visibility,
    installedAt: now,
    installedBy,
    manifest: yamlString,
    components,
    activationArtifacts: emptyArtifacts,
  };

  return { ok: true, extension, warnings: warnings.length > 0 ? warnings : undefined };
}

function validateSchemaComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
  warnings: string[],
): void {
  const comp: Partial<CortexSchemaComponent> = { type: 'schema' };

  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: schema component requires name`);
    return;
  }
  comp.name = raw.name as string;

  if (!raw.key_pattern || typeof raw.key_pattern !== 'string') {
    errors.push(`components[${index}]: schema component requires key_pattern`);
    return;
  }
  comp.key_pattern = raw.key_pattern as string;

  const applyTo = raw.apply_to as string | undefined;
  if (applyTo && applyTo !== 'prefix' && applyTo !== 'exact') {
    errors.push(`components[${index}]: apply_to must be "prefix" or "exact"`);
    return;
  }
  comp.apply_to = (applyTo ?? 'exact') as 'prefix' | 'exact';

  if (!raw.schema || typeof raw.schema !== 'object') {
    errors.push(`components[${index}]: schema component requires schema object`);
    return;
  }
  comp.schema = raw.schema as Record<string, unknown>;

  // Validate the embedded JSON Schema is valid
  try {
    ajv.compile(comp.schema);
  } catch (err) {
    warnings.push(`components[${index}]: embedded JSON Schema has issues: ${(err as Error).message}`);
  }

  components.push(comp as CortexSchemaComponent);
}

function validatePromptComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
): void {
  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: prompt component requires name`);
    return;
  }
  if (!raw.content || typeof raw.content !== 'string') {
    errors.push(`components[${index}]: prompt component requires content`);
    return;
  }

  const comp: CortexPromptComponent = {
    type: 'prompt',
    name: raw.name as string,
    content: raw.content as string,
    variables: Array.isArray(raw.variables) ? raw.variables as string[] : undefined,
  };
  components.push(comp);
}

function validateActionComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
  warnings: string[],
): void {
  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: action component requires name`);
    return;
  }
  if (!raw.description || typeof raw.description !== 'string') {
    errors.push(`components[${index}]: action component requires description`);
    return;
  }
  if (!raw.input_schema || typeof raw.input_schema !== 'object') {
    errors.push(`components[${index}]: action component requires input_schema`);
    return;
  }

  // Validate input_schema is valid JSON Schema
  try {
    ajv.compile(raw.input_schema as Record<string, unknown>);
  } catch (err) {
    warnings.push(`components[${index}]: input_schema has issues: ${(err as Error).message}`);
  }

  const comp: CortexActionComponent = {
    type: 'action',
    name: raw.name as string,
    description: raw.description as string,
    input_schema: raw.input_schema as Record<string, unknown>,
  };
  components.push(comp);
}

function validateBoardTemplateComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
): void {
  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: board-template component requires name`);
    return;
  }
  if (!raw.title || typeof raw.title !== 'string') {
    errors.push(`components[${index}]: board-template component requires title`);
    return;
  }

  const visibility = raw.visibility as string | undefined;
  if (visibility && !['public', 'private', 'shared'].includes(visibility)) {
    errors.push(`components[${index}]: board-template visibility must be "public", "private", or "shared"`);
    return;
  }

  const comp: CortexBoardTemplateComponent = {
    type: 'board-template',
    name: raw.name as string,
    title: raw.title as string,
    description: (raw.description as string) ?? '',
    visibility: (visibility ?? 'public') as 'public' | 'private' | 'shared',
    seed_posts: Array.isArray(raw.seed_posts)
      ? (raw.seed_posts as Array<{ title: string; body: string }>).filter(
        p => typeof p.title === 'string' && typeof p.body === 'string'
      )
      : undefined,
  };
  components.push(comp);
}

function validateOntologyComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
): void {
  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: ontology component requires name`);
    return;
  }
  if (!raw.concepts || typeof raw.concepts !== 'object') {
    errors.push(`components[${index}]: ontology component requires concepts`);
    return;
  }

  const comp: CortexOntologyComponent = {
    type: 'ontology',
    name: raw.name as string,
    description: (raw.description as string) ?? '',
    concepts: raw.concepts as CortexOntologyComponent['concepts'],
  };
  components.push(comp);
}

function validateSeedDataComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
): void {
  if (!Array.isArray(raw.entries)) {
    errors.push(`components[${index}]: seed-data component requires entries array`);
    return;
  }

  for (let j = 0; j < raw.entries.length; j++) {
    const entry = raw.entries[j] as Record<string, unknown>;
    if (!entry || typeof entry.key !== 'string') {
      errors.push(`components[${index}].entries[${j}]: requires key string`);
      return;
    }
  }

  const comp: CortexSeedDataComponent = {
    type: 'seed-data',
    entries: raw.entries as Array<{ key: string; value: unknown }>,
  };
  components.push(comp);
}

function validateLibComponent(
  raw: Record<string, unknown>,
  index: number,
  components: CortexComponent[],
  errors: string[],
  warnings: string[],
  libs?: Record<string, string>,
): void {
  if (!raw.name || typeof raw.name !== 'string') {
    errors.push(`components[${index}]: lib component requires name`);
    return;
  }
  if (!raw.filename || typeof raw.filename !== 'string') {
    errors.push(`components[${index}]: lib component requires filename`);
    return;
  }

  const filename = raw.filename as string;

  // Check that lib content was provided
  if (libs && libs[filename]) {
    const content = libs[filename];
    // Static safety checks — produce WARNINGS, not errors
    for (const { pattern, label } of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        warnings.push(`components[${index}]: lib "${filename}" contains ${label} — review before activation`);
      }
    }
  }

  const exportNames = Array.isArray(raw.exports) ? raw.exports as string[] : [];
  const apiSurface = (raw.api_surface as string) ?? '';

  // Discovery contract: the capability aggregator publishes exactly these two fields as the
  // cortex's callable surface (GET /v1/capabilities). Empty ones make the lib undiscoverable
  // to agents — warn loudly, but don't block the install.
  if (exportNames.length === 0) {
    warnings.push(`components[${index}]: lib "${filename}" declares no exports — agents cannot `
      + 'discover its API via GET /v1/capabilities. List the public function/member names in "exports".');
  }
  if (!apiSurface.trim()) {
    warnings.push(`components[${index}]: lib "${filename}" has no api_surface — capability discovery `
      + 'will show no call signatures. Describe the public API (signatures + return shapes) in "api_surface".');
  }

  const comp: CortexLibComponent = {
    type: 'lib',
    name: raw.name as string,
    filename,
    exports: exportNames,
    api_surface: apiSurface,
  };
  components.push(comp);
}

/**
 * Validate that the namespace is owned by the installing user.
 * Simple check: namespace must start with the owner name or be a well-known prefix.
 */
export function validateNamespaceOwnership(namespace: string, ownerName: string): boolean {
  // Owner can use their own namespace
  if (namespace === ownerName || namespace.startsWith(`${ownerName}/`)) {
    return true;
  }
  // Operators can use any namespace — caller should check role separately
  // Well-known community namespace
  if (namespace === 'community' || namespace.startsWith('community/')) {
    return true;
  }
  return false;
}
