/**
 * @file compliance-tab.load.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the compliance page reads its report: one read at a time, and with a time limit
 *   of its own.
 *
 *   WHY. The node-wide report reads every provenance record of the period and every app, so its
 *   time grows with the node. On a node with 81 000 records in thirty days it took 34 s
 *   (2026-11-26), the shared 30 s limit of api() ended the read, api() asked again, and every
 *   `compliance` event started one more, so the page showed only "could not be built" while two
 *   reports at a time ran on the server. A read that is still running is not asked again.
 * @structure SLOW_READ · oneAtATime(run)
 * @usage import { oneAtATime, SLOW_READ } from './compliance-tab.load.js';
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */

/** The report and the draft: two minutes, and no second request after a timeout. */
export const SLOW_READ = { timeoutMs: 120_000, retries: 0 };

/**
 * `run`, one at a time. A call while a run is going starts nothing: its arguments are kept, the
 * latest ones win, and they run once when the current run ends. So ten events during one read are
 * one more read, with the newest period. Every caller's promise settles when nothing is left to
 * run, so a caller that awaits it sees the state its own call asked for.
 */
export function oneAtATime(run) {
  let running = null;
  let waiting = null;
  return function call(...args) {
    if (running) { waiting = args; return running; }
    running = (async () => {
      try {
        let current = args;
        while (current) {
          waiting = null;
          await run(...current);
          current = waiting;
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
