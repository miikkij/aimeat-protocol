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
 *   queued: the caller retries. The count is a constant, as the playtest's is, set above what the
 *   node's real use reaches at once. PER PROCESS.
 * @structure ON_DEMAND_HEADLESS_AT_ONCE · HEADLESS_BUSY_MESSAGE · takeHeadlessSlot()
 * @usage
 *   const slot = takeHeadlessSlot();
 *   if (!slot) return busy(HEADLESS_BUSY_MESSAGE);
 *   try { ... render ... } finally { slot.release(); }
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */

/** On-demand renders running at once on this node: each holds a headless browser. */
export const ON_DEMAND_HEADLESS_AT_ONCE = 4;

/** What a caller past the count is told. */
export const HEADLESS_BUSY_MESSAGE = 'This node is rendering other pages right now. Try again in a minute.';

let running = 0;

/** One slot, or null when ON_DEMAND_HEADLESS_AT_ONCE renders are running. The release is idempotent. */
export function takeHeadlessSlot(): { release(): void } | null {
  if (running >= ON_DEMAND_HEADLESS_AT_ONCE) return null;
  running++;
  let released = false;
  return { release: () => { if (!released) { released = true; running--; } } };
}
