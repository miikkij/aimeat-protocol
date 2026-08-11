/**
 * @file src/services/contribution-proofs.ts
 * @description Attaching one self-reported acceleration proof to a community contribution, for
 *   every surface that can attach one.
 *
 *   WHY THIS FILE EXISTS. The proof attach had no single home. `mcp/appdev-proofs.ts` held the
 *   whole capability inline: the owner gate on the community pack, the append-only duplicate rule,
 *   the ContributionProof shape, and the storage write itself. There is no REST route for the
 *   attach, so the copies that drifted are the two CLI connector definitions
 *   (`cli/connect/mcp/tools/appdev.ts` and `cli/connect/tool-call-defs-apps.ts`), which post the
 *   same `libpack.proofs.{packId}` record over POST /v1/memory with a different proof shape
 *   (`summary` + `created`, no `verdict`, no `date`, no `selfReported`), no owner gate, no
 *   duplicate check, and a SET where this path APPENDS. `routes/library-packs.ts` reads every
 *   public record under that prefix and counts `verdict === 'pass'` towards `proven_models`, so a
 *   record written the other way is a proof that can never be proven and a pack that can be
 *   vouched for by someone who does not own it. Those two live behind the shell proxy and are
 *   another unit's files; this service is the one implementation they can be pointed at.
 *
 *   WHAT THE WRITE COST BEFORE. It went to `storage.setMemory` directly, so the proof record
 *   answered to none of memory's rules: no archive guard, no value-size ceiling, no key ceiling,
 *   no byte quota and no overage charge. A proofs record grows by one entry per run on a tool
 *   built to be called after every run, and it is public, so it was an unbounded public record
 *   nobody paid for. Going through services/memory-write.ts fixes all of that in one place, and
 *   brings the write's fan-out (live update, replication, provenance) with it.
 *
 *   WHAT STAYS AT THE DOOR. How the answer is rendered: the MCP tool prints text, a route would
 *   render the envelope. This function returns a refusal or the new total, never an HTTP response.
 * @structure
 *   - packProofsKey() -- the community pack's proofs record address
 *   - AttachProofCaller / AttachProofInput / AttachProofResult -- the contract
 *   - attachContributionProof() -- owner gate, duplicate rule, record build, shared write
 * @usage
 *   const out = await attachContributionProof({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out.message);
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Initial (August 2026 audit step 8): extracted from
 *     mcp/appdev-proofs.ts, with the storage write replaced by writeMemoryRecord().
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ContributionProof } from '../models/contribution-proof.js';
import { parseGAII } from '../utils/gaii.js';
import { writeMemoryRecord, type MemoryWriteResult } from './memory-write.js';
import { getTemplateProposal, templateProposalKey } from './app-template-proposals.js';

/** The community pack's append-only proof ledger: one public record per pack, under its owner. */
export const packProofsKey = (packId: string): string => `libpack.proofs.${packId}`;

/** Who is attaching, in the terms every surface can supply. */
export interface AttachProofCaller {
    /** The principal that ran the tool. The write lands in its OWNER's namespace. */
    principal: string;
    /** Scopes on the session, for the gate inside writeMemoryRecord. */
    scopes: string[];
    roles: string[];
}

export interface AttachProofInput {
    subjectType: 'library_pack' | 'app_template';
    subjectId: string;
    model: string;
    verdict: 'pass' | 'fail';
    evidence: string;
    testSet?: string;
    tokens?: number;
    /** Which road this came down, for the provenance record: 'mcp.appdev_proof_attach' … */
    pipeline: string;
}

type WriteRefusalCode = Extract<MemoryWriteResult, { ok: false }>['code'];

export type AttachProofResult =
    | {
        ok: true;
        subjectType: AttachProofInput['subjectType'];
        subjectId: string;
        /** Entries in the ledger after this one landed. */
        proofsTotal: number;
        proof: ContributionProof;
    }
    | {
        ok: false;
        status: number;
        code: 'IDENTITY_UNRESOLVED' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'DUPLICATE_PROOF' | WriteRefusalCode;
        message: string;
    };

const DUPLICATE_MESSAGE =
    'Duplicate proof (same model + test set + date) — the ledger is append-only, one entry per run';

function ownerOf(principal: string, config: AimeatConfig): { owner: string; ownerGhii: string } | null {
    const parsed = parseGAII(principal);
    const owner = parsed?.owner
        ?? (principal.includes('@') && !principal.includes('#') ? principal.split('@')[0] : null);
    return owner ? { owner, ownerGhii: `${owner}@${config.nodeId}` } : null;
}

/**
 * Attach one proof to a community library pack or to one of the caller's own template proposals.
 *
 * The order is the order the tool has always used: resolve the owner, gate on the subject, refuse a
 * duplicate, then write. A v1 proof is always self-reported; a node-verified badge would be an
 * additive field here, not a change to what this stores.
 */
export async function attachContributionProof(
    deps: { storage: Storage; config: AimeatConfig },
    caller: AttachProofCaller,
    input: AttachProofInput,
): Promise<AttachProofResult> {
    const { storage, config } = deps;
    const who = ownerOf(caller.principal, config);
    if (!who) {
        return { ok: false, status: 400, code: 'IDENTITY_UNRESOLVED', message: 'Could not resolve the caller to an owner' };
    }
    const now = new Date().toISOString();

    const proof: ContributionProof = {
        model: input.model.trim().toLowerCase(),
        verdict: input.verdict,
        evidence: input.evidence,
        ...(input.testSet ? { testSet: input.testSet } : {}),
        ...(typeof input.tokens === 'number' ? { tokens: input.tokens } : {}),
        date: now.slice(0, 10),
        selfReported: true,
    };
    const isDuplicate = (list: ContributionProof[]): boolean =>
        list.some(p => p.model === proof.model && (p.testSet ?? '') === (proof.testSet ?? '') && p.date === proof.date);

    if (input.subjectType === 'library_pack') {
        // Owner gate: the community pack is the caller's own ACTIVE + PUBLIC cortex with a lib.
        const all = await storage.listCortexExtensions({ status: 'active' });
        const ext = all.find(e => e.name === input.subjectId);
        if (!ext || ext.visibility !== 'public' || !ext.components.some(c => c.type === 'lib')) {
            return { ok: false, status: 404, code: 'NOT_FOUND', message: `No active public community pack "${input.subjectId}"` };
        }
        if (ext.installedBy !== who.owner) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the pack owner may attach proofs to it' };
        }

        const key = packProofsKey(input.subjectId);
        const existing = await storage.getMemory(who.ownerGhii, key);
        const value = (existing?.value ?? { packId: input.subjectId, proofs: [] }) as { packId: string; proofs: ContributionProof[] };
        const proofs = Array.isArray(value.proofs) ? value.proofs : [];
        if (isDuplicate(proofs)) {
            return { ok: false, status: 409, code: 'DUPLICATE_PROOF', message: DUPLICATE_MESSAGE };
        }
        proofs.push(proof);

        const written = await writeMemoryRecord({ storage, config }, {
            principal: caller.principal, targetGaii: who.ownerGhii,
            scopes: caller.scopes, roles: caller.roles,
        }, {
            key,
            value: { packId: input.subjectId, proofs },
            visibility: 'public',
            tags: ['libpack-proofs'],
            ttlHours: null,
            pipeline: input.pipeline,
            ownerScoped: true,
        });
        if (!written.ok) {
            return { ok: false, status: written.status, code: written.code, message: written.message };
        }
        return { ok: true, subjectType: input.subjectType, subjectId: input.subjectId, proofsTotal: proofs.length, proof };
    }

    // app_template: append to the caller's own proposal manifest.
    const found = await getTemplateProposal(storage, config, caller.principal, input.subjectId);
    if (!found) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Template proposal not found: ${input.subjectId}` };
    }
    const manifest = found.manifest;
    const proofs = Array.isArray(manifest.proofs) ? manifest.proofs : [];
    if (isDuplicate(proofs)) {
        return { ok: false, status: 409, code: 'DUPLICATE_PROOF', message: DUPLICATE_MESSAGE };
    }
    proofs.push(proof);
    manifest.proofs = proofs;
    manifest.updatedAt = now;

    // The proposal's own visibility and tags are the proposal's business, so they are carried over
    // rather than restated here: this write appends a proof, it does not re-decide who may read it.
    const written = await writeMemoryRecord({ storage, config }, {
        principal: caller.principal, targetGaii: found.record.ownerGaii,
        scopes: caller.scopes, roles: caller.roles,
    }, {
        key: templateProposalKey(input.subjectId),
        value: manifest,
        visibility: found.record.visibility,
        tags: found.record.tags,
        ttlHours: found.record.ttlHours,
        ...(found.record.groupId ? { groupId: found.record.groupId } : {}),
        ...(found.record.workspaceRef !== undefined ? { workspaceRef: found.record.workspaceRef } : {}),
        pipeline: input.pipeline,
        ownerScoped: true,
    });
    if (!written.ok) {
        return { ok: false, status: written.status, code: written.code, message: written.message };
    }
    return { ok: true, subjectType: input.subjectType, subjectId: input.subjectId, proofsTotal: proofs.length, proof };
}
