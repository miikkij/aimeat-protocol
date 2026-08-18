/**
 * @file service-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Computes a compact summary of all federated items on this node.
 *   Used by the network directory system to detect when a peer's services change
 *   and to serve the full summary on request.
 * @structure
 *   - ServiceSummaryAction   — action entry in summary
 *   - ServiceSummaryAgent    — agent entry in summary
 *   - ServiceSummaryBoard    — board entry in summary
 *   - ServiceSummaryCsm      — CSM entry in summary
 *   - ServiceSummary          — full node service summary
 *   - computeServiceSummary() — fetches federated items from storage
 *   - computeSummaryHash()    — SHA-256 over sorted entry identifiers
 * @usage
 *   import { computeServiceSummary, computeSummaryHash } from '../utils/service-summary.js';
 * @version-history
 *   v1.0.0 — 2026-05-20 — Initial implementation for Federation Mesh Phase 2
 */

import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export interface ServiceSummaryAction {
    id: string;
    displayName: string;
    category?: string;
    providerGaii: string;
    price: number;
}

export interface ServiceSummaryAgent {
    gaii: string;
    displayName?: string;
    trust_score: number;
}

export interface ServiceSummaryBoard {
    id: string;
    name: string;
    description?: string;
    post_count: number;
}

export interface ServiceSummaryCsm {
    name: string;
    serviceType: string;
}

export interface ServiceSummary {
    node_id: string;
    summary_hash: string;
    actions: ServiceSummaryAction[];
    agents: ServiceSummaryAgent[];
    boards: ServiceSummaryBoard[];
    csms: ServiceSummaryCsm[];
    knowledge: unknown[];
    memory_keys: unknown[];
    files: unknown[];
    computed_at: string;
}

/**
 * Compute a compact summary of all federated items on this node.
 * Fetches actions, agents, boards, and CSMs from storage, filters for
 * items marked with `federate === true`, and builds a summary with a hash.
 *
 * Files are excluded because there is no global list-all-files method
 * (files are per-owner).
 */
export async function computeServiceSummary(
    config: AimeatConfig,
    storage: Storage,
): Promise<ServiceSummary> {
    // Fetch all items and filter for federated ones
    const [allActions, allAgents, allBoards, allCsms] = await Promise.all([
        storage.listActions(),
        storage.listAgents(),
        storage.listBoards(),
        storage.listCsms(),
    ]);

    const actions: ServiceSummaryAction[] = allActions
        .filter(a => a.federate === true)
        .map(a => ({
            id: a.id,
            displayName: a.displayName,
            category: a.category,
            providerGaii: a.providerGaii,
            price: a.pricing.baseMorsels,
        }));

    const agents: ServiceSummaryAgent[] = allAgents
        .filter(a => a.federate === true)
        .map(a => ({
            gaii: a.gaii,
            displayName: a.displayName,
            trust_score: a.trustScore ?? 0,
        }));

    const boards: ServiceSummaryBoard[] = allBoards
        .filter(b => b.federate === true && b.visibility === 'public')
        .map(b => ({
            id: b.id,
            name: b.name,
            description: b.description,
            post_count: 0,
        }));

    const csms: ServiceSummaryCsm[] = allCsms
        .filter(c => c.federate === true)
        .map(c => ({
            name: c.name,
            serviceType: c.serviceType,
        }));

    const summary: ServiceSummary = {
        node_id: config.nodeId,
        summary_hash: '',  // Computed below
        actions,
        agents,
        boards,
        csms,
        knowledge: [],
        memory_keys: [],
        files: [],
        computed_at: new Date().toISOString(),
    };

    summary.summary_hash = computeSummaryHash(summary);

    return summary;
}

/**
 * Compute a SHA-256 hash over sorted entry identifiers from a ServiceSummary.
 * Used for change detection: if the hash differs between heartbeat cycles,
 * the peer's services have changed and the full summary should be fetched.
 */
export function computeSummaryHash(summary: ServiceSummary): string {
    const identifiers: string[] = [];

    for (const a of summary.actions) {
        identifiers.push(`action:${a.id}`);
    }
    for (const a of summary.agents) {
        identifiers.push(`agent:${a.gaii}`);
    }
    for (const b of summary.boards) {
        identifiers.push(`board:${b.id}`);
    }
    for (const c of summary.csms) {
        identifiers.push(`csm:${c.name}`);
    }

    identifiers.sort();

    return createHash('sha256')
        .update(identifiers.join('\n'))
        .digest('hex');
}
