/**
 * @file screenshot-worker.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Dev wrapper for `pnpm screenshot:worker`. The implementation lives in
 *   src/cli/screenshot-worker.ts and ships to npm users as the `aimeat screenshot-worker`
 *   subcommand; this just invokes it with the current argv for local dev runs.
 * @usage AIMEAT_OP_TOKEN=<token> pnpm screenshot:worker [--watch 600] [--dry-run] ...
 * @version-history
 *   v1.0.0 — 2026-06-20 — initial standalone worker.
 *   v2.0.0 — 2026-06-20 — thin wrapper; logic moved to src/cli/screenshot-worker.ts (CLI subcommand
 *     + playwright-core system-browser channel so npm/npx installs work without a browser download).
 */
import { runScreenshotWorker } from '../src/cli/screenshot-worker.js';

runScreenshotWorker();
