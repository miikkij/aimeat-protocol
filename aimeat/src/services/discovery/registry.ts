/**
 * @file registry.ts
 * @description The `DiscoverySource` registry — the backbone that makes the directory extensible
 *   (design §3, §7). The `/v1/discover` handler iterates this registry instead of hardcoding domains;
 *   adding a new content type means registering one adapter. Pure in-memory container with no I/O.
 * @structure
 *   - DiscoveryRegistry — register / unregister / get / all
 *   - createRegistry() — factory (tests build isolated registries; server builds one shared)
 * @usage
 *   const reg = createRegistry();
 *   reg.register(memoryFtsSource);
 *   for (const src of reg.all()) await src.enumerate(ctx);
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0: registry + adapter seam (design doc 2026-06-23).
 */
import type { DiscoverySource } from './types.js';

export class DiscoveryRegistry {
  private readonly sources = new Map<string, DiscoverySource>();

  /** Register a source. Throws on duplicate id (a programming error — ids must be unique). */
  register(source: DiscoverySource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`DiscoverySource already registered: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  /** Remove a source by id. Returns true if it existed. */
  unregister(id: string): boolean {
    return this.sources.delete(id);
  }

  get(id: string): DiscoverySource | undefined {
    return this.sources.get(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  /** All registered sources, in registration order. */
  all(): DiscoverySource[] {
    return [...this.sources.values()];
  }

  get size(): number {
    return this.sources.size;
  }
}

export function createRegistry(): DiscoveryRegistry {
  return new DiscoveryRegistry();
}
