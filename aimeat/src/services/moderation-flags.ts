/**
 * @file src/services/moderation-flags.ts
 * @description Raising a moderation flag, once, for every surface that can raise one.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/flags` and `aimeat_flag_report` both wrote a FlagRecord, and the
 *   two copies had drifted apart on four things. Everything below was in the HTTP copy and absent
 *   from the tool copy, so an agent reporting content got a different capability than a person did:
 *
 *     - WHAT CAN BE REPORTED. HTTP takes six target types and six reasons; the tool declared four
 *       and five. The three it was missing are the AI Act correction procedure (TARGET-058 Phase 8):
 *       `app`, `ai_provenance` and `undisclosed_ai` are how anyone reports content that should carry
 *       an AI label and does not. An agent, which is the thing most likely to notice an unlabelled
 *       generation, could not report one at all. The lists live here now and both doors read them,
 *       so the next value added reaches both.
 *     - THE ORGANISM'S OWN SETTING. An organism can turn flagging off for its own memory
 *       (`moderationConfig.flagsEnabled`), and HTTP refuses with 403 when it has. The tool never
 *       looked, so the setting held on one door and not the other.
 *     - THE COUNTER ON THE MEMORY RECORD. Flagging memory increments `flagCount` on the record
 *       itself, which is what every reader of that memory sees. A flag raised through the tool left
 *       the counter untouched, so the same memory read as clean.
 *     - THE SHAPE. `targetId` is 1-256 characters and `description` at most 10 000. The tool took a
 *       plain `z.string()` for both, and the HTTP door's own manual enum checks sat behind
 *       validateBody(FlagCreateSchema) where they could never run. One set of bounds, applied on the
 *       way in, is what both doors were reaching for separately.
 *
 *   The auto-hide decision also lives here, because it is part of what raising a flag DID rather
 *   than part of how an answer is rendered: the weighted count of active flags against the
 *   threshold, per-organism when the target belongs to one.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - FLAG_TARGET_TYPES / FLAG_REASONS / FLAG_LIMITS — what a flag may say, shared by both doors
 *   - resolveOrganismForFlag() — the organism a flagged memory key belongs to, or null
 *   - createModerationFlag() — validation, duplicate check, organism gate, record, side effects
 * @usage
 *   const out = await createModerationFlag({ storage, config }, flaggedBy, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8): the flag write moves off both surfaces.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, FlagRecord, OrganismRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * `app` and `ai_provenance` exist for the AI Act correction procedure (TARGET-058 Phase 8).
 *
 * The Code of Practice (Section 2, Commitment 2) requires a way for a person to report content that
 * should carry an AI label and does not, and until then this node had none. It is deliberately THIS
 * queue rather than a new one: flags already have a review surface, an auto-hide threshold, an
 * appeal path and a set of people who look at them. A fourth inbox would be a queue nobody watches,
 * which is the same as no correction procedure while looking like one.
 *
 * `ai_provenance` takes a record id because that is the identifier a reader actually holds: the
 * label's own "details" link goes to `/v1/provenance/<id>`, so reporting it is a copy-paste rather
 * than an investigation.
 */
export const FLAG_TARGET_TYPES = ['memory', 'board_post', 'action', 'agent', 'app', 'ai_provenance'] as const;
export const FLAG_REASONS = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other', 'undisclosed_ai'] as const;

export type FlagTargetType = typeof FLAG_TARGET_TYPES[number];
export type FlagReason = typeof FLAG_REASONS[number];

/** The bounds FlagCreateSchema applies on the HTTP door, named here so both doors share them. */
export const FLAG_LIMITS = {
    targetIdMax: 256,
    descriptionMax: 10_000,
} as const;

export interface FlagCreateInput {
    targetType: string;
    targetId: string;
    reason: string;
    description?: string;
}

export type FlagCreateResult =
    | { ok: true; flag: FlagRecord; hidden: boolean }
    | { ok: false; status: number; code: string; message: string };

/**
 * The organism a flag target belongs to, or null.
 *
 * Only memory carries an organism: the target id is `<ownerGaii>::<key>` and an organism's memory
 * lives under `organism.<id>.`, so the organism is read out of the key rather than passed in by the
 * caller. Its moderation settings then decide whether flagging is open at all and where the
 * auto-hide threshold sits.
 */
export async function resolveOrganismForFlag(
    storage: Storage,
    targetType: string,
    targetId: string,
): Promise<OrganismRecord | null> {
    if (targetType !== 'memory' || !targetId.includes('::')) return null;
    const [, ...keyParts] = targetId.split('::');
    const memoryKey = keyParts.join('::');
    const orgMatch = memoryKey.match(/^organism\.([^.]+)\./);
    if (!orgMatch) return null;
    return storage.getOrganism(orgMatch[1]);
}

/**
 * Raise one flag. The order is the HTTP route's order, and the tool surface had none of it beyond
 * the duplicate check.
 *
 * `flaggedBy` is the caller's already-resolved identity. The service does not derive it, because the
 * two doors authenticate differently and each one knows who its caller is: an owner or agent JWT on
 * HTTP, the session's agent GAII over MCP.
 */
export async function createModerationFlag(
    deps: { storage: Storage; config: AimeatConfig },
    flaggedBy: string,
    input: FlagCreateInput,
): Promise<FlagCreateResult> {
    const { storage, config } = deps;

    const targetType = String(input.targetType ?? '');
    const targetId = String(input.targetId ?? '');
    const reason = String(input.reason ?? '');

    if (!targetType || !targetId || !reason) {
        return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            message: 'Missing required fields: targetType, targetId, reason',
        };
    }
    if (!(FLAG_TARGET_TYPES as readonly string[]).includes(targetType)) {
        return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            message: `Invalid targetType: "${targetType}". Must be one of: ${FLAG_TARGET_TYPES.join(', ')}`,
        };
    }
    if (!(FLAG_REASONS as readonly string[]).includes(reason)) {
        return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            message: `Invalid reason: "${reason}". Must be one of: ${FLAG_REASONS.join(', ')}`,
        };
    }
    if (targetId.length > FLAG_LIMITS.targetIdMax) {
        return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            message: `targetId must be 1-${FLAG_LIMITS.targetIdMax} characters`,
        };
    }
    if (input.description !== undefined && input.description.length > FLAG_LIMITS.descriptionMax) {
        return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            message: `description must be at most ${FLAG_LIMITS.descriptionMax} characters`,
        };
    }

    // One principal, one flag per target. A second report from the same reporter would count twice
    // towards auto-hide, which is what the weighting below exists to prevent.
    const existing = await storage.getFlagByUser(targetType, targetId, flaggedBy);
    if (existing) {
        return { ok: false, status: 409, code: 'ALREADY_FLAGGED', message: 'You have already flagged this target' };
    }

    // An organism may turn flagging off for its own content. The tool surface never asked.
    const organism = await resolveOrganismForFlag(storage, targetType, targetId);
    if (organism && !organism.moderationConfig.flagsEnabled) {
        return {
            ok: false, status: 403, code: 'FLAGS_DISABLED',
            message: 'Flagging is disabled for this organism\'s content',
        };
    }

    const now = new Date().toISOString();
    const id = `flag-${randomBytes(8).toString('hex')}`;

    const flag = await storage.createFlag({
        id,
        // FlagRecord still names four target types and five reasons, one list behind what both doors
        // accept since the AI Act correction procedure added `app`, `ai_provenance` and
        // `undisclosed_ai`. Widening the stored type is a storage change, which this move does not
        // make; the value written is one of FLAG_TARGET_TYPES, checked above.
        targetType: targetType as FlagRecord['targetType'],
        targetId,
        flaggedBy,
        reason: reason as FlagRecord['reason'],
        description: input.description ?? undefined,
        status: 'active',
        createdAt: now,
    });

    // The counter on the memory record itself, which is what every reader of that memory sees. A
    // flag raised through the tool used to leave it untouched, so the same memory read as clean.
    // The flag stands even if the counter cannot be bumped: losing the report is worse than a stale
    // count, which the flag list still corrects.
    if (targetType === 'memory' && targetId.includes('::')) {
        try {
            const [ownerGaii, ...keyParts] = targetId.split('::');
            await storage.incrementMemoryFlagCount(ownerGaii, keyParts.join('::'));
        } catch (err) {
            logger.warn('createModerationFlag: continuing after a suppressed failure', { error: String(err) });
        }
    }

    // Auto-hide, weighted by the reporter's trust score and account age (SECURITY P3-11) so a fresh
    // throwaway identity cannot hide content on its own. The threshold is the organism's when the
    // target belongs to one, the node's otherwise.
    const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
    let weightedFlagCount = 0;
    for (const f of activeFlags) {
        if (f.status !== 'active') continue;
        const reporter = await storage.getAgent(f.flaggedBy);
        if (!reporter) { weightedFlagCount += 0.5; continue; }
        const trustFactor = Math.max(0.1, (reporter.trustScore ?? 50) / 100);
        const owner = await storage.getOwner(reporter.owner);
        const ageDays = owner ? Math.floor((Date.now() - new Date(owner.createdAt).getTime()) / 86_400_000) : 0;
        const ageFactor = Math.min(1, ageDays / 30); // Full weight after 30 days
        weightedFlagCount += Math.max(0.1, trustFactor * Math.max(0.2, ageFactor));
    }
    const autoHideThreshold = organism
        ? organism.moderationConfig.autoHideThreshold
        : config.autoHideThreshold;
    const hidden = weightedFlagCount >= autoHideThreshold;

    // A moderation queue open in a browser listens on this domain. Without the event a flag raised
    // by an agent sat unseen until somebody reloaded the page.
    emitChange('flags');

    return { ok: true, flag, hidden };
}
