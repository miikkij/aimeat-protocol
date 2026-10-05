/**
 * @file appdev-proofs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_appdev_proof_attach — self-reported acceleration proofs on community
 *   contributions (AppDev KB Phase 8): a per-model pass/fail run record attached to either a
 *   community library pack (append-only public memory record `libpack.proofs.{packId}`, owner
 *   of the cortex only) or one of the caller's own app-template proposals (appended to the
 *   manifest's proofs array). Every v1 proof carries selfReported: true — this is attribution
 *   toward "proven acceleration", never a node-verified audit (that badge is a later additive
 *   field). Mirrors the curated PackProof ledger contract: append-only, duplicate
 *   (model, testSet, date) rejected.
 *
 *   The tool declares its name, parameters and text answer. The capability itself lives in
 *   services/contribution-proofs.ts, which every other surface can call.
 * @structure registerAppdevProofTools()
 * @usage registerAppdevProofTools(mcp, storage, config, () => agentGaii, scopes, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 -- 2026-08-11 -- The attach moved to services/contribution-proofs.ts and the record now
 *     goes through services/memory-write.ts. Writing it straight to storage meant a public,
 *     append-only ledger with no archive guard, no value-size or key ceiling, no byte quota and no
 *     overage charge, and no live update, on a tool meant to be called after every run.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 8).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { attachContributionProof } from '../services/contribution-proofs.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerAppdevProofTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    _getAgentGaii: () => string,
    /** The session's own scopes. Unused here: the session caller below carries them. */
    _sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts): the agent and its scopes, for the gate
     *  inside the shared memory write. */
    caller: () => CallerContext,
): void {
    mcp.tool(
        'aimeat_appdev_proof_attach',
        descriptionFor('aimeat_appdev_proof_attach'),
        zodShapeFor('aimeat_appdev_proof_attach'),
        annotationsFor('aimeat_appdev_proof_attach'),
        async ({ subject_type, subject_id, model, verdict, evidence, test_set, tokens }) => {
            const attached = await attachContributionProof({ storage, config }, caller().principalView, {
                subjectType: subject_type,
                subjectId: subject_id,
                model, verdict, evidence,
                testSet: test_set,
                tokens,
                pipeline: 'mcp.appdev_proof_attach',
            });
            if (!attached.ok) {
                return { content: [{ type: 'text' as const, text: attached.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        attached: true, subject_type, subject_id,
                        proofs_total: attached.proofsTotal, self_reported: true,
                    }, null, 2),
                }],
            };
        },
    );
}
