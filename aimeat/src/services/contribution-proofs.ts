/**
 * @file src/services/contribution-proofs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Attaching one self-reported acceleration proof to a community contribution, for
 *   every surface that can attach one.
 *
 *   WHY THIS FILE EXISTS. The proof attach had no single home. `mcp/appdev-proofs.ts` held the
 *   whole capability inline: the owner gate on the community pack, the append-only duplicate rule,
 *   the ContributionProof shape, and the storage write itself. There is no REST route for the
 *   attach, so the copies that drifted are the two CLI connector definitions
 *   (`cli/connect/mcp/tools/appdev.ts` and `tool-dispatch/tool-call-defs-apps.ts`), which post the
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
 *   v1.1.0 -- 2026-10-25 -- A community pack is named by its stored `<owner>/<name>` or, by its owner, by its short name; the ledger key and the answer carry the stored name (secaudit2026oct22).
 *   v1.0.0 -- 2026-08-11 -- Initial (August 2026 audit step 8): extracted from
 *     mcp/appdev-proofs.ts, with the storage write replaced by writeMemoryRecord().
 *   v1.0.1 -- 2026-09-26 -- The caller's account comes from localAccountOf, so a visitor from another
 *     node resolves to no owner here, never to the local namesake (secaudit 2026-09, F-1).
 *   v1.0.2 -- 2026-10-19 -- Both ledgers are written with expectedVersion, and the proof is checked
 *     and appended again on a fresh read after a VERSION_CONFLICT (check:atomic-writes).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ContributionProof } from '../models/contribution-proof.js';
import { isGEAI, localAccountOf } from '../utils/gaii.js';
import { namespacedName } from './component-address.js';
import { writeMemoryRecord, type MemoryWriteResult } from './memory-write.js';
import { getTemplateProposal, templateProposalKey } from './app-template-proposals.js';
import { CAS_ATTEMPTS } from './record-cas.js';

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
const CONFLICT_MESSAGE =
    `The record changed under every one of ${CAS_ATTEMPTS} attempts; attach the proof again`;

/** The caller's account on this node and its GHII; none for an ecosystem app or another node's identity. */
function ownerOf(principal: string, config: AimeatConfig): { owner: string; ownerGhii: string } | null {
    const owner = isGEAI(principal) ? null : localAccountOf(principal);
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
        // The owner names their own pack by its short name or its stored `<owner>/<name>`
        // (services/component-address.ts); the ledger is keyed by the stored name, the pack's id.
        const ext = all.find(e => e.name === input.subjectId)
            ?? all.find(e => e.name === namespacedName(who.owner, input.subjectId));
        if (!ext || ext.visibility !== 'public' || !ext.components.some(c => c.type === 'lib')) {
            return { ok: false, status: 404, code: 'NOT_FOUND', message: `No active public community pack "${input.subjectId}"` };
        }
        if (ext.installedBy !== who.owner) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the pack owner may attach proofs to it' };
        }

        // The ledger is written on the version that was read. A proof attached at the same moment
        // lands first; this one is then checked and appended against a fresh read.
        const packId = ext.name;
        const key = packProofsKey(packId);
        for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
            const existing = await storage.getMemory(who.ownerGhii, key);
            const value = (existing?.value ?? { packId, proofs: [] }) as { packId: string; proofs: ContributionProof[] };
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
                value: { packId, proofs },
                visibility: 'public',
                tags: ['libpack-proofs'],
                ttlHours: null,
                expectedVersion: existing?.version ?? 0,
                pipeline: input.pipeline,
                ownerScoped: true,
            });
            if (!written.ok && written.code === 'VERSION_CONFLICT') continue;
            if (!written.ok) {
                return { ok: false, status: written.status, code: written.code, message: written.message };
            }
            return { ok: true, subjectType: input.subjectType, subjectId: packId, proofsTotal: proofs.length, proof };
        }
        return { ok: false, status: 409, code: 'VERSION_CONFLICT', message: CONFLICT_MESSAGE };
    }

    // app_template: append to the caller's own proposal manifest, on the version that was read, and
    // against a fresh read when a re-proposal or another proof landed meanwhile.
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
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
            expectedVersion: found.record.version,
            pipeline: input.pipeline,
            ownerScoped: true,
        });
        if (!written.ok && written.code === 'VERSION_CONFLICT') continue;
        if (!written.ok) {
            return { ok: false, status: written.status, code: written.code, message: written.message };
        }
        return { ok: true, subjectType: input.subjectType, subjectId: input.subjectId, proofsTotal: proofs.length, proof };
    }
    return { ok: false, status: 409, code: 'VERSION_CONFLICT', message: CONFLICT_MESSAGE };
}
