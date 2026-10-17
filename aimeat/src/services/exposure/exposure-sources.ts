/**
 * @file src/services/exposure/exposure-sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry of exposure sources: one per content kind, in the order the report lists
 *   them (plan doc-mvcn6c7e4e5q, V6.1). A new kind is a name in KINDS (exposure-types.ts) and a
 *   source here; test/unit/exposure-sources.test.ts fails while either is missing the other.
 * @structure EXPOSURE_SOURCES · sourceFor(kind)
 * @usage for (const source of EXPOSURE_SOURCES) items.push(...await source.list(ctx, name, ghii));
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import type { ExposureKind, ExposureSource } from './exposure-types.js';
import { memorySource, fileSource, knowledgeSource, skillSource, datapackageSource } from './sources-records.js';
import {
  appSource, workspaceShareSource, organismSource, boardSource, portfolioSource, companySource,
} from './sources-places.js';
import { packageSource, exchangeSource, agentSource } from './sources-market.js';

export const EXPOSURE_SOURCES: readonly ExposureSource[] = [
  memorySource,
  fileSource,
  appSource,
  workspaceShareSource,
  organismSource,
  boardSource,
  knowledgeSource,
  packageSource,
  datapackageSource,
  skillSource,
  portfolioSource,
  companySource,
  exchangeSource,
  agentSource,
];

/** The source of one kind, or undefined when the registry has none. */
export function sourceFor(kind: ExposureKind): ExposureSource | undefined {
  return EXPOSURE_SOURCES.find(s => s.kind === kind);
}
