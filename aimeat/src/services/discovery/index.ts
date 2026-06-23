/**
 * @file index.ts
 * @description Barrel for the discovery (master directory) service. Re-exports the Phase 0 building
 *   blocks — types, normalizer, classifier, registry, facet helpers — so consumers import from one
 *   path. Later phases add the FTS/table source adapters and the `/v1/discover` route on top of these.
 * @structure re-exports from ./types, ./normalize, ./classify, ./registry, ./facets
 * @usage import { createRegistry, classifyMemoryKey, normalizeVisibility } from '../discovery/index.js';
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0: barrel for pure building blocks (design doc 2026-06-23).
 *   v0.2.0 — 2026-06-23 — Phase 1: export orchestrator (run) + memory/FTS source adapter.
 *   v0.3.0 — 2026-06-23 — Phase 2: export capabilities / apps / agent-task table source adapters.
 */
export * from './types.js';
export * from './normalize.js';
export * from './classify.js';
export * from './registry.js';
export * from './facets.js';
export * from './run.js';
export { createMemorySource, MEMORY_SOURCE_ID } from './sources/memory-source.js';
export {
  createCapabilitiesSource, createAppsSource, createAgentTasksSource,
  CAPABILITIES_SOURCE_ID, APPS_SOURCE_ID, AGENT_TASKS_SOURCE_ID,
} from './sources/table-sources.js';
export { buildDiscoveryRegistry } from './setup.js';
