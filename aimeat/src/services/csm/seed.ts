/**
 * @file src/services/csm/seed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Startup seeder for CSM (Content Structure Model) templates — reads `.csm.yaml` files
 *   from docs/csm-examples/, validates them, generates JSON Schemas, and registers both the locked
 *   schema and the CSM record in storage. A template this build changes reaches a node whose copy
 *   nobody replaced; a copy replaced on the node (PUT /v1/csm/{name}) is left alone
 *   (services/seed/stamped-seed.ts). The schema lock follows the record when the record is this
 *   build's and a node seeder holds the lock.
 *
 * @structure
 *   - seedCsmTemplates(storage, systemGaii): main entry that parses, validates, and registers each template
 *   - seedCsmDefinition(storage, def, systemGaii, opts): one CSM and its lock, through seedStamped;
 *     also what services/template-bundles.ts seeds its object CSMs with
 *   - uses parseCsm/validateCsm/csmToJsonSchema from csm-parser for parsing and schema generation
 *
 * @version-history
 *   v1.2.0 — 2026-11-21 — The record goes through seedStamped (seedCsmDefinition): an unreplaced copy
 *     follows this build, kept as the previous version in the CSM's history. A copy from before stamps
 *     counts as unreplaced while it is still at version 1 and registered by a node seeder. The lock is
 *     refreshed only while the record is this build's, so a replaced CSM keeps the lock of its own
 *     definition.
 *   v1.1.1 — 2026-11-07 — Moved unchanged from src/services/csm-seed.ts into the csm domain folder
 *     (check:services-flat); the imports and the templates path gain one `..` for the deeper folder.
 *   v1.1.0 — 2026-10-11 — An existing template's `system@` schema lock is refreshed when this build
 *     compiles it differently. The parser learned the JSON Schema keyword names the templates use,
 *     and without the refresh every node seeded before that would keep the limitless schemas.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from '../../storage/interface.js';
import { isDeepStrictEqual } from 'node:util';
import { parseCsm, validateCsm, csmToJsonSchema, type CsmDefinition } from '../csm-parser.js';
import { isSystemSeeded } from '../manifest-schema.js';
import { logger } from '../../utils/logger.js';
import { seedStamped, type StampedSeedAction } from '../seed/stamped-seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Seed CSM template schemas and records on server startup.
 * Reads all .csm.yaml files from docs/csm-examples/, parses them,
 * generates JSON Schemas, and registers both the schema (via Schema Locking)
 * and the CSM record in storage, through seedCsmDefinition.
 *
 * @param storage  Storage implementation
 * @param systemGaii  System identity used as registeredBy / lockedBy (e.g. "system@node-id")
 * @returns Number of CSM templates written (created + brought up to this build)
 */
export async function seedCsmTemplates(storage: Storage, systemGaii: string): Promise<number> {
  const templatesDir = join(__dirname, '..', '..', '..', 'docs', 'csm-examples');

  if (!existsSync(templatesDir)) {
    logger.debug('CSM templates directory not found, skipping seed', { path: templatesDir });
    return 0;
  }

  const files = readdirSync(templatesDir).filter(f => f.endsWith('.csm.yaml'));
  if (files.length === 0) return 0;

  let seeded = 0;

  for (const file of files) {
    try {
      const yaml = readFileSync(join(templatesDir, file), 'utf-8');
      const definition = parseCsm(yaml);

      // Validate the CSM definition
      const errors = validateCsm(definition);
      if (errors.length > 0) {
        logger.warn(`Skipping invalid CSM template ${file}: ${errors.join('; ')}`);
        continue;
      }

      const action = await seedCsmDefinition(storage, definition, systemGaii, { store: 'csm-template', withSemantic: true, source: file });
      if (action === 'create' || action === 'update') {
        seeded++;
        logger.debug(`Seeded CSM template: ${definition.service.name} (${file}, ${action})`);
      }
    } catch (err) {
      logger.warn(`Failed to seed CSM template ${file}`, { error: (err as Error).message });
    }
  }

  return seeded;
}

/**
 * Bring one shipped CSM and its schema lock into step with this build.
 *
 * The record: created when missing; brought up to this build when nobody replaced it since the seed
 * wrote it (a copy from before stamps counts as unreplaced while it is at version 1 and registered by
 * a node seeder); left alone when it was replaced or another account registered the name. An update
 * keeps the previous definition in the CSM's version history, as PUT /v1/csm/{name} does.
 *
 * The lock: written with a new record. While the record is this build's, a lock a node seeder holds
 * is brought up to what this build compiles; a lock a person set through the schema API is theirs.
 */
export async function seedCsmDefinition(
  storage: Storage,
  definition: CsmDefinition,
  systemGaii: string,
  opts: { store: 'csm-template' | 'template-bundle'; withSemantic: boolean; source: string },
): Promise<StampedSeedAction> {
  const name = definition.service.name;
  const jsonSchema = csmToJsonSchema(definition);
  const schemaKey = `csm.${name}`;
  const shipped = definition as unknown as Record<string, unknown>;

  // Extract semantic annotation from CSM service.semantic (Phase 0.7)
  const serviceSemantic = opts.withSemantic && definition.service.semantic && typeof definition.service.semantic === 'object'
    ? definition.service.semantic as Record<string, unknown>
    : undefined;

  const action = await seedStamped(storage, {
    store: opts.store,
    name,
    shipped,
    read: async () => {
      const record = await storage.getCsm(name);
      if (!record) return null;
      const seeders = isSystemSeeded(record.registeredBy);
      return { content: record.definition, heldByOther: !seeders, untouchedWithoutStamp: seeders && (record.version ?? 1) === 1 };
    },
    write: async (content, act) => {
      const now = new Date().toISOString();
      if (act === 'update') {
        const record = await storage.getCsm(name);
        if (!record) return;
        const lock = await storage.getSchema(schemaKey, 'prefix');
        const version = record.version ?? 1;
        const written = await storage.replaceCsmVersion(name, version, {
          definition: content, serviceType: definition.service.type, updatedAt: now,
          ...(serviceSemantic ? { semantic: serviceSemantic } : {}),
        }, {
          name, version, definition: record.definition, jsonSchema: lock?.schemaJson ?? {},
          registeredBy: record.registeredBy, createdAt: record.updatedAt,
        });
        if (!written) throw new Error(`CSM ${name} changed while the seed brought it up to this build; the next start tries again`);
        return;
      }
      const semanticContext = serviceSemantic
        ? {
            '@context': serviceSemantic['@context'] as Record<string, string> | undefined,
            '@type': serviceSemantic['@type'] as string | undefined,
          }
        : undefined;

      // Register schema in Schema Locking system
      await storage.setSchema({
        keyPattern: schemaKey,
        applyTo: 'prefix',
        schemaJson: jsonSchema,
        schemaMode: definition.schemaMode,
        lockedBy: systemGaii,
        setAt: now,
        updatedAt: now,
        ...(semanticContext ? { semanticContext } : {}),
      });

      // Store CSM record
      await storage.createCsm({
        name,
        definition: content,
        jsonSchemaKey: schemaKey,
        serviceType: definition.service.type,
        registeredBy: systemGaii,
        registeredAt: now,
        updatedAt: now,
        ...(serviceSemantic ? { semantic: serviceSemantic } : {}),
      });
    },
  });

  // The record is this build's: its seeder-held lock follows what this build compiles.
  if (action === 'update' || action === 'current' || action === 'adopt') {
    const lock = await storage.getSchema(schemaKey, 'prefix');
    if (lock && isSystemSeeded(lock.lockedBy) && !isDeepStrictEqual(lock.schemaJson, jsonSchema)) {
      await storage.setSchema({ ...lock, schemaJson: jsonSchema, schemaMode: definition.schemaMode, updatedAt: new Date().toISOString() });
      logger.info(`Refreshed the seeded schema of CSM ${name} (${opts.source})`);
    }
  }
  return action;
}
