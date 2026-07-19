/**
 * @file appdev-proofs.ts
 * @description aimeat_appdev_proof_attach — self-reported acceleration proofs on community
 *   contributions (AppDev KB Phase 8): a per-model pass/fail run record attached to either a
 *   community library pack (append-only public memory record `libpack.proofs.{packId}`, owner
 *   of the cortex only) or one of the caller's own app-template proposals (appended to the
 *   manifest's proofs array). Every v1 proof carries selfReported: true — this is attribution
 *   toward "proven acceleration", never a node-verified audit (that badge is a later additive
 *   field). Mirrors the curated PackProof ledger contract: append-only, duplicate
 *   (model, testSet, date) rejected.
 * @structure registerAppdevProofTools()
 * @usage registerAppdevProofTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 8).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import type { ContributionProof } from '../models/contribution-proof.js';
import { getTemplateProposal, templateProposalKey } from '../services/app-template-proposals.js';
import type { TemplateProposalManifest } from '../services/app-template-proposals.js';

export const packProofsKey = (packId: string): string => `libpack.proofs.${packId}`;

export function registerAppdevProofTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool(
        'aimeat_appdev_proof_attach',
        descriptionFor('aimeat_appdev_proof_attach'),
        {
            subject_type: z.enum(['library_pack', 'app_template']).describe('library_pack = a COMMUNITY pack you own (your public cortex lib); app_template = one of your template proposals'),
            subject_id: z.string().min(1).max(80).describe('The community pack id (cortex name) or template proposal id'),
            model: z.string().min(1).max(64).describe('REQUIRED: model the run was made with (indicative, self-reported)'),
            verdict: z.enum(['pass', 'fail']).describe('Did the pack/template accelerate the run — honest fails make passes credible'),
            evidence: z.string().min(3).max(500).describe('URL or node storage/memory ref pointing at the run evidence'),
            test_set: z.string().max(120).optional().describe('Repeatable test-set/spec identifier, when one was used'),
            tokens: z.number().int().min(0).optional().describe('Output tokens the run consumed, when known'),
        },
        annotationsFor('aimeat_appdev_proof_attach'),
        async ({ subject_type, subject_id, model, verdict, evidence, test_set, tokens }) => {
            const parsed = parseGAII(agentGaii);
            const owner = parsed?.owner ?? (agentGaii.includes('@') && !agentGaii.includes('#') ? agentGaii.split('@')[0] : null);
            if (!owner) return { content: [{ type: 'text' as const, text: 'Could not resolve the caller to an owner' }], isError: true };
            const ownerGhii = `${owner}@${config.nodeId}`;
            const now = new Date().toISOString();

            const proof: ContributionProof = {
                model: model.trim().toLowerCase(),
                verdict,
                evidence,
                ...(test_set ? { testSet: test_set } : {}),
                ...(typeof tokens === 'number' ? { tokens } : {}),
                date: now.slice(0, 10),
                selfReported: true,
            };
            const isDup = (list: ContributionProof[]) =>
                list.some(p => p.model === proof.model && (p.testSet ?? '') === (proof.testSet ?? '') && p.date === proof.date);

            if (subject_type === 'library_pack') {
                // Owner gate: the community pack is the caller's own ACTIVE + PUBLIC cortex with a lib.
                const all = await storage.listCortexExtensions({ status: 'active' });
                const ext = all.find(e => e.name === subject_id);
                if (!ext || ext.visibility !== 'public' || !ext.components.some(c => c.type === 'lib')) {
                    return { content: [{ type: 'text' as const, text: `No active public community pack "${subject_id}"` }], isError: true };
                }
                if (ext.installedBy !== owner) {
                    return { content: [{ type: 'text' as const, text: 'Only the pack owner may attach proofs to it' }], isError: true };
                }
                const key = packProofsKey(subject_id);
                const existing = await storage.getMemory(ownerGhii, key);
                const value = (existing?.value ?? { packId: subject_id, proofs: [] }) as { packId: string; proofs: ContributionProof[] };
                const proofs = Array.isArray(value.proofs) ? value.proofs : [];
                if (isDup(proofs)) {
                    return { content: [{ type: 'text' as const, text: 'Duplicate proof (same model + test set + date) — the ledger is append-only, one entry per run' }], isError: true };
                }
                proofs.push(proof);
                await storage.setMemory({
                    key,
                    ownerGaii: ownerGhii,
                    value: { packId: subject_id, proofs },
                    visibility: 'public',
                    tags: ['libpack-proofs'],
                    ttlHours: null,
                    version: (existing?.version ?? 0) + 1,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ attached: true, subject_type, subject_id, proofs_total: proofs.length, self_reported: true }, null, 2) }] };
            }

            // app_template: append to the caller's own proposal manifest.
            const found = await getTemplateProposal(storage, config, agentGaii, subject_id);
            if (!found) {
                return { content: [{ type: 'text' as const, text: `Template proposal not found: ${subject_id}` }], isError: true };
            }
            const manifest = found.manifest as TemplateProposalManifest;
            const proofs = Array.isArray(manifest.proofs) ? manifest.proofs : [];
            if (isDup(proofs)) {
                return { content: [{ type: 'text' as const, text: 'Duplicate proof (same model + test set + date) — the ledger is append-only, one entry per run' }], isError: true };
            }
            proofs.push(proof);
            manifest.proofs = proofs;
            manifest.updatedAt = now;
            await storage.setMemory({
                ...found.record,
                key: templateProposalKey(subject_id),
                value: manifest,
                version: (found.record.version ?? 0) + 1,
                updatedAt: now,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ attached: true, subject_type, subject_id, proofs_total: proofs.length, self_reported: true }, null, 2) }] };
        },
    );
}
