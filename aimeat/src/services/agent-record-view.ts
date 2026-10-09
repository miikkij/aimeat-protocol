/**
 * @file src/services/agent-record-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent record as a response may carry it: every stored field except the webhook
 *   signing secret, which is replaced by whether one is set. The page services that answer the
 *   agents of an account with whole storage rows (GET /v1/memory/tab, GET /v1/messages/overview)
 *   handed the secret to the browser; GET /v1/agents builds its own projection and never did.
 *   Found by e2e-secret-canary-sweep (secrets audit 2026-10-09).
 * @structure agentRecordView(agent)
 * @usage agents.map(agentRecordView)
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import type { AgentRecord } from '../storage/interface.js';

export type AgentRecordView = Omit<AgentRecord, 'webhookSecret'> & { webhookSecretSet: boolean };

export function agentRecordView(agent: AgentRecord): AgentRecordView {
    const { webhookSecret, ...rest } = agent;
    return { ...rest, webhookSecretSet: typeof webhookSecret === 'string' && webhookSecret.length > 0 };
}
