/**
 * @file src/services/csm-seed.ts
 * @description Startup seeder for CSM (Content Structure Model) templates — reads `.csm.yaml` files
 *   from docs/csm-examples/, validates them, generates JSON Schemas, and registers both the locked
 *   schema and the CSM record in storage. Idempotent: skips any CSM already registered by name.
 *
 * @structure
 *   - seedCsmTemplates(storage, systemGaii): main entry that parses, validates, and registers each template
 *   - uses parseCsm/validateCsm/csmToJsonSchema from csm-parser for parsing and schema generation
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from '../storage/interface.js';
import { parseCsm, validateCsm, csmToJsonSchema } from './csm-parser.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Seed CSM template schemas and records on server startup.
 * Reads all .csm.yaml files from docs/csm-examples/, parses them,
 * generates JSON Schemas, and registers both the schema (via Schema Locking)
 * and the CSM record in storage.
 *
 * Idempotent — skips any CSM that is already registered by name.
 *
 * @param storage  Storage implementation
 * @param systemGaii  System identity used as registeredBy / lockedBy (e.g. "system@node-id")
 * @returns Number of newly seeded CSM templates
 */
export async function seedCsmTemplates(storage: Storage, systemGaii: string): Promise<number> {
  const templatesDir = join(__dirname, '..', '..', 'docs', 'csm-examples');

  if (!existsSync(templatesDir)) {
    logger.debug('CSM templates directory not found, skipping seed', { path: templatesDir });
    return 0;
  }

  const files = readdirSync(templatesDir).filter(f => f.endsWith('.csm.yaml'));
  if (files.length === 0) return 0;

  let seeded = 0;
  const now = new Date().toISOString();

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

      // Check if this CSM is already registered (idempotent)
      const existing = await storage.getCsm(definition.service.name);
      if (existing) continue;

      // Generate JSON Schema from CSM data_schema
      const jsonSchema = csmToJsonSchema(definition);
      const schemaKey = `csm.${definition.service.name}`;

      // Extract semantic annotation from CSM service.semantic (Phase 0.7)
      const serviceSemantic = definition.service.semantic && typeof definition.service.semantic === 'object'
        ? definition.service.semantic as Record<string, unknown>
        : undefined;
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
        name: definition.service.name,
        definition: definition as unknown as Record<string, unknown>,
        jsonSchemaKey: schemaKey,
        serviceType: definition.service.type,
        registeredBy: systemGaii,
        registeredAt: now,
        updatedAt: now,
        ...(serviceSemantic ? { semantic: serviceSemantic } : {}),
      });

      seeded++;
      logger.debug(`Seeded CSM template: ${definition.service.name} (${file})`);
    } catch (err) {
      logger.warn(`Failed to seed CSM template ${file}`, { error: (err as Error).message });
    }
  }

  return seeded;
}
