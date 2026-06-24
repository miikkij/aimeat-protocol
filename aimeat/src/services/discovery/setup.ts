/**
 * @file setup.ts
 * @description Builds the canonical `DiscoveryRegistry` with every production source registered, so
 *   the REST route (`/v1/discover`) and the MCP tool (`aimeat_discover`) share ONE source list and
 *   can never drift. Adding a content type = add one `register()` here (design §7) and both surfaces
 *   pick it up.
 * @structure buildDiscoveryRegistry(storage, config) → DiscoveryRegistry (memory + capabilities + apps + agent-tasks + templates)
 * @usage const registry = buildDiscoveryRegistry(storage, config);
 * @version-history
 *   v0.2.0 — 2026-06-24 — Secretary P5 (S-D): register the `templates` source (published use-case templates).
 *   v0.1.0 — 2026-06-23 — Phase 4: shared registry builder for REST + MCP surfaces (design doc 2026-06-23).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { createRegistry, type DiscoveryRegistry } from './registry.js';
import { createMemorySource } from './sources/memory-source.js';
import { createCapabilitiesSource, createAppsSource, createAgentTasksSource } from './sources/table-sources.js';
import { createTemplatesSource } from './sources/template-source.js';

export function buildDiscoveryRegistry(storage: Storage, config: AimeatConfig): DiscoveryRegistry {
  const registry = createRegistry();
  registry.register(createMemorySource(storage, config));        // all memory-backed domains
  registry.register(createCapabilitiesSource(storage, config));  // capabilities table
  registry.register(createAppsSource(storage, config));          // apps table
  registry.register(createAgentTasksSource(storage, config));    // agent_tasks table
  registry.register(createTemplatesSource(storage, config));     // published use-case templates (S-D)
  return registry;
}
