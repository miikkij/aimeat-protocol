import type { AimeatConfig, HookName } from '../config.js';
import { applyConfigOverrides } from '../config.js';
import { createStorage } from '../storage/storage-factory.js';
import { ConfigProvenance } from '../services/config-provenance.js';
import { ALL_CONFIG_MAP, ENV_TO_DOT_PATH } from '../services/config-schema.js';
import { createConsulConfigService, applyConsulValues } from '../services/consul-config.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import { initRevocationStorage } from '../auth/jwt.js';
import { initSessionAuth } from '../auth/middleware.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { ConfigSources } from '../server.js';

export interface ConfigInitResult {
  storage: Storage;
  provenance: ConfigProvenance;
  consulService: ConsulConfigService | null;
}

/**
 * Initialize storage, build config provenance, apply Consul and DB overrides,
 * and wire storage into auth subsystems.
 */
export async function initializeConfig(
  config: AimeatConfig,
  configSources?: ConfigSources,
): Promise<ConfigInitResult> {
  // Storage — select based on config
  const storage = await createStorage({
    provider: config.storageProvider,
    sqlitePath: config.sqlitePath,
    dbUrl: config.dbUrl ?? undefined,
  });
  const storageLabels: Record<string, string> = {
    memory: 'in-memory (data will not persist across restarts)',
    sqlite: `SQLite (${config.sqlitePath})`,
    mongodb: `MongoDB (${config.dbUrl?.replace(/\/\/.*@/, '//<credentials>@') ?? 'no URL'})`,
  };
  logger.info(`Using ${storageLabels[config.storageProvider]} storage`);

  // ── Config Provenance & DB Overrides ──
  // Build provenance registry tracking where each config value originated.
  // Then apply any DB-persisted overrides (skipped for in-memory storage).
  const provenance = new ConfigProvenance();
  provenance.initDefaults(Object.keys(ALL_CONFIG_MAP));

  if (configSources) {
    // Accurate provenance from loadConfig() — distinguishes env/file/cli
    if (configSources.fileKeys.length > 0) provenance.markFile(configSources.fileKeys);
    if (configSources.envKeys.length > 0) provenance.markEnv(configSources.envKeys);
    if (configSources.cliKeys.length > 0) provenance.markEnv(configSources.cliKeys);
    if (configSources.fileName) {
      logger.info(`Config file: ${configSources.fileName}`);
    }
  } else {
    // Fallback: check process.env directly (backward compat for tests)
    const envOverrides: string[] = [];
    for (const [envVar, dotPath] of Object.entries(ENV_TO_DOT_PATH)) {
      if (process.env[envVar] !== undefined) envOverrides.push(dotPath);
    }
    if (envOverrides.length > 0) provenance.markEnv(envOverrides);
  }

  // ── Consul KV Config ──
  // Load Consul values (priority: above file/env, below DB)
  const consulService = createConsulConfigService(config);
  if (consulService) {
    try {
      const consulValues = await consulService.loadAll();
      if (Object.keys(consulValues).length > 0) {
        const { applied } = applyConsulValues(config, consulValues);
        provenance.markConsul(applied);
        logger.info(`Applied ${applied.length} config value(s) from Consul KV`);
      }

      // Start watching for live changes (Consul priority: below DB, above file)
      consulService.startWatching((changes) => {
        logger.info(`[consul] Config update detected: ${Object.keys(changes).length} keys`);
        const { applied } = applyConsulValues(config, changes);
        provenance.markConsul(applied);
      });
    } catch (err) {
      logger.warn(`Consul config load failed: ${(err as Error).message}`);
    }
  }

  // Apply DB overrides (highest precedence — applied after env/file/consul)
  const { applied: dbApplied, skipped: dbSkipped } = await applyConfigOverrides(config, storage, provenance);
  if (dbApplied.length > 0) {
    logger.info(`Applied ${dbApplied.length} config override(s) from database: ${dbApplied.join(', ')}`);
  }
  if (dbSkipped.length > 0) {
    logger.warn(`Skipped ${dbSkipped.length} invalid DB config value(s): ${dbSkipped.join(', ')}`);
  }

  // ── Load persisted extension hooks from DB ──
  try {
    const allValues = await storage.getAllConfigValues();
    let hooksLoaded = 0;
    for (const [key, value] of Object.entries(allValues)) {
      if (key.startsWith('hooks.')) {
        const hookName = key.slice(6) as HookName;
        if (hookName in config.extensionHooks) {
          try {
            const actions = JSON.parse(value);
            if (Array.isArray(actions)) {
              config.extensionHooks[hookName] = actions;
              hooksLoaded++;
            }
          } catch { /* skip malformed hook values */ }
        }
      }
    }
    if (hooksLoaded > 0) {
      logger.info(`Loaded ${hooksLoaded} persisted extension hook(s) from database`);
    }
  } catch { /* getAllConfigValues may fail for some backends — hooks stay at defaults */ }

  // Wire storage into token revocation system for persistent revocation
  initRevocationStorage(storage);

  // P3-7: Wire storage into session-aware auth middleware
  initSessionAuth(storage);

  return { storage, provenance, consulService };
}
