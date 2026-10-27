/**
 * @file src/services/headless-slots.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide count of headless browsers a request starts for an on-demand render: an
 *   app screenshot (POST /v1/apps/:owner/:filename/screenshot/capture, MCP app_manage screenshot) and
 *   the Design Book bench (POST /v1/designbook/:id/bench). Each holds a whole Chromium, and only a
 *   per-owner hourly allowance bounded them, so several accounts could hold the node's memory and CPU
 *   together (secaudit2026oct26, screenshot-capture:on-demand-render-no-node-slot-or-deadline). The
 *   playtest keeps its own two (app-playtest.ts), and the batch pass runs one browser at a time.
 *
 *   A request past the count is answered at once with a sentence to try again in a minute, never
 *   queued: the caller retries. The count is the operator setting apps.renders_at_once
 *   (AIMEAT_APP_RENDERS_AT_ONCE, default 4, 0 is no limit), read on every take. PER PROCESS.
 * @structure ON_DEMAND_HEADLESS_AT_ONCE · HEADLESS_BUSY_MESSAGE · takeHeadlessSlot(config)
 * @usage
 *   const slot = takeHeadlessSlot(config);
 *   if (!slot) return busy(HEADLESS_BUSY_MESSAGE);
 *   try { ... render ... } finally { slot.release(); }
 * @version-history
 *   v1.1.0 — 2026-10-27 — The count is the setting apps.renders_at_once (brief rule 6), default 4.
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';

/** The default of apps.renders_at_once. */
export const ON_DEMAND_HEADLESS_AT_ONCE = 4;

/** What a caller past the count is told. */
export const HEADLESS_BUSY_MESSAGE = 'This node is rendering other pages right now (the operator setting apps.renders_at_once). Try again in a minute.';

let running = 0;

/** One slot, or null when apps.renders_at_once renders are running. The release is idempotent. */
export function takeHeadlessSlot(config: Pick<AimeatConfig, 'appRendersAtOnce'>): { release(): void } | null {
  const max = config.appRendersAtOnce ?? ON_DEMAND_HEADLESS_AT_ONCE;
  if (max > 0 && running >= max) return null;
  running++;
  let released = false;
  return { release: () => { if (!released) { released = true; running--; } } };
}
