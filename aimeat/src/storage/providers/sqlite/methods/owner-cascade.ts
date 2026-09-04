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
 *   v1.1.0 — 2026-09-04 — Six tables join the cascade: memory_history, owner_agent_defaults,
 *     group_shares, agent_usage_event, agent_usage_event_archive and agent_usage_daily. All six had
 *     sat in security/storage-parity-exemptions.json since 2026-08-10 as "decide", and each is now
 *     asserted row-by-row by test/unit/storage-conformance.test.ts on both providers.
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
    // The write tally for THIS namespace. A deleted username is released for reuse, so a surviving
    // row would hand the next registrant somebody else's history. Rows where this identity was the
    // WRITER into somebody ELSE'S namespace are deliberately NOT deleted here — they are that
    // owner's record of who touched their data, and removing them would turn their "four hands" into
    // three. Those are pseudonymised instead, by pseudonymiseTallyWriter, called from deleteOwner.
    this.db.prepare('DELETE FROM memory_write_tally WHERE ownerGaii = ?').run(gaii);
    this.db.prepare('DELETE FROM memory_family_tally WHERE ownerGaii = ?').run(gaii);
    // The archived prior versions of a trackable key. The live row goes above; without this line the
    // value the person last overwrote outlives the value they last wrote, which is the wrong way
    // round. Postgres calls this table MemoryVersion, which is why the parity gate needed a name
    // mapping before it could see either side of it.
    this.db.prepare('DELETE FROM memory_history WHERE ownerGaii = ?').run(gaii);
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
    // The agent rules and budget this identity set for itself.
    this.db.prepare('DELETE FROM owner_agent_defaults WHERE ownerGaii = ?').run(gaii);

    // AI usage: the raw events, their archive, and the daily rollup. Two owner columns, and the
    // cascade walks each identity once, so one clause with the same value catches the agent pass and
    // the GHII pass alike. `consumerGhii` is deliberately NOT matched: on a row where somebody else
    // consumed this owner's capability it names the OTHER party, and clearing by it would delete a
    // counterparty's record of what they spent — the same reasoning that pseudonymises the write
    // tally instead of deleting it.
    //
    // Written out three times rather than looped over the names. A loop reads as one idea, but
    // scripts/check-storage-parity.ts greps these files for `DELETE FROM <table>` and a table name
    // that only ever exists as a template variable is invisible to it: the first draft of this block
    // was a loop, the cascade was correct, and the gate reported all three tables as uncleared.
    this.db.prepare('DELETE FROM agent_usage_event WHERE agentGaii = ? OR ownerGhii = ?').run(gaii, gaii);
    this.db.prepare('DELETE FROM agent_usage_event_archive WHERE agentGaii = ? OR ownerGhii = ?').run(gaii, gaii);
    this.db.prepare('DELETE FROM agent_usage_daily WHERE agentGaii = ? OR ownerGhii = ?').run(gaii, gaii);

    // Sharing groups, and the key-space shares inside them. The shares go first and by two keys: by
    // ownerGaii for this person's own shares, then by the id of each group being removed, because a
    // share whose group is gone grants nothing and would sit there unreadable.
    this.db.prepare('DELETE FROM group_shares WHERE ownerGaii = ?').run(gaii);
    const groupRows = this.db.prepare('SELECT id FROM sharing_groups WHERE ownerGaii = ?').all(gaii) as { id: string }[];
    for (const g of groupRows) {
      this.db.prepare('DELETE FROM group_shares WHERE groupId = ?').run(g.id);
    }
    this.db.prepare('DELETE FROM sharing_groups WHERE ownerGaii = ?').run(gaii);
  },
};
