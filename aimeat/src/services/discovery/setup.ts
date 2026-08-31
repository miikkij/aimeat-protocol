/**
 * @file setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the canonical `DiscoveryRegistry` with every production source registered, so
 *   the REST route (`/v1/discover`) and the MCP tool (`aimeat_discover`) share ONE source list and
 *   can never drift. Adding a content type = add one `register()` here (design §7) and both surfaces
 *   pick it up.
 * @structure buildDiscoveryRegistry(storage, config) → DiscoveryRegistry (memory + capabilities + apps + agent-tasks)
 * @usage const registry = buildDiscoveryRegistry(storage, config);
 * @version-history
 *   v0.5.0 — 2026-09-01 — Register the `node-capabilities` source: what THIS NODE can do, so an
 *     agent can find `aimeat_memory_write` in the directory instead of needing all 297 tool
 *     descriptions in its context to know it exists. Agent v2 V2.
 *   v0.4.0 — 2026-08-31 — Register the `app-tools` source: an app's published tools, one entry per
 *     tool. Their manifests were already reaching the directory through the memory source as
 *     untyped records, so this is a correction as much as an addition.
 *   v0.3.0 — 2026-07-19 — AppDev KB Phase 6: the `templates` source now actually EXISTS and is
 *     registered here (agent-proposed app templates at template.catalog.*). The v0.2.0 line below
 *     was aspirational — no templates-source file or writer existed until now.
 *   v0.2.0 — 2026-06-24 — Secretary P5 (S-D): register the `templates` source (published use-case templates).
 *   v0.1.0 — 2026-06-23 — Phase 4: shared registry builder for REST + MCP surfaces (design doc 2026-06-23).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { createRegistry, type DiscoveryRegistry } from './registry.js';
import { createMemorySource } from './sources/memory-source.js';
import { createCapabilitiesSource, createAppsSource, createAgentTasksSource } from './sources/table-sources.js';
import { createTemplatesSource } from './sources/templates-source.js';
import { createDesignbookSource } from './sources/designbook-source.js';
import { createAppToolsSource } from './sources/app-tools-source.js';
import { createNodeCapabilitiesSource } from './sources/node-capabilities-source.js';

export function buildDiscoveryRegistry(storage: Storage, config: AimeatConfig): DiscoveryRegistry {
  const registry = createRegistry();
  registry.register(createMemorySource(storage, config));        // all memory-backed domains
  registry.register(createCapabilitiesSource(storage, config));  // capabilities table
  registry.register(createAppsSource(storage, config));          // apps table
  registry.register(createAgentTasksSource(storage, config));    // agent_tasks table
  registry.register(createTemplatesSource(storage, config));     // agent-proposed app templates (template.catalog.*)
  registry.register(createDesignbookSource(storage, config));    // Design Book parts (atelier.book.part.*)
  registry.register(createAppToolsSource(storage, config));      // published app tools (apps.*.tools), one entry per TOOL
  registry.register(createNodeCapabilitiesSource());              // the node's OWN capabilities — what `invoke` can run
  return registry;
}
