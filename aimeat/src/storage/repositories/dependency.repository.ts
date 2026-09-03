/**
 * @file src/storage/repositories/dependency.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for the dependency map (types/dependencies.ts).
 *   A source's edges are replaced as a set, because the map is derived: the bytes are the truth and
 *   the rows follow them, so there is no "add one edge" door.
 * @structure DependencyRepository: replaceDependencyEdges · listDependencyEdges · deleteDependencyEdges
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1).
 */
import type { DependencyEdge, DependencyEdgeFilter, DependencyFromKind } from '../types/dependencies.js';

export interface DependencyRepository {
  /** Replace every edge of one source with the given set (all edges share fromKind/fromRef). */
  replaceDependencyEdges(fromKind: DependencyFromKind, fromRef: string, edges: DependencyEdge[]): Promise<void>;
  /** Edges matching the filter; no filter = the whole map. */
  listDependencyEdges(filter?: DependencyEdgeFilter): Promise<DependencyEdge[]>;
  /** Forget one source (its app or cortex was deleted). Returns the number of rows removed. */
  deleteDependencyEdges(fromKind: DependencyFromKind, fromRef: string): Promise<number>;
}
