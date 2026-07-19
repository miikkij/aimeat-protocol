/**
 * @file app-template-proposals.ts
 * @description Agent-proposed app templates — after building/publishing an app, an agent
 *   records what generalizes so the owner's NEXT build starts from it (fork the source app or
 *   scaffold from the reuse notes). Mirrors the skills-registry substrate 1:1: one manifest
 *   memory record per proposal at `template.catalog.{id}.manifest` under the owner's GHII,
 *   visibility `private` in v1 (sharing/selling later = a visibility flip, no migration).
 *   The tier/packs/composes fields reuse the curated AppTemplate vocabulary so promotion into
 *   src/data/app-templates.ts is a copy, not a mapping. Model attribution is MANDATORY and
 *   indicative. Read by the appdev overview and the `templates` discovery source.
 * @structure TemplateProposalManifest; proposeTemplate/listTemplateProposals/
 *   getTemplateProposal/deleteTemplateProposal; templateProposalKey()
 * @usage import { proposeTemplate, listTemplateProposals } from './app-template-proposals.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import type { ContributionProof } from '../models/contribution-proof.js';

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TemplateProposalManifest {
    id: string;
    title: string;
    description: string;
    /** The app this template was distilled from. */
    derivedFrom: { owner: string; filename: string; version: number; node: string };
    /** Curated AppTemplate vocabulary — promotion to the registry is a copy. */
    tier: 'T1' | 'T2' | 'T3';
    tags: string[];
    /** What generalizes: the parts a next build should copy/keep, in plain prose. */
    reuseNotes: string;
    /** How the next build should start from this. */
    startMode: 'fork' | 'scaffold' | 'either';
    startModeRationale?: string;
    /** The model that built the source app. MANDATORY, self-reported, indicative. */
    model: string;
    /** Per-model observations (which models handle this template well/badly). */
    modelNotes?: Array<{ model: string; notes: string; evidence?: string }>;
    /** Self-reported acceleration proofs (Phase 8 attaches these). */
    proofs?: ContributionProof[];
    /** Library packs the template relies on (pack registry ids). */
    packs?: string[];
    /** Component template ids this composes (curated registry vocabulary). */
    composes?: string[];
    proposedBy: string;
    createdAt: string;
    updatedAt: string;
}

export const templateProposalKey = (id: string): string => `template.catalog.${id}.manifest`;
export const TEMPLATE_PROPOSAL_KEY_RE = /^template\.catalog\.([a-z0-9]+(?:-[a-z0-9]+)*)\.manifest$/;

export interface ProposeTemplateInput {
    id: string;
    title: string;
    description: string;
    derived_from: { owner: string; filename: string };
    tier: 'T1' | 'T2' | 'T3';
    tags?: string[];
    reuse_notes: string;
    start_mode?: 'fork' | 'scaffold' | 'either';
    start_mode_rationale?: string;
    model: string;
    model_notes?: Array<{ model: string; notes: string; evidence?: string }>;
    packs?: string[];
    composes?: string[];
}

function ownerGhiiOf(callerGaii: string, config: AimeatConfig): { owner: string; ownerGhii: string } | null {
    const parsed = parseGAII(callerGaii);
    if (parsed?.owner) return { owner: parsed.owner, ownerGhii: `${parsed.owner}@${config.nodeId}` };
    if (callerGaii.includes('@') && !callerGaii.includes('#')) {
        return { owner: callerGaii.split('@')[0], ownerGhii: callerGaii };
    }
    return null;
}

/** Upsert a proposal (same id replaces — proposals are meant to improve over time). */
export async function proposeTemplate(
    storage: Storage, config: AimeatConfig, callerGaii: string, input: ProposeTemplateInput,
): Promise<{ manifest: TemplateProposalManifest; updated: boolean } | { error: string }> {
    const who = ownerGhiiOf(callerGaii, config);
    if (!who) return { error: 'Could not resolve the caller to an owner' };
    if (!ID_RE.test(input.id) || input.id.length > 64) {
        return { error: 'Invalid template id — use kebab-case (a-z, 0-9, dashes), max 64 chars' };
    }

    // The derived-from app must exist and belong to THIS owner (a template proposal is a
    // reflection on the owner's own build, not a claim over someone else's app).
    if (input.derived_from.owner !== who.owner) {
        return { error: 'derived_from.owner must be your own owner name' };
    }
    const sourceOwnerGhii = `${input.derived_from.owner}@${config.nodeId}`;
    const app = await storage.getApp(sourceOwnerGhii, input.derived_from.filename);
    if (!app) return { error: `derived_from app not found: ${input.derived_from.owner}/${input.derived_from.filename}` };

    const key = templateProposalKey(input.id);
    const existing = await storage.getMemory(who.ownerGhii, key);
    const existingValue = existing?.value as TemplateProposalManifest | null;
    const now = new Date().toISOString();

    const manifest: TemplateProposalManifest = {
        id: input.id,
        title: input.title,
        description: input.description,
        derivedFrom: {
            owner: input.derived_from.owner,
            filename: input.derived_from.filename,
            version: app.versionNumber,
            node: config.nodeId,
        },
        tier: input.tier,
        tags: (input.tags ?? []).slice(0, 12),
        reuseNotes: input.reuse_notes,
        startMode: input.start_mode ?? 'either',
        ...(input.start_mode_rationale ? { startModeRationale: input.start_mode_rationale } : {}),
        model: input.model.trim().toLowerCase(),
        ...(input.model_notes ? { modelNotes: input.model_notes } : {}),
        // Proofs survive an upsert — they attach to the proposal id, not one wording of it.
        ...(existingValue?.proofs ? { proofs: existingValue.proofs } : {}),
        ...(input.packs ? { packs: input.packs } : {}),
        ...(input.composes ? { composes: input.composes } : {}),
        proposedBy: callerGaii,
        createdAt: existingValue?.createdAt ?? now,
        updatedAt: now,
    };

    await storage.setMemory({
        key,
        ownerGaii: who.ownerGhii,
        value: manifest,
        visibility: existing?.visibility ?? 'private',
        tags: ['template', 'template-proposal', `model:${manifest.model}`, `tier:${manifest.tier}`],
        ttlHours: null,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
    return { manifest, updated: !!existing };
}

export async function listTemplateProposals(
    storage: Storage, config: AimeatConfig, callerGaii: string,
): Promise<TemplateProposalManifest[]> {
    const who = ownerGhiiOf(callerGaii, config);
    if (!who) return [];
    const records = await storage.listMemory(who.ownerGhii, { prefix: 'template.catalog.', tags: ['template'] });
    return records
        .filter(r => TEMPLATE_PROPOSAL_KEY_RE.test(r.key))
        .map(r => r.value as TemplateProposalManifest)
        .filter(Boolean);
}

export async function getTemplateProposal(
    storage: Storage, config: AimeatConfig, callerGaii: string, id: string,
): Promise<{ record: MemoryRecord; manifest: TemplateProposalManifest } | null> {
    const who = ownerGhiiOf(callerGaii, config);
    if (!who || !ID_RE.test(id)) return null;
    const record = await storage.getMemory(who.ownerGhii, templateProposalKey(id));
    if (!record) return null;
    return { record, manifest: record.value as TemplateProposalManifest };
}

export async function deleteTemplateProposal(
    storage: Storage, config: AimeatConfig, callerGaii: string, id: string,
): Promise<boolean> {
    const who = ownerGhiiOf(callerGaii, config);
    if (!who || !ID_RE.test(id)) return false;
    return storage.deleteMemory(who.ownerGhii, templateProposalKey(id));
}
