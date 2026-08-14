/**
 * @file src/storage/types/common.ts
 * @description Shared semantic-annotation primitives (SemanticAnnotation, SemanticContext) used across storage record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
// Phase 0.7b — Semantic annotation for records (JSON-LD-compatible)
export interface SemanticAnnotation {
  '@context'?: Record<string, string>;
  '@type'?: string;
  [key: string]: unknown;
}

export interface SemanticContext {
  '@context'?: Record<string, string>;
  '@type'?: string;
  properties?: Record<string, unknown>;
}
