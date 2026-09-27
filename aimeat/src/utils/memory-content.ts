/**
 * @file src/utils/memory-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content bytes a memory provenance record describes, shared across transports.
 * @version-history
 *   v1.0.0 -- 2026-09-27 -- Pure extraction from the memory route helpers.
 */
export function memoryContentBytes(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}
