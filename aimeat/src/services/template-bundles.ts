/**
 * @file template-bundles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Loader + startup seeder for organism "template bundles" — a bundle is a set of
 *   object-type CSMs plus a manifest skeleton that turns a bare organism into a governed
 *   workspace of a given `kind` (the shipped one is `project`). A bundle is pure data:
 *   `docs/csm-bundles/{kind}/*.csm.yaml` (one CSM per object type) + `manifest.template.json`.
 *
 *   AIMEAT stays generic: there is NO project router and NO per-type endpoints. The object
 *   shapes are authored as CSMs (the single shape system), compiled with the existing
 *   `csmToJsonSchema`, and registered organism-scoped at apply time via the generic schema API
 *   (`PUT /v1/memory/{organism.{id}.<namespace>}/schema`). This module additionally seeds each
 *   bundle CSM GLOBALLY (idempotent, like `seedCsmTemplates`) so its compiled schema is
 *   fetchable via `GET /v1/csm/{name}` + `GET /v1/memory/csm.{name}/schema` — letting any
 *   client/agent apply a bundle through existing endpoints without a new apply route.
 * @structure
 *   - loadBundle(kind) — parse a bundle's CSMs + manifest skeleton, compile per-type JSON Schemas
 *   - seedTemplateBundles(storage, systemGaii) — register every bundle CSM globally (idempotent)
 *   - BUNDLE_KINDS — the shipped bundles (currently: 'project')
 * @usage
 *   import { loadBundle, seedTemplateBundles } from '../services/template-bundles.js';
 *   const { objects, manifestTemplate } = loadBundle('project');
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 3: ship + seed the project template bundle.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from '../storage/interface.js';
import { parseCsm, validateCsm, csmToJsonSchema, type CsmDefinition } from './csm-parser.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root directory holding `{kind}/` bundle folders. */
const BUNDLES_DIR = join(__dirname, '..', '..', 'docs', 'csm-bundles');

/** Bundles shipped with the node. */
export const BUNDLE_KINDS = ['project'] as const;

/** One object type within a bundle: the compiled shape + where its instances live. */
export interface BundleObjectType {
  /** Object-type name as used by the manifest + flow stages (e.g. "goal"). */
  name: string;
  /** Global CSM name the shape is registered under (e.g. "project-goal"). */
  csmName: string;
  /** Relative namespace under the organism (e.g. "meta.goals"). */
  namespace: string;
  /** open | strict — drives additionalProperties on write. */
  schemaMode: 'open' | 'strict';
  /** Compiled JSON Schema (from csmToJsonSchema). */
  jsonSchema: Record<string, unknown>;
}

export interface LoadedBundle {
  kind: string;
  /** The manifest skeleton (with __ORGANISM_ID__ / __NAME__ / __SUMMARY__ placeholders). */
  manifestTemplate: Record<string, unknown>;
  /** Memory-backed object types keyed by object-type name (task/tasks-backed types are omitted — no shape). */
  objects: Record<string, BundleObjectType>;
}

function bundleDir(kind: string): string {
  return join(BUNDLES_DIR, kind);
}

/**
 * Load + compile a bundle. Reads every `*.csm.yaml` (stem = object-type name, e.g. `goal`) and
 * the `manifest.template.json`, then maps each compiled CSM to its manifest namespace.
 * Throws if the bundle directory or manifest skeleton is missing.
 */
export function loadBundle(kind: string): LoadedBundle {
  const dir = bundleDir(kind);
  if (!existsSync(dir)) throw new Error(`Template bundle not found: ${kind}`);

  const manifestPath = join(dir, 'manifest.template.json');
  if (!existsSync(manifestPath)) throw new Error(`Bundle ${kind} is missing manifest.template.json`);
  const manifestTemplate = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;

  // Index manifest objectTypes by name → namespace, so a CSM file maps to its workspace location.
  const namespaceByType = new Map<string, string>();
  for (const ot of (manifestTemplate.objectTypes as Array<Record<string, unknown>> | undefined) ?? []) {
    if (typeof ot.name === 'string' && typeof ot.namespace === 'string') {
      namespaceByType.set(ot.name, ot.namespace);
    }
  }

  const objects: Record<string, BundleObjectType> = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.csm.yaml'))) {
    const typeName = basename(file, '.csm.yaml');
    const namespace = namespaceByType.get(typeName);
    if (!namespace) continue; // CSM file without a manifest objectType — skip
    const def = parseCsm(readFileSync(join(dir, file), 'utf-8'));
    const errors = validateCsm(def);
    if (errors.length > 0) throw new Error(`Bundle ${kind}/${file} invalid CSM: ${errors.join('; ')}`);
    objects[typeName] = {
      name: typeName,
      csmName: def.service.name,
      namespace,
      schemaMode: def.schemaMode,
      jsonSchema: csmToJsonSchema(def),
    };
  }

  return { kind, manifestTemplate, objects };
}

/**
 * Seed every shipped bundle's object CSMs globally (idempotent by CSM name) so their compiled
 * schemas are discoverable + fetchable through the existing CSM API. Mirrors `seedCsmTemplates`.
 *
 * @returns number of newly registered bundle CSMs.
 */
export async function seedTemplateBundles(storage: Storage, systemGaii: string): Promise<number> {
  let seeded = 0;
  const now = new Date().toISOString();

  for (const kind of BUNDLE_KINDS) {
    const dir = bundleDir(kind);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir).filter(f => f.endsWith('.csm.yaml'))) {
      try {
        const def: CsmDefinition = parseCsm(readFileSync(join(dir, file), 'utf-8'));
        const errors = validateCsm(def);
        if (errors.length > 0) {
          logger.warn(`Skipping invalid bundle CSM ${kind}/${file}: ${errors.join('; ')}`);
          continue;
        }

        if (await storage.getCsm(def.service.name)) continue; // idempotent

        const schemaKey = `csm.${def.service.name}`;
        await storage.setSchema({
          keyPattern: schemaKey,
          applyTo: 'prefix',
          schemaJson: csmToJsonSchema(def),
          schemaMode: def.schemaMode,
          lockedBy: systemGaii,
          setAt: now,
          updatedAt: now,
        });
        await storage.createCsm({
          name: def.service.name,
          definition: def as unknown as Record<string, unknown>,
          jsonSchemaKey: schemaKey,
          serviceType: def.service.type,
          registeredBy: systemGaii,
          registeredAt: now,
          updatedAt: now,
        });
        seeded++;
      } catch (err) {
        logger.warn(`Failed to seed bundle CSM ${kind}/${file}`, { error: (err as Error).message });
      }
    }
  }

  return seeded;
}
