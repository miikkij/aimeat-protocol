/**
 * @file connect-tunnel-cancel-marker.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a cancel marker may cancel for (services/connect-tunnel-push.ts markerMayCancel):
 *   the task's own account, whichever of its principals holds the marker, and the exact principal
 *   that created the task. Nobody else (secaudit 2026-10, r48). The E2E half is
 *   test/e2e-connect-tunnel-records.ts 8b-8d.
 * @usage cd aimeat && pnpm vitest run test/unit/connect-tunnel-cancel-marker.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { markerMayCancel } from '../../src/services/connect-tunnel-push.js';

const NODE = 'node-1';
const task = { ownerGaii: `alice@${NODE}`, createdBy: `planner#alice@${NODE}` };

describe('markerMayCancel', () => {
  it('admits the owner in person, an app writing into the owner namespace, and every agent of the owner', () => {
    expect(markerMayCancel(`alice@${NODE}`, task)).toBe(true);
    expect(markerMayCancel(`planner#alice@${NODE}`, task)).toBe(true);
    expect(markerMayCancel(`worker#alice@${NODE}`, task)).toBe(true);
    expect(markerMayCancel(`eco:helper#alice@${NODE}`, task)).toBe(true);
  });

  it('refuses another account, its owner in person and its agents alike', () => {
    expect(markerMayCancel(`bob@${NODE}`, task)).toBe(false);
    expect(markerMayCancel(`claude#bob@${NODE}`, task)).toBe(false);
    expect(markerMayCancel(`alice@other-node`, task)).toBe(false);
  });

  it('admits the exact principal that created the task, and only that one', () => {
    const ordered = { ownerGaii: `alice@${NODE}`, createdBy: `buyer#bob@${NODE}` };
    expect(markerMayCancel(`buyer#bob@${NODE}`, ordered)).toBe(true);
    expect(markerMayCancel(`bob@${NODE}`, ordered)).toBe(false);
    expect(markerMayCancel(`other#bob@${NODE}`, ordered)).toBe(false);
  });

  it('treats a task with no recorded creator as having none', () => {
    expect(markerMayCancel(`bob@${NODE}`, { ownerGaii: `alice@${NODE}`, createdBy: null })).toBe(false);
    expect(markerMayCancel(`bob@${NODE}`, { ownerGaii: `alice@${NODE}`, createdBy: '' })).toBe(false);
    expect(markerMayCancel(`alice@${NODE}`, { ownerGaii: `alice@${NODE}` })).toBe(true);
  });
});
