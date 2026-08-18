/**
 * @file src/storage/providers/sqlite/methods/owner-cascade.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-identity cascade delete, extracted from methods/owner.ts by pure move when
 *   that file passed the 800-line limit. Bodies verbatim; merged onto the SqliteStorage prototype
 *   the same way every other method group is.
 *
 *   It is called once per agent GAII AND once per owner GHII by deleteOwner. That second call is the
 *   2026-08-10 fix: the cascade only ever ran for agents, so everything written under the person's
 *   own identity survived the delete of their account, which is most of what a person has.
 * @structure cascadeMethods.cascadeDeleteAgentData(gaii) — every owner-scoped table for one identity
 * @usage Object.assign(SqliteStorage.prototype, cascadeMethods) in providers/sqlite/index.ts
 * @version-history
 *   v1.0.0 — 2026-08-10 — Extracted from methods/owner.ts (max-file-lines), no behaviour change.
 */
import type { SqliteStorage } from '../index.js';

export const cascadeMethods = {
  /**
   * Cascade-delete all data associated with a single agent GAII.
   * Called inside a transaction by both deleteOwner and deleteAgent.
   */
  cascadeDeleteAgentData(this: SqliteStorage, gaii: string): void {
    // Memory
    this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(gaii);
    // Micro-memory
    this.db.prepare('DELETE FROM micro_memory WHERE gaii = ?').run(gaii);
    // Actions
    this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
    // Work (as provider or requester) — also clean up related disputes
    const workRows = this.db.prepare(
      'SELECT trackingCode FROM work WHERE providerGaii = ? OR requesterGaii = ?'
    ).all(gaii, gaii) as { trackingCode: string }[];
    for (const w of workRows) {
      this.db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
      this.db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
    }
    this.db.prepare('DELETE FROM work WHERE providerGaii = ? OR requesterGaii = ?').run(gaii, gaii);
    // Wallet transactions
    this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    // Board posts authored by this agent
    this.db.prepare('DELETE FROM board_posts WHERE authorGaii = ?').run(gaii);
    // Board subscriptions
    this.db.prepare('DELETE FROM board_subscriptions WHERE gaii = ?').run(gaii);
    // Boards owned by this agent — also delete their posts and subscriptions
    const boardRows = this.db.prepare('SELECT id FROM boards WHERE ownerGaii = ?').all(gaii) as { id: string }[];
    for (const b of boardRows) {
      this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(b.id);
      this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(b.id);
    }
    this.db.prepare('DELETE FROM boards WHERE ownerGaii = ?').run(gaii);
    // Consents and consent audit
    this.db.prepare('DELETE FROM consent_audit WHERE ownerGaii = ?').run(gaii);
    this.db.prepare('DELETE FROM consents WHERE ownerGaii = ?').run(gaii);
    // Storage files
    this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ?').run(gaii);
    // Matches (as profileA or profileB)
    this.db.prepare('DELETE FROM matches WHERE profileA = ? OR profileB = ?').run(gaii, gaii);
    // Flags raised by this agent
    this.db.prepare('DELETE FROM flags WHERE flaggedBy = ?').run(gaii);
    // Escrow holds
    this.db.prepare('DELETE FROM escrow_holds WHERE fromGaii = ?').run(gaii);
    // OTKs (one-time keys)
    this.db.prepare('DELETE FROM otks WHERE ownerGaii = ?').run(gaii);
    // OAuth refresh tokens and approvals for this agent
    this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    this.db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
    // Agent tasks and events
    const taskRows = this.db.prepare('SELECT id FROM agent_tasks WHERE agentGaii = ?').all(gaii) as { id: string }[];
    for (const t of taskRows) {
      this.db.prepare('DELETE FROM agent_task_events WHERE taskId = ?').run(t.id);
    }
    this.db.prepare('DELETE FROM agent_tasks WHERE agentGaii = ?').run(gaii);
    // Agent directives
    this.db.prepare('DELETE FROM agent_directives WHERE agentGaii = ?').run(gaii);
    // Agent activity
    this.db.prepare('DELETE FROM agent_activity WHERE agentGaii = ?').run(gaii);
    // Agent messages
    this.db.prepare('DELETE FROM agent_messages WHERE agentGaii = ?').run(gaii);
    // Telemetry events
    this.db.prepare('DELETE FROM telemetry_events WHERE agentGaii = ?').run(gaii);
    // Webhook delivery logs
    this.db.prepare('DELETE FROM webhook_delivery_log WHERE agentGaii = ?').run(gaii);
    // Onboarding record
    this.db.prepare('DELETE FROM agent_onboarding WHERE agentGaii = ?').run(gaii);
    // Sharing groups
    this.db.prepare('DELETE FROM sharing_groups WHERE ownerGaii = ?').run(gaii);
  },
};
