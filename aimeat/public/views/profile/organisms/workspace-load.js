/**
 * @file public/views/profile/organisms/workspace-load.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the workspace view shows after a read of the workspace, as a pure decision. A
 *   read that worked and found no manifest is the first-time screen with the set-up button; a read
 *   that FAILED is its own state (WS_FAILED) with a Retry and no set-up button, because that button
 *   replaces the manifest and the README of a workspace whose structure the page could not see.
 * @structure WS_FAILED · nextWorkspaceState(prev, outcome)
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: the failed read is apart from "no manifest yet" (QA audit F6-02).
 */

/** The view state for "the read of this workspace failed". */
export const WS_FAILED = 'failed';

/**
 * The workspace view state after a read.
 *   undefined = still loading · null = read worked, no manifest yet · WS_FAILED = read failed · object = the workspace
 * A failed REload of a workspace already on the page keeps it: the page shows real, older data.
 * A failed read of a page that showed "no manifest yet" turns into WS_FAILED, so the set-up button
 * never stands on a state the page could not confirm.
 * @param {any} prev  the current view state
 * @param {{ ok: true, workspace: any } | { ok: false }} outcome
 */
export function nextWorkspaceState(prev, outcome) {
  if (outcome.ok) {
    const w = outcome.workspace;
    return w && w.manifest ? w : null;
  }
  return prev && typeof prev === 'object' ? prev : WS_FAILED;
}
